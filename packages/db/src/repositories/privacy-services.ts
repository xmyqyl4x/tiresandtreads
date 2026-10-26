import type {
  PrivacyServiceRepository,
  PrivacyLease,
  RightsStatus,
  PrivacyStage,
} from '../../../application/src/ports/privacy-services.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import type { AssetLocation } from '../../../application/src/ports/assets.ts';
import { rightsPolicy, type RightsKind } from '../../../domain/src/privacy-policy.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { hex, keyJson, one, rid, rev, stamp, text, type Row } from './private-values.ts';
import {
  reportIds,
  contactIds,
  sendIds,
  assetIds,
  refs,
  rootRow,
  subjectGuard,
  held,
  restrictGraph,
  eraseSends,
  eraseReport,
  eraseIdentity,
} from './privacy-graph.ts';
const stages: readonly PrivacyStage[] = ['journal', 'email', 'objects', 'analytics', 'sql'];
function status(x: Row): RightsStatus {
  return {
    id: rid('privacy_request', x.id),
    kind: x.kind as RightsKind,
    status: text(x.status),
    dueAt: stamp(x.due_at),
    completedAt: x.completed_at === null ? null : stamp(x.completed_at),
    error: x.last_error === null ? null : text(x.last_error),
  };
}
export function createPrivacyServiceRepository(
  s: WriteScope,
  bucket: string,
  assetKeys: readonly string[],
): PrivacyServiceRepository {
  text(bucket);
  if (!assetKeys.length || assetKeys.length > 4) return stop('invalid_input');
  const q = s.query;
  async function root(tx: Tx, id: string) {
    return one(
      (
        await q(
          tx,
          'SELECT r.*,w.* ,r.id AS id FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.id=$1',
          [id],
        )
      ).rows,
    );
  }
  async function fence(tx: Tx, l: PrivacyLease) {
    const row = await root(tx, l.id),
      r = rootRow(row);
    if (r.targetId) await subjectGuard(s, tx, r);
    one(
      (
        await q(
          tx,
          `SELECT request_id FROM privacy.request_work WHERE request_id=$1 AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp() FOR UPDATE`,
          [l.id, l.token, l.generation.toString()],
        )
      ).rows,
    );
    return row;
  }
  async function staff(tx: Tx, actor: string) {
    const allowed = (await q(tx, `SELECT 1 WHERE privacy.authorized_operator($1)`, [actor])).rows;
    if (!allowed.length) return stop('forbidden');
  }
  async function audit(tx: Tx, actor: string, action: string, evidence: string) {
    const row = one(
      (
        await q(
          tx,
          `INSERT INTO admin.audit_events(action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'privacy_request','succeeded',clock_timestamp(),$2,'["status","evidence"]') RETURNING id`,
          [action, hex(evidence).toString('hex')],
        )
      ).rows,
    );
    await q(tx, 'INSERT INTO admin.audit_identity_links(event_id,actor_staff_id) VALUES($1,$2)', [
      row.id,
      actor,
    ]);
  }
  const repo: PrivacyServiceRepository = {
    async resume(tx, keys) {
      const rows = (
        await q(
          tx,
          `SELECT r.id,w.proof_key_version,EXISTS(SELECT 1 FROM privacy.fulfillment_steps f WHERE f.request_id=r.id AND f.store='journal' AND f.status='completed') AS journaled FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON w.owner_key_version=k.key_version AND w.owner_request_hash=decode(k.digest,'hex') WHERE r.due_at+interval '30 days'>clock_timestamp() AND w.proof_hash IS NOT NULL`,
          [keyJson(keys)],
        )
      ).rows;
      if (rows.length > 1) return stop('integrity');
      const r = rows[0];
      return r
        ? {
            id: rid('privacy_request', r.id),
            proofVersion: text(r.proof_key_version),
            journaled: r.journaled === true,
          }
        : null;
    },
    async policy(tx, jurisdiction, version, kind) {
      const x = (
        await q(
          tx,
          'SELECT rule FROM privacy.retention_policies WHERE data_class=$3 AND jurisdiction=$1 AND version=$2 AND reviewed_at<=clock_timestamp()',
          [text(jurisdiction, 100), text(version, 100), 'rights:' + kind],
        )
      ).rows[0];
      return x ? rightsPolicy(x.rule) : null;
    },
    async contactSubject(tx, keys) {
      const rows = (
        await q(
          tx,
          `SELECT DISTINCT c.subject_id FROM privacy.contacts c JOIN privacy.contact_lookups l ON l.contact_id=c.id JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON l.key_version=k.key_version AND l.email_hmac=decode(k.digest,'hex')`,
          [keyJson(keys)],
        )
      ).rows;
      if (rows.length > 1) return stop('integrity');
      return rows[0] ? rid('subject', rows[0].subject_id) : null;
    },
    async create(tx, i) {
      if (i.subjectId)
        await subjectGuard(s, tx, {
          id: i.id,
          subjectId: i.subjectId,
          targetId: i.targetId,
          targetKind: i.targetKind,
          kind: i.kind,
        });
      await q(
        tx,
        `INSERT INTO privacy.privacy_requests(id,subject_id,kind,jurisdiction,policy_version,status,verified_at,due_at,encrypted_reply_context,key_version) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN clock_timestamp() END,$8,$9,$10)`,
        [
          i.id,
          i.subjectId,
          i.kind,
          i.jurisdiction,
          i.policyVersion,
          i.verified ? 'verified' : 'pending',
          i.verified,
          i.dueAt,
          i.reply ? hex(i.reply.hex, 16, 65536) : null,
          i.reply?.keyVersion ?? null,
        ],
      );
      await q(
        tx,
        `INSERT INTO privacy.request_work(request_id,target_kind,target_id,proof_hash,proof_key_version,proof_expires_at,policy,recovery_run_id,owner_key_version,owner_request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          i.id,
          i.targetKind,
          i.targetId,
          hex(i.proof.digest),
          i.proof.keyVersion,
          i.proofExpiresAt,
          JSON.stringify(i.policy),
          i.restoreRunId,
          i.ownerProof?.keyVersion ?? null,
          i.ownerProof ? hex(i.ownerProof.digest) : null,
        ],
      );
      for (const stage of ['access', 'export', 'correct'].includes(i.kind) ? ['operator'] : stages)
        await q(
          tx,
          "INSERT INTO privacy.fulfillment_steps(request_id,store,action,status) VALUES($1,$2,'fulfill','pending')",
          [i.id, stage],
        );
    },
    async bindContact(tx, id, key, keys) {
      const current = await repo.authorize(tx, id, key);
      if (current.status !== 'pending') return stop('conflict');
      const subject = await repo.contactSubject(tx, keys);
      if (subject)
        await subjectGuard(s, tx, {
          id,
          kind: current.kind,
          subjectId: subject,
          targetId: subject,
          targetKind: 'subject',
        });
      one(
        (
          await q(
            tx,
            `UPDATE privacy.privacy_requests SET subject_id=$2 WHERE id=$1 AND status='pending' RETURNING id`,
            [id, subject],
          )
        ).rows,
      );
      await q(tx, `UPDATE privacy.request_work SET target_id=$2 WHERE request_id=$1`, [
        id,
        subject,
      ]);
    },
    async authorize(tx, id, key) {
      const x = one(
        (
          await q(
            tx,
            `SELECT r.*,w.last_error FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.id=$1 AND w.proof_key_version=$2 AND w.proof_hash=$3 AND r.due_at+interval '30 days'>clock_timestamp()`,
            [id, key.keyVersion, hex(key.digest)],
          )
        ).rows,
      );
      return status(x);
    },
    async confirm(tx, id, key) {
      await repo.authorize(tx, id, key);
      const r = await root(tx, id);
      if (r.target_id !== null) await subjectGuard(s, tx, rootRow(r));
      one(
        (
          await q(
            tx,
            `UPDATE privacy.privacy_requests r SET status='verified',verified_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() FROM privacy.request_work w WHERE r.id=$1 AND w.request_id=r.id AND r.status='pending' AND w.proof_expires_at>clock_timestamp() AND w.notified_at IS NOT NULL RETURNING r.id`,
            [id],
          )
        ).rows,
      );
      await q(
        tx,
        "UPDATE privacy.request_work SET barrier_until=clock_timestamp()+interval '45 seconds' WHERE request_id=$1",
        [id],
      );
    },
    async notification(tx, id) {
      const x = (
        await q(
          tx,
          `SELECT r.encrypted_reply_context,r.key_version,w.proof_key_version FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.id=$1 AND r.status='pending' AND w.proof_expires_at>clock_timestamp() AND r.encrypted_reply_context IS NOT NULL`,
          [id],
        )
      ).rows[0];
      if (!x || !Buffer.isBuffer(x.encrypted_reply_context)) return null;
      return {
        envelope: {
          hex: x.encrypted_reply_context.toString('hex'),
          keyVersion: text(x.key_version),
        },
        keyVersion: text(x.proof_key_version),
      };
    },
    async notified(tx, id) {
      await q(
        tx,
        `UPDATE privacy.request_work SET notified_at=coalesce(notified_at,clock_timestamp()) WHERE request_id=$1`,
        [id],
      );
    },
    async journaled(tx, id, digest) {
      await q(
        tx,
        `UPDATE privacy.fulfillment_steps SET status='completed',evidence_digest=$2,revision=revision+1,updated_at=clock_timestamp() WHERE request_id=$1 AND store='journal' AND status<>'completed'`,
        [id, hex(digest).toString('hex')],
      );
    },
    async restrict(tx, id) {
      const x = await root(tx, id);
      if (x.verified_at === null) return stop('forbidden');
      if (['delete', 'restrict', 'opt_out'].includes(String(x.kind)))
        await restrictGraph(s, tx, rootRow(x));
    },
    async journal(tx, id) {
      const r = rootRow(await root(tx, id));
      return {
        kind: r.kind,
        targetKind: r.targetKind,
        targetId: r.targetId,
        policy: text((await root(tx, id)).policy_version),
        contacts: (
          await q(
            tx,
            `SELECT key_version,encode(email_hmac,'hex') AS digest FROM privacy.contact_lookups WHERE contact_id IN (${contactIds}) ORDER BY key_version,email_hmac`,
            refs(r),
          )
        ).rows.map((x) => ({ keyVersion: text(x.key_version), digest: text(x.digest) })),
      };
    },
    async lease(tx, id) {
      const x = await root(tx, id),
        r = rootRow(x),
        p = rightsPolicy(x.policy);
      if (!['verified', 'processing'].includes(String(x.status))) return null;
      if (r.targetId) await subjectGuard(s, tx, r);
      let error: string | null = null;
      if (['access', 'correct', 'export'].includes(r.kind)) error = 'operator_required';
      else if (await held(s, tx, r)) error = 'legal_hold';
      else if (Date.parse(stamp(x.due_at)) - Date.now() <= p.escalationDays * 86400000)
        await q(
          tx,
          "UPDATE privacy.request_work SET last_error='deadline_near' WHERE request_id=$1",
          [id],
        );
      if (error) {
        await q(
          tx,
          "UPDATE privacy.privacy_requests SET status='manual_review',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
        await q(tx, 'UPDATE privacy.request_work SET last_error=$2 WHERE request_id=$1', [
          id,
          error,
        ]);
        return null;
      }
      const row = (
        await q(
          tx,
          `UPDATE privacy.request_work SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '30 seconds' WHERE request_id=$1 AND next_attempt_at<=clock_timestamp() AND (barrier_until<=clock_timestamp() OR EXISTS(SELECT 1 FROM privacy.fulfillment_steps f WHERE f.request_id=privacy.request_work.request_id AND f.store='journal' AND f.status<>'completed')) AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING lease_token,lease_generation`,
          [id],
        )
      ).rows[0];
      if (!row) return null;
      await q(
        tx,
        "UPDATE privacy.privacy_requests SET status='processing',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
        [id],
      );
      return { id, token: rid('lease', row.lease_token), generation: rev(row.lease_generation) };
    },
    async stage(tx, l) {
      await fence(tx, l);
      const rows = (
        await q(
          tx,
          "SELECT store FROM privacy.fulfillment_steps WHERE request_id=$1 AND status<>'completed'",
          [l.id],
        )
      ).rows.map((x) => x.store);
      return stages.find((x) => rows.includes(x)) ?? null;
    },
    async finishStage(tx, l, stage, digest) {
      await fence(tx, l);
      one(
        (
          await q(
            tx,
            `UPDATE privacy.fulfillment_steps SET status='completed',evidence_digest=$3,attempts=attempts+1,revision=revision+1,updated_at=clock_timestamp() WHERE request_id=$1 AND store=$2 AND status<>'completed' RETURNING id`,
            [l.id, stage, hex(digest).toString('hex')],
          )
        ).rows,
      );
      await q(
        tx,
        "UPDATE privacy.request_work SET attempts=0,last_error=CASE WHEN last_error='deadline_near' THEN last_error END WHERE request_id=$1",
        [l.id],
      );
    },
    async email(tx, l) {
      const r = rootRow(await fence(tx, l));
      if (r.kind !== 'delete') return null;
      const x = (
        await q(
          tx,
          `SELECT e.id,e.provider,e.provider_message_id,e.provider_key,e.claimed_at FROM email.email_sends e WHERE e.id IN (${sendIds}) AND NOT EXISTS(SELECT 1 FROM privacy.erasure_receipts a WHERE a.request_id=$3 AND a.store='email' AND a.resource_id=e.id) ORDER BY e.id LIMIT 1`,
          [...refs(r), l.id],
        )
      ).rows[0];
      return x
        ? {
            id: text(x.id),
            provider: text(x.provider),
            messageId: x.provider_message_id === null ? null : text(x.provider_message_id),
            deliveryKey: text(x.provider_key),
            attempted: x.claimed_at !== null,
          }
        : null;
    },
    async asset(tx, l) {
      const r = rootRow(await fence(tx, l));
      if (r.kind !== 'delete') return null;
      const x = (
        await q(
          tx,
          `SELECT * FROM app.object_assets a WHERE id IN (${assetIds}) AND NOT EXISTS(SELECT 1 FROM privacy.erasure_receipts z WHERE z.request_id=$3 AND z.store='objects' AND z.resource_id=a.id) ORDER BY id LIMIT 1`,
          [...refs(r), l.id],
        )
      ).rows[0];
      if (!x) return null;
      if (x.bucket !== bucket || !assetKeys.includes(String(x.key_version)))
        return stop('forbidden');
      if (!['deleting', 'deleted'].includes(String(x.state))) return stop('conflict');
      return {
        id: rid('asset', x.id),
        revision: rev(x.revision),
        key: text(x.object_key),
        mime: text(x.mime_type),
        sha256: text(x.sha256),
        size: Number(x.size_bytes),
        version: x.object_version === null ? null : text(x.object_version),
        state: x.state as AssetLocation['state'],
      };
    },
    async receipt(tx, l, store, id, digest) {
      await fence(tx, l);
      if (store === 'objects')
        await q(
          tx,
          `UPDATE app.object_assets SET state='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND state='deleting'`,
          [id],
        );
      await q(
        tx,
        `INSERT INTO privacy.erasure_receipts(request_id,store,resource_id,evidence_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [l.id, store, id, hex(digest).toString('hex')],
      );
    },
    async analytics(tx, l) {
      const r = rootRow(await fence(tx, l));
      if (!r.targetId || r.targetKind !== 'subject') return true;
      const rows = (
        await q(
          tx,
          `DELETE FROM analytics.events WHERE id IN (SELECT id FROM analytics.events WHERE subject_id=$1 ORDER BY id LIMIT 250) RETURNING id,event_day::text AS event_day,received_at`,
          [r.targetId],
        )
      ).rows;
      if (rows.length) {
        for (const row of rows)
          await q(
            tx,
            `INSERT INTO analytics.replay_barriers(event_id,expires_at) VALUES($1,$2::timestamptz+interval '25 hours') ON CONFLICT DO NOTHING`,
            [row.id, row.received_at],
          );
        await q(tx, 'SELECT analytics.invalidate_days($1::date[],true)', [
          [...new Set(rows.map((x) => String(x.event_day)))].sort(),
        ]);
      }
      return rows.length === 0;
    },
    async erase(tx, l) {
      const r = rootRow(await fence(tx, l));
      if (r.kind !== 'delete' || !r.targetId) return true;
      if (await held(s, tx, r)) return stop('forbidden');
      if (await eraseSends(s, tx, r)) return false;
      const report = (await q(tx, `SELECT id FROM (${reportIds}) x ORDER BY id LIMIT 1`, refs(r)))
        .rows[0];
      if (report) {
        await q(tx, 'DELETE FROM app.idempotency_requests WHERE resource_id=$1', [report.id]);
        await eraseReport(s, tx, text(report.id));
        return false;
      }
      await eraseIdentity(s, tx, r);
      return true;
    },
    async complete(tx, l) {
      await fence(tx, l);
      if (await repo.stage(tx, l)) return stop('conflict');
      await q(
        tx,
        `UPDATE privacy.privacy_requests SET status='completed',subject_id=NULL,completed_at=clock_timestamp(),encrypted_reply_context=NULL,key_version=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [l.id],
      );
      await q(
        tx,
        'UPDATE privacy.request_work SET target_id=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE request_id=$1',
        [l.id],
      );
      await q(tx, 'DELETE FROM privacy.erasure_receipts WHERE request_id=$1', [l.id]);
    },
    async failed(tx, l, error) {
      const x = await fence(tx, l),
        p = rightsPolicy(x.policy);
      const manual = error === 'downstream_unconfirmed' || Number(x.attempts) + 1 >= p.maxAttempts;
      await q(
        tx,
        `UPDATE privacy.request_work SET attempts=attempts+1,lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '30 seconds',last_error=$2 WHERE request_id=$1`,
        [l.id, error],
      );
      if (manual)
        await q(
          tx,
          "UPDATE privacy.privacy_requests SET status='manual_review',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
          [l.id],
        );
    },
    async release(tx, l) {
      await fence(tx, l);
      await q(
        tx,
        'UPDATE privacy.request_work SET lease_token=NULL,lease_until=NULL WHERE request_id=$1',
        [l.id],
      );
    },
    async queue(tx) {
      // Pending email proofs also surface for durable, idempotent notification dispatch.
      return (
        await q(
          tx,
          `SELECT r.*,w.last_error FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.status IN ('pending','verified','processing','manual_review') ORDER BY r.due_at,r.id LIMIT 100`,
        )
      ).rows.map(status);
    },
    async ready(tx, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return stop('invalid_input');
      return (
        await q(
          tx,
          `SELECT r.id FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE r.status IN ('verified','processing') AND w.next_attempt_at<=clock_timestamp() AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp()) AND (w.barrier_until<=clock_timestamp() OR EXISTS(SELECT 1 FROM privacy.fulfillment_steps f WHERE f.request_id=r.id AND f.store='journal' AND f.status<>'completed')) ORDER BY w.next_attempt_at,r.id LIMIT $1`,
          [limit],
        )
      ).rows.map((r) => rid('privacy_request', r.id));
    },
    async notifications(tx, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return stop('invalid_input');
      return (
        await q(
          tx,
          `SELECT r.id FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE r.status='pending' AND w.notified_at IS NULL AND w.proof_expires_at>clock_timestamp() AND r.encrypted_reply_context IS NOT NULL ORDER BY w.proof_expires_at,r.id LIMIT $1`,
          [limit],
        )
      ).rows.map((r) => rid('privacy_request', r.id));
    },
    async retry(tx, actor, id, evidence) {
      await staff(tx, actor);
      const x = await root(tx, id);
      if (x.status !== 'manual_review' || (await held(s, tx, rootRow(x)))) return stop('conflict');
      await q(
        tx,
        "UPDATE privacy.privacy_requests SET status='verified',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
        [id],
      );
      await q(
        tx,
        'UPDATE privacy.request_work SET attempts=0,next_attempt_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,last_error=NULL WHERE request_id=$1',
        [id],
      );
      await q(
        tx,
        "UPDATE privacy.fulfillment_steps SET evidence_digest=$2,revision=revision+1,updated_at=clock_timestamp() WHERE request_id=$1 AND status<>'completed'",
        [id, hex(evidence).toString('hex')],
      );
      await audit(tx, actor, 'privacy.retry', evidence);
    },
    async review(tx, actor, id, decision, evidence) {
      await staff(tx, actor);
      await q(tx, 'SELECT id FROM privacy.privacy_requests WHERE id=$1 FOR UPDATE', [id]);
      const x = await root(tx, id);
      if (
        x.status !== 'manual_review' ||
        x.verified_at === null ||
        !['access', 'export', 'correct'].includes(String(x.kind)) ||
        !['fulfilled', 'rejected'].includes(decision)
      )
        return stop('forbidden');
      await q(
        tx,
        `UPDATE privacy.fulfillment_steps SET status=$2,evidence_digest=$3,revision=revision+1,updated_at=clock_timestamp() WHERE request_id=$1 AND store='operator'`,
        [
          id,
          decision === 'fulfilled' ? 'completed' : 'manual_review',
          hex(evidence).toString('hex'),
        ],
      );
      await q(
        tx,
        `UPDATE privacy.privacy_requests SET status=$2,completed_at=CASE WHEN $2='completed' THEN clock_timestamp() END,subject_id=NULL,encrypted_reply_context=NULL,key_version=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [id, decision === 'fulfilled' ? 'completed' : 'rejected'],
      );
      await q(
        tx,
        'UPDATE privacy.request_work SET target_id=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE request_id=$1',
        [id],
      );
      await audit(tx, actor, 'privacy.manual_' + decision, evidence);
    },
    async retention(tx, _dryRun, version, jurisdiction) {
      if (!(await repo.policy(tx, jurisdiction, version, 'delete'))) return stop('forbidden');
      const rows = (
        await q(
          tx,
          `SELECT 'subject' AS kind,id,id AS subject_id FROM app.subjects s WHERE expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE w.target_kind='subject' AND w.target_id=s.id AND r.status<>'completed') UNION ALL SELECT 'report',id,owner_subject_id FROM app.reports p WHERE expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE w.target_kind='report' AND w.target_id=p.id AND r.status<>'completed') ORDER BY kind,id LIMIT 25`,
        )
      ).rows;
      return rows.map((x) => ({
        kind: x.kind as 'subject' | 'report',
        id: text(x.id),
        subjectId: rid('subject', x.subject_id),
      }));
    },
    async cleanup(tx, dryRun) {
      const counts: Record<string, number> = {};
      // Fixed statements only. Each pass is bounded; no executable policy expressions.
      for (const [table, condition] of [
        ['app.report_drafts', 'expires_at<=clock_timestamp()'],
        ['privacy.quote_private_data', 'expires_at<=clock_timestamp()'],
        ['privacy.cookie_consents', 'expires_at<=clock_timestamp()'],
        [
          'privacy.verification_challenges',
          `expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM privacy.contact_intents i WHERE i.challenge_id=t.id)`,
        ],
        ['analytics.replay_barriers', 'expires_at<=clock_timestamp()'],
        [
          'app.idempotency_requests',
          `expires_at<=clock_timestamp() AND state IN ('completed','expired')`,
        ],
      ] as const) {
        const key =
          table === 'privacy.quote_private_data'
            ? 'quote_id'
            : table === 'analytics.replay_barriers'
              ? 'event_id'
              : table === 'app.report_drafts'
                ? 'report_id'
                : 'id';
        const selected = `SELECT ${key} FROM ${table} t WHERE ${condition} ORDER BY ${key} LIMIT 100`;
        counts[table] = (
          await q(
            tx,
            dryRun
              ? `SELECT ${key} FROM (${selected}) x`
              : `DELETE FROM ${table} WHERE ${key} IN (${selected}) RETURNING ${key}`,
          )
        ).rows.length;
      }
      const expired = (
        await q(
          tx,
          `SELECT r.id FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.status='pending' AND w.proof_expires_at<=clock_timestamp() ORDER BY r.id LIMIT 100`,
        )
      ).rows;
      counts.expiredProofs = expired.length;
      if (!dryRun)
        for (const x of expired) {
          await q(
            tx,
            `UPDATE privacy.privacy_requests SET status='rejected',subject_id=NULL,encrypted_reply_context=NULL,key_version=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
            [x.id],
          );
          await q(
            tx,
            'UPDATE privacy.request_work SET target_id=NULL,proof_hash=NULL WHERE request_id=$1',
            [x.id],
          );
          await q(
            tx,
            `UPDATE app.outbox SET state='cancelled',published_at=NULL,lease_token=NULL,lease_until=NULL,lease_owner=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE aggregate_kind='privacy_request' AND aggregate_id=$1`,
            [x.id],
          );
        }
      const receipts = (
        await q(
          tx,
          `SELECT w.request_id FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE r.due_at+interval '30 days'<=clock_timestamp() AND w.proof_hash IS NOT NULL ORDER BY w.request_id LIMIT 100`,
        )
      ).rows;
      counts.expiredStatusReceipts = receipts.length;
      if (!dryRun)
        for (const row of receipts)
          await q(
            tx,
            'UPDATE privacy.request_work SET proof_hash=NULL,owner_key_version=NULL,owner_request_hash=NULL WHERE request_id=$1',
            [row.request_id],
          );
      return counts;
    },
    async replayMarkers(tx, entries) {
      for (const e of entries) {
        for (const k of e.markers)
          await q(
            tx,
            `INSERT INTO privacy.deletion_markers(resource_kind,key_version,resource_key_hmac,deleted_at,policy_version) VALUES($1,$2,$3,clock_timestamp(),$4) ON CONFLICT DO NOTHING`,
            [e.resourceKind + ':' + e.action, k.keyVersion, hex(k.digest), e.policy],
          );
        for (const k of e.tombstones)
          for (const scope of e.action === 'opt_out'
            ? ['all-marketing', 'analytics', 'ads', 'targeted_ads', 'identity_sharing']
            : [
                'all-email',
                'all-marketing',
                'analytics',
                'ads',
                'targeted_ads',
                'identity_sharing',
              ])
            await q(
              tx,
              `INSERT INTO privacy.suppression_tombstones(key_version,lookup_hmac,scope_key,reason_code,effective_at,review_after) VALUES($1,$2,$3,'privacy_request',clock_timestamp(),clock_timestamp()+interval '1 year') ON CONFLICT DO NOTHING`,
              [k.keyVersion, hex(k.digest), scope],
            );
      }
    },
    async restoreStart(tx, id, backupAt, expected) {
      await q(
        tx,
        `INSERT INTO privacy.recovery_runs(id,backup_finished_at,expected_digest) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, backupAt, hex(expected).toString('hex')],
      );
      const r = one((await q(tx, 'SELECT * FROM privacy.recovery_runs WHERE id=$1', [id])).rows);
      if (stamp(r.backup_finished_at) !== backupAt || r.expected_digest !== expected)
        return stop('conflict');
    },
    async restorePage(tx, id) {
      const r = one(
        (await q(tx, 'SELECT * FROM privacy.recovery_runs WHERE id=$1 FOR UPDATE', [id])).rows,
      );
      if (r.scan_complete) return [];
      return (
        await q(
          tx,
          `SELECT * FROM (SELECT 'subject' AS kind,id,id AS subject_id,'subject:'||id AS key FROM app.subjects UNION ALL SELECT 'report',id,owner_subject_id,'report:'||id FROM app.reports) x WHERE ($1::text IS NULL OR key>$1) ORDER BY key LIMIT 100`,
          [r.cursor_key],
        )
      ).rows.map((x) => ({
        kind: x.kind as 'subject' | 'report',
        id: text(x.id),
        subjectId: rid('subject', x.subject_id),
      }));
    },
    async markedAction(tx, kind, keys) {
      const rows = (
        await q(
          tx,
          `SELECT resource_kind FROM privacy.deletion_markers m JOIN jsonb_to_recordset($2::jsonb) k(key_version text,digest text) ON m.key_version=k.key_version AND m.resource_key_hmac=decode(k.digest,'hex') WHERE m.resource_kind IN ($1||':delete',$1||':restrict',$1||':opt_out') AND (expires_at IS NULL OR expires_at>clock_timestamp())`,
          [kind, keyJson(keys)],
        )
      ).rows.map((x) => String(x.resource_kind).split(':')[1]);
      return rows.includes('delete')
        ? 'delete'
        : rows.includes('restrict')
          ? 'restrict'
          : rows.includes('opt_out')
            ? 'opt_out'
            : null;
    },
    async restoreProgress(tx, id, cursor) {
      await q(
        tx,
        `UPDATE privacy.recovery_runs SET cursor_key=coalesce($2,cursor_key),scan_complete=($2::text IS NULL),state='fulfilling',updated_at=clock_timestamp() WHERE id=$1 AND state<>'ready'`,
        [id, cursor],
      );
      const pending = (
        await q(
          tx,
          `SELECT 1 FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE w.recovery_run_id=$1 AND r.status NOT IN ('completed','rejected') LIMIT 1`,
          [id],
        )
      ).rows.length;
      const r = (
        await q(
          tx,
          `UPDATE privacy.recovery_runs SET state='ready',updated_at=clock_timestamp() WHERE id=$1 AND scan_complete AND NOT $2 RETURNING id`,
          [id, Boolean(pending)],
        )
      ).rows;
      return r.length > 0;
    },
  };
  return guarded(s, repo);
}
