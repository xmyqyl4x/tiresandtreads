import type { EmailLink, EmailLinkRepository } from '../../../application/src/ports/mail-events.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { hex, lockSubjects, rid, stamp, text, type Row } from './private-values.ts';
export function createEmailLinkRepository(scope: WriteScope): EmailLinkRepository {
  const q = scope.query;
  async function live(tx: Tx, sendId: string) {
    const r = (
      await q(
        tx,
        `SELECT owner_subject_id,c.subject_id FROM email.email_sends s LEFT JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=$1`,
        [sendId],
      )
    ).rows[0];
    if (!r) return stop('not_found');
    await lockSubjects(
      scope,
      tx,
      [r.owner_subject_id, r.subject_id].filter((x): x is string => typeof x === 'string'),
    );
    const s = (
      await q(
        tx,
        `SELECT s.id FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id JOIN app.subjects p ON p.id=c.subject_id LEFT JOIN app.subjects o ON o.id=s.owner_subject_id LEFT JOIN app.reports r ON r.id=s.report_id WHERE s.id=$1 AND s.anonymized_at IS NULL AND c.status='active' AND p.status='active' AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp()) AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp()) AND (o.id IS NULL OR (o.status='active' AND (o.expires_at IS NULL OR o.expires_at>clock_timestamp()))) AND (r.id IS NULL OR (r.status='active' AND r.expires_at>clock_timestamp())) AND s.dispatch_state NOT IN ('cancelled','suppressed','failed') FOR UPDATE OF s`,
        [sendId],
      )
    ).rows;
    if (!s.length) return stop('forbidden');
  }
  function from(x: Row): EmailLink {
    if (x.purpose !== 'education' && x.purpose !== 'feedback') return stop('integrity');
    return {
      id: rid('email_link', x.id),
      sendId: rid('send', x.send_id),
      slot: text(x.slot),
      purpose: x.purpose,
      destination: text(x.approved_destination),
      key: {
        keyVersion: text(x.key_version),
        digest: hex((x.token_hash as Buffer).toString('hex')).toString('hex'),
      },
      expiresAt: stamp(x.expires_at),
    };
  }
  async function publicPage(tx: Tx, i: EmailLink) {
    if (i.purpose === 'education') {
      const path = new URL(i.destination).pathname;
      if (!(await q(tx, 'SELECT 1 FROM app.public_pages WHERE public_path=$1', [path])).rows.length)
        return stop('forbidden');
    }
  }
  const repo: EmailLinkRepository = {
    async issue(tx, i) {
      await live(tx, i.sendId);
      await publicPage(tx, i);
      await q(
        tx,
        `INSERT INTO email.email_links(id,send_id,slot,purpose,approved_destination,token_hash,key_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(send_id,slot) DO NOTHING`,
        [
          i.id,
          i.sendId,
          text(i.slot, 100),
          i.purpose,
          i.destination,
          hex(i.key.digest),
          i.key.keyVersion,
          i.expiresAt,
        ],
      );
      const old = (
        await q(tx, 'SELECT * FROM email.email_links WHERE send_id=$1 AND slot=$2', [
          i.sendId,
          i.slot,
        ])
      ).rows[0]!;
      const x = from(old);
      if (
        x.id !== i.id ||
        x.destination !== i.destination ||
        x.purpose !== i.purpose ||
        x.key.digest !== i.key.digest ||
        x.key.keyVersion !== i.key.keyVersion ||
        Date.parse(x.expiresAt) !== Date.parse(i.expiresAt) ||
        old.revoked_at !== null
      )
        return stop('conflict');
    },
    async resolve(tx, id, key) {
      const x = (
        await q(
          tx,
          'SELECT * FROM email.email_links WHERE id=$1 AND token_hash=$2 AND key_version=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
          [id, hex(key.digest), key.keyVersion],
        )
      ).rows[0];
      if (!x) return null;
      const link = from(x);
      await live(tx, link.sendId);
      await publicPage(tx, link);
      return link;
    },
    async feedback(tx, link, value) {
      if (
        !(await repo.resolve(tx, link.id, link.key)) ||
        link.purpose !== 'feedback' ||
        !['yes', 'no'].includes(value)
      )
        return stop('forbidden');
      await q(
        tx,
        `INSERT INTO email.email_feedback(send_id,kind,value,submitted_at) VALUES($1,'helpful',$2,clock_timestamp()) ON CONFLICT(send_id,kind) DO NOTHING`,
        [link.sendId, value],
      );
      const x = (
        await q(tx, "SELECT value FROM email.email_feedback WHERE send_id=$1 AND kind='helpful'", [
          link.sendId,
        ])
      ).rows[0]!;
      if (x.value !== value) return stop('conflict');
    },
    async revoke(tx, id) {
      const x = (await q(tx, 'SELECT send_id FROM email.email_links WHERE id=$1', [id])).rows[0];
      if (!x) return stop('not_found');
      await live(tx, text(x.send_id));
      await q(
        tx,
        'UPDATE email.email_links SET revoked_at=coalesce(revoked_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',
        [id],
      );
    },
  };
  return guarded(scope, repo);
}
