import type {
  DeliveryWorkRepository,
  DeliveryDocument,
} from '../../../application/src/ports/delivery-services.ts';
import type { ContactPolicy } from '../../../application/src/ports/contact-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { one, rid, rev, stamp, text, obj, lockSubjects } from './private-values.ts';
import { sendFromRow } from './delivery.ts';
import { createPrivacyRepository } from './privacy.ts';
import { createContactServiceRepository } from './contact-services.ts';
import { canonical } from '../../../application/src/services/service-records.ts';
import {
  contentTopics,
  learningLinks,
  type LearningPage,
  type Topic,
} from '../../../domain/src/public-policy.ts';
import { createHash } from 'node:crypto';
export function createDeliveryWorkRepository(
  s: WriteScope,
  policy: ContactPolicy,
  lookupVersions: readonly string[],
): DeliveryWorkRepository {
  const q = s.query,
    privacy = createPrivacyRepository(s, lookupVersions),
    contacts = createContactServiceRepository(s, lookupVersions);
  async function lock(tx: Parameters<DeliveryWorkRepository['acquire']>[0], id: string) {
    const ref = (
      await q(
        tx,
        'SELECT s.owner_subject_id,c.subject_id FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=$1 AND s.anonymized_at IS NULL',
        [id],
      )
    ).rows[0];
    if (!ref) return null;
    await lockSubjects(s, tx, [text(ref.owner_subject_id), text(ref.subject_id)]);
    return (
      (
        await q(
          tx,
          'SELECT s.*,w.lease_token,w.lease_generation,w.lease_until,w.next_attempt_at,w.failures,w.first_attempt_at,w.payload_asset_id AS frozen_asset,w.payload_hash AS frozen_hash FROM email.email_sends s JOIN email.delivery_work w ON w.send_id=s.id WHERE s.id=$1 FOR UPDATE OF s,w',
          [id],
        )
      ).rows[0] ?? null
    );
  }
  const repo: DeliveryWorkRepository = {
    async presentation(tx, id) {
      const r = one((await q(tx, 'SELECT locale,market FROM app.reports WHERE id=$1', [id])).rows);
      return { locale: text(r.locale), market: text(r.market) };
    },
    async capture(tx, i) {
      const intent = await contacts.intent(tx, i.verificationId);
      if (
        !intent ||
        intent.ownerId !== i.owner.subjectId ||
        intent.contactId !== i.send.contactId ||
        intent.purpose !== 'report' ||
        intent.scope !== `report:${i.send.reportId}:${i.send.reportVersion}`
      )
        return stop('forbidden');
      const p = await privacy.permission(tx, intent.subjectId, 'report', intent.scope);
      if (!p.eventId) return stop('integrity');
      await q(
        tx,
        'INSERT INTO email.delivery_snapshots(send_id,verification_id,offers_verification_id,permission_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [i.send.id, i.verificationId, i.offersId, p.eventId, canonical(i.document)],
      );
      await q(tx, 'INSERT INTO email.delivery_work(send_id,next_attempt_at) VALUES($1,$2)', [
        i.send.id,
        i.send.sendAfter,
      ]);
      await q(
        tx,
        `INSERT INTO email.delivery_asset_reservations(send_id,asset_id,purpose) VALUES($1,$2,'report_pdf'),($1,$3,'email_payload')`,
        [i.send.id, i.pdfAssetId, i.payloadAssetId],
      );
    },
    async template(tx, id, locale) {
      const t = (
        await q(
          tx,
          "SELECT id,version,renderer_hash FROM email.template_versions WHERE id=$1 AND locale=$2 AND purpose='report' AND status='published'",
          [id, locale],
        )
      ).rows[0];
      return t
        ? {
            id: rid('template', t.id),
            version: text(t.version),
            rendererHash: text(t.renderer_hash, 64),
          }
        : null;
    },
    async learning(tx, v, locale, market) {
      const result =
        v.output.result && typeof v.output.result === 'object'
          ? (v.output.result as Record<string, unknown>)
          : {};
      const decisions = Array.isArray(result.decisions) ? result.decisions : [];
      const reasons = decisions
        .flatMap((d) => (d && typeof d === 'object' && Array.isArray(d.reasons) ? d.reasons : []))
        .filter((x): x is string => typeof x === 'string')
        .slice(0, 1000);
      const maps = (
        await q(
          tx,
          'SELECT topic_key,weight FROM email.education_topic_map WHERE rule_version_id=$1 AND reason_code=ANY($2::text[]) ORDER BY topic_key LIMIT 200',
          [v.ruleVersionId, reasons],
        )
      ).rows;
      const weights: Partial<Record<Topic, number>> = {};
      for (const r of maps)
        if (contentTopics.includes(r.topic_key as Topic))
          weights[r.topic_key as Topic] = Math.min(
            100,
            (weights[r.topic_key as Topic] ?? 0) + Number(r.weight),
          );
      const rows = (
        await q(
          tx,
          'SELECT document FROM app.public_pages WHERE locale=$1 AND market=$2 ORDER BY public_path LIMIT 200',
          [locale, market],
        )
      ).rows;
      const pages = rows.map((r) => ({
        ...(obj(r.document, 240000) as unknown as LearningPage),
        checklist: (r.document as Record<string, unknown>).path === '/guides/before-you-buy',
      }));
      const at = stamp(one((await q(tx, 'SELECT clock_timestamp() AS at')).rows).at);
      return learningLinks(pages, weights, locale, market, at, {
        permitted: false,
        clicked: [],
      }).map((l) => ({ ...l, expiresAt: pages.find((p) => p.path === l.path)!.expiresAt }));
    },
    async acquire(tx, id) {
      const r = await lock(tx, id);
      if (!r || !['scheduled', 'dispatching', 'uncertain'].includes(String(r.dispatch_state)))
        return null;
      const lease = (
        await q(
          tx,
          `UPDATE email.delivery_work SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '120 seconds',failures=failures+1,updated_at=clock_timestamp()
    WHERE send_id=$1 AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND EXISTS(SELECT 1 FROM email.email_sends WHERE id=$1 AND send_after<=clock_timestamp()) RETURNING *`,
          [id],
        )
      ).rows[0];
      if (!lease) return null;
      const document = obj(
        one(
          (await q(tx, 'SELECT document FROM email.delivery_snapshots WHERE send_id=$1', [id]))
            .rows,
        ).document,
        524288,
      ) as unknown as DeliveryDocument;
      const contact = await privacy.contact(tx, rid('contact', r.recipient_contact_id));
      if (!contact) return stop('integrity');
      return {
        id,
        token: rid('lease', lease.lease_token),
        generation: rev(lease.lease_generation),
        document,
        send: sendFromRow(r),
        contact,
        firstAttemptAt: lease.first_attempt_at === null ? null : stamp(lease.first_attempt_at),
        failures: Number(lease.failures),
        attempts: Number(
          one(
            (
              await q(tx, 'SELECT count(*)::int AS n FROM email.send_attempts WHERE send_id=$1', [
                id,
              ])
            ).rows,
          ).n,
        ),
        payloadId: lease.payload_asset_id === null ? null : rid('asset', lease.payload_asset_id),
        payloadHash: lease.payload_hash === null ? null : text(lease.payload_hash, 64),
      };
    },
    async fence(tx, l) {
      if (!(await lock(tx, l.id))) return stop('not_found');
      if (
        !(
          await q(
            tx,
            'SELECT 1 FROM email.delivery_work WHERE send_id=$1 AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp()',
            [l.id, l.token, l.generation.toString()],
          )
        ).rows.length
      )
        return stop('conflict');
    },
    async permission(tx, l) {
      await repo.fence(tx, l);
      if (l.document.learning.length > 6) return stop('integrity');
      if (l.document.learning.length) {
        const paths = l.document.learning.map((link) => link.path);
        const current = one(
          (
            await q(
              tx,
              'SELECT count(*)::int AS n FROM app.public_pages WHERE public_path=ANY($1::text[]) AND locale=$2 AND market=$3',
              [paths, l.document.locale, l.document.market],
            )
          ).rows,
        );
        if (Number(current.n) !== paths.length) return stop('forbidden');
      }
      const c = await contacts.guard(tx, null, l.contact.id),
        scope = `report:${l.send.reportId}:${l.send.reportVersion}`;
      const p = await privacy.permission(tx, c.subjectId, 'report', scope);
      const request = (
        await q(
          tx,
          `SELECT 1 FROM email.delivery_snapshots d JOIN privacy.contact_intents i ON i.challenge_id=d.verification_id JOIN privacy.verification_challenges v ON v.id=i.challenge_id
    JOIN privacy.consent_state p ON p.subject_id=$2 AND p.purpose='report' AND p.scope_key=$3
    JOIN app.subjects o ON o.id=$4 JOIN app.reports r ON r.id=$5
    WHERE d.send_id=$1 AND i.contact_id=$6 AND i.owner_subject_id=$4 AND i.scope_key=$3 AND v.purpose='report' AND i.policy_version=$7 AND v.notice_id=$8
    AND o.status='active' AND (o.expires_at IS NULL OR o.expires_at>clock_timestamp()) AND r.status='active' AND r.expires_at>clock_timestamp()
    AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp()) AND
    ((p.status='confirmed' AND $9::boolean) OR (p.source_event_id=d.permission_event_id AND v.invalidated_at IS NULL AND v.expires_at>clock_timestamp()))`,
          [
            l.id,
            c.subjectId,
            scope,
            l.send.ownerId,
            l.send.reportId,
            c.id,
            policy.version,
            policy.notices.report,
            c.verifiedAt !== null,
          ],
        )
      ).rows.length;
      if (
        !request ||
        !(await contacts.notice(tx, policy.notices.report, 'report', policy.version)) ||
        (await privacy.suppressed(tx, c.subjectId, ['all-email', 'report', scope])) ||
        (await contacts.tombstoned(tx, await contacts.contactKeys(tx, c.id), [
          'all-email',
          'report',
          scope,
        ]))
      )
        return stop('forbidden');
      return p.revision;
    },
    async freeze(tx, l, payloadId, pdfId, hash) {
      await repo.permission(tx, l);
      const current = one(
        (
          await q(
            tx,
            'SELECT payload_asset_id,pdf_asset_id,payload_hash FROM email.delivery_work WHERE send_id=$1',
            [l.id],
          )
        ).rows,
      );
      if (current.payload_asset_id !== null) {
        if (
          current.payload_asset_id !== payloadId ||
          current.pdf_asset_id !== pdfId ||
          current.payload_hash !== hash
        )
          return stop('conflict');
        return;
      }
      await q(
        tx,
        'UPDATE email.delivery_work SET payload_asset_id=$2,pdf_asset_id=$3,payload_hash=$4,updated_at=clock_timestamp() WHERE send_id=$1',
        [l.id, payloadId, pdfId, hash],
      );
      if (
        !(
          await q(
            tx,
            "SELECT id FROM app.object_assets WHERE id=$1 AND purpose='report_pdf' AND state='ready' AND expires_at>clock_timestamp()",
            [pdfId],
          )
        ).rows.length
      )
        return stop('conflict');
      await q(
        tx,
        `INSERT INTO app.report_assets(asset_id,report_id,report_version,comparison_revision,renderer_version,locale,view_scope,render_key) VALUES($1,$2,$3,$4,$5,$6,'owner',$7)`,
        [
          pdfId,
          l.send.reportId,
          l.send.reportVersion,
          l.send.comparisonRevision?.toString() ?? null,
          l.document.template.version,
          l.document.locale,
          'delivery:' + l.id,
        ],
      );
    },
    async attempt(tx, l) {
      await repo.fence(tx, l);
      await q(
        tx,
        'UPDATE email.delivery_work SET first_attempt_at=coalesce(first_attempt_at,clock_timestamp()) WHERE send_id=$1',
        [l.id],
      );
    },
    async release(tx, l, code) {
      await repo.fence(tx, l);
      await q(
        tx,
        'UPDATE email.delivery_work SET lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,30*failures)),last_error=$2,updated_at=clock_timestamp() WHERE send_id=$1',
        [l.id, code],
      );
    },
    async stop(tx, l, code) {
      await repo.fence(tx, l);
      const r = one(
        (
          await q(tx, 'SELECT dispatch_state,provider_key FROM email.email_sends WHERE id=$1', [
            l.id,
          ])
        ).rows,
      );
      const state = r.dispatch_state === 'scheduled' ? 'suppressed' : 'manual_review';
      await q(
        tx,
        'UPDATE email.email_sends SET dispatch_state=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',
        [l.id, state],
      );
      await q(
        tx,
        `INSERT INTO email.send_receipts(send_id,provider,provider_key_digest,payload_digest,outcome,last_reconciled_at) SELECT id,provider,$3,CASE WHEN payload_hash IS NULL THEN NULL ELSE decode(payload_hash,'hex') END,$2,clock_timestamp() FROM email.email_sends WHERE id=$1 ON CONFLICT(send_id) DO UPDATE SET outcome=excluded.outcome,last_reconciled_at=clock_timestamp(),updated_at=clock_timestamp(),revision=send_receipts.revision+1`,
        [l.id, state, createHash('sha256').update(text(r.provider_key)).digest()],
      );
      await repo.release(tx, l, code);
    },
    async recover(tx, l) {
      await repo.fence(tx, l);
      const r = (
        await q(
          tx,
          "SELECT id FROM email.send_attempts WHERE send_id=$1 AND outcome='in_progress' ORDER BY attempt_no DESC LIMIT 1",
          [l.id],
        )
      ).rows[0];
      return r ? { attemptId: rid('send_attempt', r.id), revision: l.send.revision } : null;
    },
    async invalidate(tx, id, includeOffers) {
      await q(
        tx,
        `UPDATE privacy.verification_challenges SET invalidated_at=coalesce(invalidated_at,clock_timestamp()) WHERE used_at IS NULL AND id IN(SELECT verification_id FROM email.delivery_snapshots WHERE send_id=$1 UNION ALL SELECT offers_verification_id FROM email.delivery_snapshots WHERE send_id=$1 AND $2::boolean)`,
        [id, includeOffers],
      );
    },
    async pending(tx) {
      return (
        await q(
          tx,
          `SELECT w.send_id FROM email.delivery_work w JOIN email.email_sends s ON s.id=w.send_id WHERE s.dispatch_state IN ('scheduled','dispatching','uncertain') AND s.send_after<=clock_timestamp() AND w.next_attempt_at<=clock_timestamp() AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp()) ORDER BY w.next_attempt_at,w.send_id LIMIT 20`,
        )
      ).rows.map((r) => rid('send', r.send_id));
    },
  };
  return guarded(s, repo);
}
