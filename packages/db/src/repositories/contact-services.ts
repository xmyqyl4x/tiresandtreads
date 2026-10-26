import type {
  ContactServiceRepository,
  ContactIntent,
} from '../../../application/src/ports/contact-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import {
  digestKeys,
  hex,
  keyJson,
  lockSubjects,
  one,
  ownerGuard,
  rid,
  stamp,
  text,
} from './private-values.ts';
import { createPrivacyRepository } from './privacy.ts';
import { browserPurposes, type BrowserPurpose } from '../../../domain/src/contact-policy.ts';
export function createContactServiceRepository(
  scope: WriteScope,
  versions: readonly string[],
): ContactServiceRepository {
  const q = scope.query,
    privacy = createPrivacyRepository(scope, versions);
  const repo: ContactServiceRepository = {
    async guard(tx, owner, id) {
      const c = await privacy.contact(tx, id);
      if (!c) return stop('not_found');
      await lockSubjects(scope, tx, [c.subjectId, ...(owner ? [owner.subjectId] : [])]);
      if (owner) await ownerGuard(scope, tx, owner);
      const live = await q(
        tx,
        "SELECT id FROM app.subjects WHERE id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>clock_timestamp())",
        [c.subjectId],
      );
      const current = await privacy.contact(tx, id);
      if (!live.rows.length || current?.status !== 'active') return stop('forbidden');
      return current;
    },
    async notice(tx, id, purpose, policy) {
      return (
        (
          await q(
            tx,
            'SELECT id FROM privacy.notices WHERE id=$1 AND purpose=$2 AND market_policy=$3 AND published_at<=clock_timestamp()',
            [id, purpose, text(policy, 100)],
          )
        ).rows.length === 1
      );
    },
    async intent(tx, id) {
      const ref = (
        await q(tx, 'SELECT contact_id FROM privacy.contact_intents WHERE challenge_id=$1', [id])
      ).rows[0];
      if (!ref) return null;
      await repo.guard(tx, null, rid('contact', ref.contact_id));
      const r = (
        await q(
          tx,
          `SELECT v.*,i.contact_id,i.owner_subject_id,i.scope_key,i.policy_version,i.grant_event_id,e.evidence_digest,
        v.expires_at>clock_timestamp() AS live FROM privacy.verification_challenges v JOIN privacy.contact_intents i ON i.challenge_id=v.id JOIN privacy.consent_events e ON e.id=i.grant_event_id WHERE v.id=$1 FOR UPDATE OF v`,
          [id],
        )
      ).rows[0]!;
      if (!['report', 'offers'].includes(String(r.purpose)) || !Buffer.isBuffer(r.token_hash))
        return stop('integrity');
      return {
        id,
        contactId: rid('contact', r.contact_id),
        subjectId: rid('subject', r.subject_id),
        ownerId: rid('subject', r.owner_subject_id),
        purpose: r.purpose as ContactIntent['purpose'],
        scope: text(r.scope_key),
        policyVersion: text(r.policy_version, 100),
        noticeId: rid('notice', r.notice_id),
        eventId: rid('consent_event', r.grant_event_id),
        permissionDigest: r.evidence_digest === null ? null : text(r.evidence_digest, 64),
        key: { keyVersion: text(r.key_version, 100), digest: r.token_hash.toString('hex') },
        expiresAt: stamp(r.expires_at),
        usedAt: r.used_at === null ? null : stamp(r.used_at),
        invalidated: r.invalidated_at !== null,
        live: r.live === true,
      };
    },
    async createIntent(tx, i) {
      await repo.guard(tx, null, i.contactId);
      one(
        (
          await q(
            tx,
            `SELECT c.id FROM privacy.contacts c JOIN privacy.subject_links l ON l.subject_id=c.subject_id JOIN privacy.consent_events e ON e.id=l.event_id WHERE c.id=$1 AND c.subject_id=$2 AND e.id=$3 AND e.purpose=$4 AND e.scope_key=$5 AND e.notice_id=$6 AND e.action='grant'`,
            [i.contactId, i.subjectId, i.eventId, i.purpose, i.scope, i.noticeId],
          )
        ).rows,
      );
      await q(
        tx,
        'INSERT INTO privacy.verification_challenges(id,subject_id,purpose,token_hash,key_version,notice_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          i.id,
          i.subjectId,
          i.purpose,
          hex(i.key.digest),
          text(i.key.keyVersion, 100),
          i.noticeId,
          i.expiresAt,
        ],
      );
      await q(
        tx,
        'INSERT INTO privacy.contact_intents(challenge_id,contact_id,owner_subject_id,scope_key,policy_version,grant_event_id) VALUES($1,$2,$3,$4,$5,$6)',
        [i.id, i.contactId, i.ownerId, text(i.scope), text(i.policyVersion, 100), i.eventId],
      );
    },
    async recordGrant(tx, i) {
      await lockSubjects(scope, tx, [i.subjectId]);
      await q(
        tx,
        "INSERT INTO privacy.consent_events(id,purpose,action,notice_id,policy_version,scope_key,occurred_at,method,evidence_digest) VALUES($1,$2,'grant',$3,$4,$5,clock_timestamp(),'explicit_request',$6)",
        [
          i.eventId,
          i.purpose,
          i.noticeId,
          text(i.policyVersion, 100),
          text(i.scope),
          hex(i.permissionDigest).toString('hex'),
        ],
      );
      await q(tx, 'INSERT INTO privacy.subject_links(event_id,subject_id) VALUES($1,$2)', [
        i.eventId,
        i.subjectId,
      ]);
    },
    async consume(tx, id) {
      one(
        (
          await q(
            tx,
            'UPDATE privacy.verification_challenges SET used_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>clock_timestamp() RETURNING id',
            [id],
          )
        ).rows,
      );
    },
    async invalidate(tx, subject, purpose, scopeKey) {
      await lockSubjects(scope, tx, [subject]);
      await q(
        tx,
        `UPDATE privacy.verification_challenges v SET invalidated_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 FROM privacy.contact_intents i WHERE i.challenge_id=v.id AND v.subject_id=$1 AND v.purpose=$2 AND i.scope_key=$3 AND v.used_at IS NULL AND v.invalidated_at IS NULL`,
        [subject, purpose, text(scopeKey)],
      );
    },
    async clearWithdrawal(tx, subject, scopeKey) {
      await lockSubjects(scope, tx, [subject]);
      await q(
        tx,
        "UPDATE privacy.suppressions SET lifted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE subject_id=$1 AND scope_key=$2 AND reason_code='withdrawn' AND lifted_at IS NULL",
        [subject, text(scopeKey)],
      );
    },
    async confirmationBlocked(tx, subject, scopes) {
      return (
        (
          await q(
            tx,
            `SELECT id FROM privacy.suppressions WHERE subject_id=$1 AND scope_key=ANY($2::text[]) AND lifted_at IS NULL AND effective_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND (reason_code<>'withdrawn' OR scope_key IN ('all-email','all-marketing')) LIMIT 1`,
            [subject, scopes],
          )
        ).rows.length > 0
      );
    },
    async currentPermission(tx, subject, purpose, scopeKey, notice, policy) {
      return (
        (
          await q(
            tx,
            `SELECT c.source_event_id FROM privacy.consent_state c JOIN privacy.consent_events e ON e.id=c.source_event_id WHERE c.subject_id=$1 AND c.purpose=$2 AND c.scope_key=$3 AND c.status='confirmed' AND c.policy_version=$5 AND e.notice_id=$4 AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())`,
            [subject, purpose, scopeKey, notice, policy],
          )
        ).rows.length === 1
      );
    },
    async tombstoned(tx, keys, scopes) {
      if (!scopes.length || scopes.length > 20) return stop('invalid_input');
      return (
        (
          await q(
            tx,
            `SELECT t.id FROM privacy.suppression_tombstones t JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON t.key_version=k.key_version AND t.lookup_hmac=decode(k.digest,'hex') WHERE t.scope_key=ANY($2::text[]) AND t.effective_at<=clock_timestamp() AND (t.expires_at IS NULL OR t.expires_at>clock_timestamp()) LIMIT 1`,
            [keyJson(keys), scopes.map((s) => text(s))],
          )
        ).rows.length > 0
      );
    },
    async tombstone(tx, keys, scopeKey, reason) {
      for (const k of digestKeys(keys))
        await q(
          tx,
          `INSERT INTO privacy.suppression_tombstones(key_version,lookup_hmac,scope_key,reason_code,effective_at,review_after) VALUES($1,decode($2,'hex'),$3,$4,clock_timestamp(),clock_timestamp()+interval '1 year') ON CONFLICT(key_version,lookup_hmac,scope_key) DO NOTHING`,
          [k.key_version, k.digest, text(scopeKey), text(reason, 100)],
        );
    },
    async contactKeys(tx, id) {
      return (
        await q(
          tx,
          'SELECT key_version,email_hmac FROM privacy.contact_lookups WHERE contact_id=$1 ORDER BY key_version',
          [id],
        )
      ).rows.map((x) => ({
        keyVersion: text(x.key_version, 100),
        digest: hex((x.email_hmac as Buffer).toString('hex')).toString('hex'),
      }));
    },
    async cookie(tx, owner, notice, policy, gpc, allowed, digest) {
      await ownerGuard(scope, tx, owner);
      await q(
        tx,
        `INSERT INTO privacy.cookie_consents(subject_id,notice_id,policy_version,gpc,allowed_purposes,receipt_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '180 days')`,
        [
          owner.subjectId,
          notice,
          text(policy, 100),
          gpc,
          JSON.stringify(allowed),
          hex(digest).toString('hex'),
        ],
      );
    },
    async browser(tx, owner, policy) {
      await ownerGuard(scope, tx, owner);
      const r = await q(
        tx,
        `SELECT purpose FROM privacy.consent_state WHERE subject_id=$1 AND scope_key='site' AND status='confirmed' AND policy_version=$2 AND expires_at>clock_timestamp()`,
        [owner.subjectId, policy],
      );
      return r.rows
        .map((x) => text(x.purpose))
        .filter((x): x is BrowserPurpose => browserPurposes.some((p) => p === x));
    },
  };
  return guarded(scope, repo);
}
