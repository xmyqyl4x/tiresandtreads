import { createHash } from 'node:crypto';
import type { MailEventsRepository } from '../../../application/src/ports/mail-events.ts';
import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { createReliabilityRepository } from './reliability.ts';
import { createPrivacyRepository } from './privacy.ts';
import { createContactServiceRepository } from './contact-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { lockSubjects, rid, text, type Row } from './private-values.ts';
export function createMailEventsRepository(
  scope: WriteScope,
  lookupVersions: readonly string[],
): MailEventsRepository {
  const q = scope.query,
    inbox = createReliabilityRepository(scope),
    privacy = createPrivacyRepository(scope, lookupVersions),
    contacts = createContactServiceRepository(scope, lookupVersions);
  async function lock(tx: Tx, sendId: Id<'send'>) {
    const ref = (
      await q(
        tx,
        'SELECT s.owner_subject_id,c.subject_id FROM email.email_sends s LEFT JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=$1',
        [sendId],
      )
    ).rows[0];
    if (!ref) return stop('not_found');
    await lockSubjects(
      scope,
      tx,
      [ref.owner_subject_id, ref.subject_id].filter((x): x is string => typeof x === 'string'),
    );
    return (await q(tx, 'SELECT * FROM email.email_sends WHERE id=$1 FOR UPDATE', [sendId]))
      .rows[0]!;
  }
  async function suppress(tx: Tx, s: Row, reason: 'complaint' | 'hard_bounce') {
    if (s.anonymized_at !== null || s.recipient_contact_id === null) return;
    const c = (
      await q(tx, "SELECT id,subject_id FROM privacy.contacts WHERE id=$1 AND status='active'", [
        s.recipient_contact_id,
      ])
    ).rows[0];
    if (!c) return;
    const subject = rid('subject', c.subject_id);
    if (!(await privacy.suppressed(tx, subject, ['all-email'])))
      await privacy.suppress(tx, {
        subjectId: subject,
        scope: 'all-email',
        reason,
        expiresAt: null,
      });
    await contacts.tombstone(
      tx,
      await contacts.contactKeys(tx, rid('contact', c.id)),
      'all-email',
      reason,
    );
  }
  async function accepted(tx: Tx, s: Row, messageId: string) {
    if (s.dispatch_state !== 'uncertain' || s.anonymized_at !== null) return;
    await q(
      tx,
      "UPDATE email.email_sends SET dispatch_state='accepted',accepted_at=clock_timestamp(),provider_message_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
      [s.id, messageId],
    );
    await q(
      tx,
      `INSERT INTO email.send_receipts(send_id,provider,provider_key_digest,payload_digest,outcome,last_reconciled_at) VALUES($1,'resend',$2,$3,'accepted',clock_timestamp()) ON CONFLICT(send_id) DO UPDATE SET outcome='accepted',last_reconciled_at=clock_timestamp(),revision=send_receipts.revision+1,updated_at=clock_timestamp()`,
      [
        s.id,
        createHash('sha256').update(text(s.provider_key)).digest(),
        s.payload_hash ? Buffer.from(text(s.payload_hash), 'hex') : null,
      ],
    );
  }
  const repo: MailEventsRepository = {
    async receive(tx, e) {
      const i = await inbox.receive(tx, {
        provider: 'resend',
        eventId: e.eventId,
        digest: e.digest,
        assetId: null,
        receivedAt: e.receivedAt,
        verifiedAt: e.receivedAt,
      });
      await q(
        tx,
        `INSERT INTO email.callback_observations(inbox_id,message_id,delivery_key,type,classification,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(inbox_id) DO NOTHING`,
        [i.id, e.messageId, e.deliveryKey, e.type, e.classification, e.occurredAt],
      );
      return i.id;
    },
    async apply(tx, id) {
      const i = await inbox.current(tx, id);
      if (!i) return stop('not_found');
      if (i.state === 'processed' || i.state === 'quarantined') return i.state;
      const e = (
        await q(
          tx,
          `SELECT o.*,i.provider_event_id,i.received_at,i.attempts FROM email.callback_observations o JOIN app.webhook_inbox i ON i.id=o.inbox_id WHERE o.inbox_id=$1`,
          [id],
        )
      ).rows[0];
      if (!e) return stop('not_found');
      async function defer() {
        await q(
          tx,
          "UPDATE app.webhook_inbox SET next_attempt_at=clock_timestamp()+interval '30 seconds',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
        return 'pending' as const;
      }
      async function finish(state: 'processed' | 'quarantined') {
        const running = await inbox.process(tx, id, i!.revision, 'processing');
        await inbox.process(tx, id, running.revision, state);
        return state;
      }
      if (e.type === 'unsupported') return finish('quarantined');
      const candidates = (
        await q(
          tx,
          `SELECT id FROM email.email_sends WHERE provider='resend' AND (provider_message_id=$1 OR ($2::text IS NOT NULL AND provider_key=$2)) LIMIT 2`,
          [e.message_id, e.delivery_key],
        )
      ).rows;
      if (candidates.length > 1) return finish('quarantined');
      if (!candidates.length) return defer();
      const s = await lock(tx, rid('send', candidates[0]!.id));
      if (
        (s.provider_message_id !== null && s.provider_message_id !== e.message_id) ||
        (e.delivery_key !== null && s.provider_key !== e.delivery_key)
      )
        return finish('quarantined');
      if (s.anonymized_at !== null) return finish('processed');
      if (['cancelled', 'suppressed', 'failed'].includes(String(s.dispatch_state)))
        return finish('quarantined');
      // Facts may arrive while handoff is in flight; they never replace the dispatch state.
      if (e.type !== 'sent') {
        let permitted = true;
        if (e.type === 'opened' || e.type === 'clicked') {
          const p = (
            await q(
              tx,
              `SELECT 1 FROM privacy.contacts c JOIN app.subjects s ON s.id=c.subject_id JOIN privacy.consent_state p ON p.subject_id=s.id WHERE c.id=$1 AND c.status='active' AND s.status='active' AND p.purpose='analytics' AND p.scope_key='email' AND p.status='confirmed' AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp())`,
              [s.recipient_contact_id],
            )
          ).rows;
          permitted = p.length > 0;
          if (permitted) {
            const c = (
              await q(tx, 'SELECT subject_id FROM privacy.contacts WHERE id=$1', [
                s.recipient_contact_id,
              ])
            ).rows[0]!;
            permitted = !(await privacy.suppressed(tx, rid('subject', c.subject_id), [
              'all-email',
              'analytics',
              'email',
            ]));
          }
        }
        if (permitted) {
          const inserted = await q(
            tx,
            `INSERT INTO email.email_events(send_id,provider,provider_event_id,type,occurred_at,received_at,classification) VALUES($1,'resend',$2,$3,$4,$5,$6) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,
            [s.id, e.provider_event_id, e.type, e.occurred_at, e.received_at, e.classification],
          );
          if (inserted.rows.length && (e.type === 'bounced' || e.type === 'complained'))
            await suppress(tx, s, e.type === 'bounced' ? 'hard_bounce' : 'complaint');
        }
      }
      if (['scheduled', 'dispatching'].includes(String(s.dispatch_state))) return defer();
      await accepted(tx, s, text(e.message_id));
      return finish('processed');
    },
    async pending(tx) {
      return (
        await q(
          tx,
          `SELECT i.id FROM app.webhook_inbox i JOIN email.callback_observations o ON o.inbox_id=i.id WHERE i.provider='resend' AND i.state IN ('pending','failed') AND (i.next_attempt_at IS NULL OR i.next_attempt_at<=statement_timestamp()) ORDER BY i.next_attempt_at NULLS FIRST,i.id LIMIT 20`,
        )
      ).rows.map((x) => rid('inbox', x.id));
    },
    async status(tx, id) {
      const s = (
        await q(
          tx,
          `SELECT dispatch_state,provider_message_id FROM email.email_sends WHERE id=$1 AND provider='resend'`,
          [id],
        )
      ).rows[0];
      if (!s) return stop('not_found');
      const e = (
        await q(
          tx,
          `SELECT coalesce(bool_or(type='delivered'),false) AS delivered,coalesce(bool_or(type='bounced'),false) AS bounced,coalesce(bool_or(type='complained'),false) AS complained FROM email.email_events WHERE send_id=$1`,
          [id],
        )
      ).rows[0]!;
      return {
        state: text(s.dispatch_state),
        messageId: s.provider_message_id === null ? null : text(s.provider_message_id),
        delivered: e.delivered === true,
        bounced: e.bounced === true,
        complained: e.complained === true,
      };
    },
    async reconciled(tx, id, messageId, event) {
      const s = await lock(tx, id);
      if (
        s.provider !== 'resend' ||
        s.provider_message_id !== messageId ||
        s.anonymized_at !== null
      )
        return stop('conflict');
      if (
        [
          'sent',
          'delivered',
          'delivery_delayed',
          'bounced',
          'complained',
          'opened',
          'clicked',
        ].includes(event)
      ) {
        await accepted(tx, s, messageId);
        if (event === 'bounced' || event === 'complained')
          await suppress(tx, s, event === 'bounced' ? 'hard_bounce' : 'complaint');
      }
      // Retrieval is evidence of acceptance, never a fabricated provider delivery event/metric.
      await q(
        tx,
        'UPDATE email.send_receipts SET last_reconciled_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 WHERE send_id=$1',
        [id],
      );
    },
  };
  return guarded(scope, repo);
}
