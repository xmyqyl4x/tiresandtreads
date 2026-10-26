import { createHash } from 'node:crypto';
import type { DeliveryRepository } from '../../../application/src/ports/delivery.ts';
import type { Send, SendState } from '../../../application/src/ports/private-records.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import {
  hex,
  integer,
  lockSubjects,
  one,
  ownerGuard,
  reportGuard,
  rev,
  rid,
  stamp,
  text,
  type Row,
} from './private-values.ts';

import { reject } from './bounds.ts';
const columns =
  'id,revision,dispatch_state,owner_subject_id,recipient_contact_id,report_id,report_version,comparison_revision,provider,provider_key,send_after,cancel_deadline,template_id,payload_asset_id,payload_hash';
function send(x: Row): Send {
  if (
    ![
      'scheduled',
      'cancelled',
      'suppressed',
      'dispatching',
      'accepted',
      'uncertain',
      'failed',
      'manual_review',
    ].includes(String(x.dispatch_state))
  )
    return stop('integrity');
  return {
    id: rid('send', x.id),
    revision: rev(x.revision),
    state: x.dispatch_state as SendState,
    ownerId: x.owner_subject_id === null ? null : rid('subject', x.owner_subject_id),
    contactId: x.recipient_contact_id === null ? null : rid('contact', x.recipient_contact_id),
    reportId: x.report_id === null ? null : rid('report', x.report_id),
    reportVersion: x.report_version === null ? null : integer(x.report_version),
    comparisonRevision: x.comparison_revision === null ? null : rev(x.comparison_revision),
    provider: text(x.provider),
    providerKey: text(x.provider_key),
    sendAfter: stamp(x.send_after),
    cancelDeadline: stamp(x.cancel_deadline),
    templateId: rid('template', x.template_id),
    payloadAssetId: x.payload_asset_id === null ? null : rid('asset', x.payload_asset_id),
    payloadHash: x.payload_hash === null ? null : hex(x.payload_hash).toString('hex'),
  };
}
export function createDeliveryRepository(scope: WriteScope): DeliveryRepository {
  const q = scope.query;
  async function lock(tx: Tx, id: string) {
    const ref = (
      await q(
        tx,
        'SELECT s.owner_subject_id,c.subject_id FROM email.email_sends s LEFT JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=$1',
        [id],
      )
    ).rows[0];
    if (!ref) return stop('not_found');
    await lockSubjects(
      scope,
      tx,
      [ref.owner_subject_id, ref.subject_id].filter((x): x is string => typeof x === 'string'),
    );
    return one(
      (
        await q(
          tx,
          `SELECT ${columns},kind,anonymized_at FROM email.email_sends WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows,
    );
  }
  async function receipt(tx: Tx, s: Send, outcome: string) {
    await q(
      tx,
      `INSERT INTO email.send_receipts(send_id,provider,provider_key_digest,payload_digest,outcome,last_reconciled_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())
      ON CONFLICT(send_id) DO UPDATE SET outcome=excluded.outcome,last_reconciled_at=excluded.last_reconciled_at,revision=send_receipts.revision+1,updated_at=clock_timestamp()`,
      [
        s.id,
        s.provider,
        createHash('sha256').update(s.providerKey).digest(),
        s.payloadHash ? hex(s.payloadHash) : null,
        outcome,
      ],
    );
  }
  const repo: DeliveryRepository = {
    async schedule(tx, i) {
      const c = one(
        (
          await q(tx, "SELECT subject_id FROM privacy.contacts WHERE id=$1 AND status='active'", [
            i.contactId,
          ])
        ).rows,
      );
      await lockSubjects(scope, tx, [i.owner.subjectId, rid('subject', c.subject_id)]);
      await ownerGuard(scope, tx, i.owner);
      if (i.reportId) await reportGuard(scope, tx, i.owner, i.reportId);
      if (
        !Number.isInteger(i.delaySeconds) ||
        i.delaySeconds < 60 ||
        i.delaySeconds > 604800 ||
        i.purposes.length > 8
      )
        reject();
      const t = await q(
        tx,
        "SELECT id FROM email.template_versions WHERE id=$1 AND status='published' AND purpose=$2",
        [i.templateId, i.kind === 'confirmation' ? 'necessary' : i.kind],
      );
      if (!t.rows.length) stop('conflict');
      const r = await q(
        tx,
        `INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,report_id,report_version,comparison_revision,template_id,send_after,cancel_deadline,provider_key,provider,requested_purposes,notice_id,dispatch_policy_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+$9*interval '1 second',now()+$9*interval '1 second',$10,$11,$12,$13,$14) RETURNING ${columns}`,
        [
          i.id,
          i.kind,
          i.contactId,
          i.owner.subjectId,
          i.reportId,
          i.reportVersion,
          i.comparisonRevision?.toString() ?? null,
          i.templateId,
          i.delaySeconds,
          i.providerKey,
          i.provider,
          JSON.stringify(i.purposes),
          i.noticeId,
          i.policyVersion,
        ],
      );
      return send(one(r.rows));
    },
    async owned(tx, owner, id) {
      await ownerGuard(scope, tx, owner);
      const r = await q(
        tx,
        `SELECT ${columns} FROM email.email_sends WHERE id=$1 AND owner_subject_id=$2 AND anonymized_at IS NULL`,
        [id, owner.subjectId],
      );
      return r.rows[0] ? send(r.rows[0]) : null;
    },
    async cancel(tx, owner, id, expected) {
      const x = await lock(tx, id);
      await ownerGuard(scope, tx, owner);
      if (x.owner_subject_id !== owner.subjectId) stop('not_found');
      const r = await q(
        tx,
        `UPDATE email.email_sends SET dispatch_state='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND dispatch_state='scheduled' AND clock_timestamp()<cancel_deadline RETURNING ${columns}`,
        [id, expected.toString()],
      );
      const s = send(one(r.rows));
      await receipt(tx, s, 'cancelled');
      return s;
    },
    async claim(tx, i) {
      const x = await lock(tx, i.id);
      if (
        x.anonymized_at !== null ||
        rev(x.revision) !== i.expected ||
        x.dispatch_state !== 'scheduled'
      )
        stop('conflict');
      const c = await q(
        tx,
        `SELECT c.id FROM privacy.contacts c JOIN app.subjects s ON s.id=c.subject_id JOIN app.subjects owner ON owner.id=$7
        JOIN privacy.consent_state p ON p.subject_id=s.id AND p.purpose=$4 AND p.scope_key=$5
        WHERE c.id=$1 AND s.id=$2 AND s.permission_revision=$3 AND s.status='active' AND c.status='active' AND owner.status='active'
        AND (c.verified_at IS NOT NULL OR $4='necessary')
        AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp()) AND (owner.expires_at IS NULL OR owner.expires_at>clock_timestamp())
        AND p.status='confirmed' AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp())
        AND NOT EXISTS(SELECT 1 FROM privacy.suppressions z WHERE z.lifted_at IS NULL AND z.subject_id=s.id AND z.scope_key=ANY($6::text[]) AND z.effective_at<=clock_timestamp() AND (z.expires_at IS NULL OR z.expires_at>clock_timestamp()))
        AND NOT EXISTS(SELECT 1 FROM privacy.contact_lookups l JOIN privacy.suppression_tombstones z ON z.key_version=l.key_version AND z.lookup_hmac=l.email_hmac WHERE l.contact_id=c.id AND z.scope_key=ANY($6::text[]) AND z.effective_at<=clock_timestamp() AND (z.expires_at IS NULL OR z.expires_at>clock_timestamp()))`,
        [
          x.recipient_contact_id,
          i.recipientSubjectId,
          i.permissionRevision.toString(),
          i.purpose,
          text(i.scope),
          [
            'all-email',
            ...(i.purpose === 'offers' || i.purpose === 'lifecycle' ? ['all-marketing'] : []),
            i.purpose,
            i.scope,
          ],
          x.owner_subject_id,
        ],
      );
      if (!c.rows.length || i.purpose !== (x.kind === 'confirmation' ? 'necessary' : x.kind))
        stop('forbidden');
      if (x.report_id !== null) {
        const live = await q(
          tx,
          "SELECT id FROM app.reports WHERE id=$1 AND status='active' AND expires_at>clock_timestamp()",
          [x.report_id],
        );
        if (!live.rows.length) stop('forbidden');
      }
      const asset = await q(
        tx,
        "SELECT id FROM app.object_assets WHERE id=$1 AND purpose='email_payload' AND state='ready' AND sha256=$2 AND (expires_at IS NULL OR expires_at>clock_timestamp())",
        [i.payloadAssetId, hex(i.payloadHash).toString('hex')],
      );
      if (!asset.rows.length) stop('conflict');
      const r = await q(
        tx,
        `UPDATE email.email_sends SET dispatch_state='dispatching',claimed_at=clock_timestamp(),payload_asset_id=$3,payload_hash=$4,authorized_consent_revision=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND send_after<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) RETURNING ${columns}`,
        [
          i.id,
          i.expected.toString(),
          i.payloadAssetId,
          i.payloadHash,
          i.permissionRevision.toString(),
        ],
      );
      const s = send(one(r.rows));
      const a = await q(
        tx,
        "INSERT INTO email.send_attempts(send_id,attempt_no,started_at,outcome) VALUES($1,1,clock_timestamp(),'in_progress') RETURNING id",
        [i.id],
      );
      return { send: s, attemptId: rid('send_attempt', one(a.rows).id) };
    },
    async finish(tx, i) {
      const x = await lock(tx, i.id);
      if (rev(x.revision) !== i.expected || x.dispatch_state !== 'dispatching') stop('conflict');
      const state = {
        accepted: 'accepted',
        definitive_rejection: 'failed',
        uncertain: 'uncertain',
      }[i.outcome];
      if (!state) reject();
      one(
        (
          await q(
            tx,
            "UPDATE email.send_attempts SET outcome=$3,finished_at=clock_timestamp(),provider_request_id=$4,error_code=$5 WHERE id=$1 AND send_id=$2 AND outcome='in_progress' RETURNING id",
            [i.attemptId, i.id, i.outcome, i.providerMessageId, i.errorCode],
          )
        ).rows,
      );
      const s = send(
        one(
          (
            await q(
              tx,
              `UPDATE email.email_sends SET dispatch_state=$2,accepted_at=CASE WHEN $2='accepted' THEN clock_timestamp() ELSE NULL END,provider_message_id=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
              [i.id, state, i.providerMessageId],
            )
          ).rows,
        ),
      );
      await receipt(tx, s, i.outcome);
      return s;
    },
    async receipt(tx, id) {
      const r = await q(
        tx,
        'SELECT outcome,provider,provider_key_digest,payload_digest FROM email.send_receipts WHERE send_id=$1',
        [id],
      );
      const x = r.rows[0];
      if (!x) return null;
      if (
        !Buffer.isBuffer(x.provider_key_digest) ||
        (x.payload_digest !== null && !Buffer.isBuffer(x.payload_digest))
      )
        return stop('integrity');
      return {
        outcome: text(x.outcome),
        provider: text(x.provider),
        providerKeyDigest: x.provider_key_digest.toString('hex'),
        payloadDigest: x.payload_digest === null ? null : x.payload_digest.toString('hex'),
      };
    },
  };
  return guarded(scope, repo);
}
