import type {
  PrivacyRepository,
  Permission,
  PrivacyResource,
} from '../../../application/src/ports/privacy.ts';
import type { Contact } from '../../../application/src/ports/private-records.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { cursor, nextCursor, pageLimit, reject } from './bounds.ts';
import {
  digestKeys,
  envelope,
  hex,
  keyJson,
  lockSubjects,
  one,
  reportGuard,
  rev,
  rid,
  stamp,
  text,
  type Row,
} from './private-values.ts';
import { stop } from './ingestion.ts';
const contactColumns = 'id,subject_id,revision,verified_at,status,encrypted_email,key_version';
function contact(row: Row): Contact {
  if (
    !Buffer.isBuffer(row.encrypted_email) ||
    !['active', 'restricted', 'pending_deletion'].includes(String(row.status))
  )
    return stop('integrity');
  return {
    id: rid('contact', row.id),
    subjectId: rid('subject', row.subject_id),
    revision: rev(row.revision),
    verifiedAt: row.verified_at === null ? null : stamp(row.verified_at),
    status: row.status as Contact['status'],
    envelope: { keyVersion: text(row.key_version, 100), hex: row.encrypted_email.toString('hex') },
  };
}
export const resourceQueries = {
  report: 'SELECT id FROM app.reports WHERE owner_subject_id=$1',
  session: 'SELECT id FROM app.owner_sessions WHERE subject_id=$1',
  contact: 'SELECT id FROM privacy.contacts WHERE subject_id=$1',
  send: 'SELECT s.id FROM email.email_sends s LEFT JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.owner_subject_id=$1 OR c.subject_id=$1',
  asset:
    'SELECT a.asset_id AS id FROM app.report_assets a JOIN app.reports r ON r.id=a.report_id WHERE r.owner_subject_id=$1',
  request: 'SELECT id FROM privacy.privacy_requests WHERE subject_id=$1',
} as const;
export function createPrivacyRepository(
  scope: WriteScope,
  lookupVersions: readonly string[],
): PrivacyRepository {
  if (
    !lookupVersions.length ||
    lookupVersions.length > 4 ||
    new Set(lookupVersions).size !== lookupVersions.length
  )
    reject();
  lookupVersions.forEach((v) => text(v, 100));
  const versions = [...lookupVersions].sort(),
    q = scope.query;
  const repo: PrivacyRepository = {
    async registerContact(tx, i) {
      const keys = digestKeys(i.keys);
      if (JSON.stringify(keys.map((k) => k.key_version).sort()) !== JSON.stringify(versions))
        reject();
      // During rotation every caller supplies the configured overlap, so contenders share a lock.
      for (const k of [...keys].sort((a, b) =>
        a.key_version + ':' + a.digest < b.key_version + ':' + b.digest ? -1 : 1,
      ))
        await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'contact:' + k.key_version + ':' + k.digest,
        ]);
      const found = (
        await q(
          tx,
          `SELECT DISTINCT c.id,c.subject_id FROM privacy.contacts c JOIN privacy.contact_lookups l ON l.contact_id=c.id JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON l.key_version=k.key_version AND l.email_hmac=decode(k.digest,'hex')`,
          [JSON.stringify(keys)],
        )
      ).rows;
      if (found.length > 1) stop('integrity');
      const existing = found[0];
      const contactId = existing ? rid('contact', existing.id) : i.id,
        subjectId = existing ? rid('subject', existing.subject_id) : i.subjectId;
      if (existing) await lockSubjects(scope, tx, [subjectId, ...(i.guardSubjects ?? [])]);
      else {
        await q(tx, "INSERT INTO app.subjects(id,kind,status) VALUES($1,'contact','active')", [
          subjectId,
        ]);
        await q(
          tx,
          "INSERT INTO privacy.contacts(id,subject_id,encrypted_email,key_version,status) VALUES($1,$2,$3,$4,'active')",
          [contactId, subjectId, envelope(i.envelope), i.envelope.keyVersion],
        );
      }
      if (!existing && i.guardSubjects?.length) await lockSubjects(scope, tx, i.guardSubjects);
      const current = await repo.contact(tx, contactId);
      if (!current || current.status !== 'active') return stop('forbidden');
      for (const k of keys) {
        await q(
          tx,
          'INSERT INTO privacy.contact_lookups(key_version,email_hmac,contact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [k.key_version, hex(k.digest), contactId],
        );
        const matched = await q(
          tx,
          'SELECT contact_id FROM privacy.contact_lookups WHERE key_version=$1 AND email_hmac=$2 AND contact_id=$3',
          [k.key_version, hex(k.digest), contactId],
        );
        if (!matched.rows.length) stop('integrity');
      }
      return current;
    },
    async contact(tx, id) {
      const r = await q(tx, `SELECT ${contactColumns} FROM privacy.contacts WHERE id=$1`, [id]);
      return r.rows[0] ? contact(r.rows[0]) : null;
    },
    async confirmContact(tx, id, expected) {
      const current = await repo.contact(tx, id);
      if (!current) return stop('not_found');
      await lockSubjects(scope, tx, [current.subjectId]);
      const r = await q(
        tx,
        `UPDATE privacy.contacts SET verified_at=coalesce(verified_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND status='active' RETURNING ${contactColumns}`,
        [id, expected.toString()],
      );
      return contact(one(r.rows));
    },
    async rotateContact(tx, id, expected, e) {
      const current = await repo.contact(tx, id);
      if (!current) return stop('not_found');
      await lockSubjects(scope, tx, [current.subjectId]);
      const r = await q(
        tx,
        `UPDATE privacy.contacts SET encrypted_email=$3,key_version=$4,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND status='active' RETURNING ${contactColumns}`,
        [id, expected.toString(), envelope(e), e.keyVersion],
      );
      return contact(one(r.rows));
    },
    async permission(tx, subjectId, purpose, scopeKey) {
      const r = await q(
        tx,
        `SELECT s.permission_revision,c.status,c.source_event_id,c.expires_at,(c.expires_at<=clock_timestamp()) AS expired FROM app.subjects s LEFT JOIN privacy.consent_state c ON c.subject_id=s.id AND c.purpose=$2 AND c.scope_key=$3 WHERE s.id=$1`,
        [subjectId, purpose, text(scopeKey)],
      );
      if (!r.rows[0]) return stop('not_found');
      const x = r.rows[0];
      const status = x.status === null ? 'unknown' : x.expired ? 'expired' : x.status;
      if (!['unknown', 'pending', 'confirmed', 'withdrawn', 'expired'].includes(String(status)))
        return stop('integrity');
      return {
        subjectId,
        purpose,
        scope: scopeKey,
        revision: rev(x.permission_revision),
        status: status as Permission['status'],
        eventId: x.source_event_id === null ? null : rid('consent_event', x.source_event_id),
        expiresAt: x.expires_at === null ? null : stamp(x.expires_at),
      };
    },
    async consent(tx, i) {
      await lockSubjects(scope, tx, [i.subjectId]);
      const current = await repo.permission(tx, i.subjectId, i.purpose, i.scope);
      if (current.revision !== i.expectedRevision) stop('conflict');
      const status = {
        grant: 'pending',
        confirm: 'confirmed',
        withdraw: 'withdrawn',
        expire: 'expired',
      }[i.action];
      if (!status) reject();
      await q(
        tx,
        'INSERT INTO privacy.consent_events(id,purpose,action,notice_id,policy_version,scope_key,occurred_at,method) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)',
        [i.id, i.purpose, i.action, i.noticeId, i.policyVersion, i.scope, i.method],
      );
      await q(tx, 'INSERT INTO privacy.subject_links(event_id,subject_id) VALUES($1,$2)', [
        i.id,
        i.subjectId,
      ]);
      await q(
        tx,
        `INSERT INTO privacy.consent_state(subject_id,purpose,scope_key,status,source_event_id,effective_at,expires_at,policy_version) VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7)
        ON CONFLICT(subject_id,purpose,scope_key) DO UPDATE SET status=excluded.status,source_event_id=excluded.source_event_id,effective_at=excluded.effective_at,expires_at=excluded.expires_at,policy_version=excluded.policy_version,revision=consent_state.revision+1,updated_at=clock_timestamp()`,
        [i.subjectId, i.purpose, i.scope, status, i.id, i.expiresAt, i.policyVersion],
      );
      await q(
        tx,
        'UPDATE app.subjects SET permission_revision=permission_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',
        [i.subjectId],
      );
      return repo.permission(tx, i.subjectId, i.purpose, i.scope);
    },
    async suppress(tx, i) {
      await lockSubjects(scope, tx, [i.subjectId]);
      await q(
        tx,
        'INSERT INTO privacy.suppressions(subject_id,scope_key,reason_code,effective_at,expires_at) VALUES($1,$2,$3,clock_timestamp(),$4)',
        [i.subjectId, text(i.scope), text(i.reason, 100), i.expiresAt],
      );
      await q(
        tx,
        'UPDATE app.subjects SET permission_revision=permission_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',
        [i.subjectId],
      );
    },
    async suppressed(tx, subjectId, scopes) {
      if (!scopes.length || scopes.length > 20) reject();
      scopes.forEach((s) => text(s));
      const r = await q(
        tx,
        'SELECT id FROM privacy.suppressions WHERE subject_id=$1 AND scope_key=ANY($2::text[]) AND effective_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) LIMIT 1',
        [subjectId, scopes],
      );
      return r.rows.length > 0;
    },
    async privateReport(tx, owner, id) {
      await reportGuard(scope, tx, owner, id);
      const r = await q(
        tx,
        'SELECT encrypted_fields,key_version,revision,expires_at FROM privacy.report_private_data WHERE report_id=$1 AND expires_at>clock_timestamp()',
        [id],
      );
      const x = r.rows[0];
      if (!x) return null;
      if (!Buffer.isBuffer(x.encrypted_fields)) return stop('integrity');
      return {
        envelope: { keyVersion: text(x.key_version, 100), hex: x.encrypted_fields.toString('hex') },
        revision: rev(x.revision),
        expiresAt: stamp(x.expires_at),
      };
    },
    async savePrivateReport(tx, owner, id, expected, e, expires) {
      await reportGuard(scope, tx, owner, id);
      const values = [id, envelope(e), e.keyVersion, expires];
      const r =
        expected === null
          ? await q(
              tx,
              'INSERT INTO privacy.report_private_data(report_id,encrypted_fields,key_version,expires_at) VALUES($1,$2,$3,$4) RETURNING revision',
              values,
            )
          : await q(
              tx,
              'UPDATE privacy.report_private_data SET encrypted_fields=$2,key_version=$3,expires_at=$4,revision=revision+1,updated_at=clock_timestamp() WHERE report_id=$1 AND revision=$5 RETURNING revision',
              [...values, expected.toString()],
            );
      return rev(one(r.rows).revision);
    },
    async request(tx, i) {
      await lockSubjects(scope, tx, [i.subjectId]);
      if (i.steps.length < 1 || i.steps.length > 32) reject();
      await q(
        tx,
        "INSERT INTO privacy.privacy_requests(id,subject_id,kind,jurisdiction,policy_version,status,due_at) VALUES($1,$2,$3,$4,$5,'pending',$6)",
        [i.id, i.subjectId, i.kind, i.jurisdiction, i.policyVersion, i.dueAt],
      );
      for (const step of i.steps)
        await q(
          tx,
          "INSERT INTO privacy.fulfillment_steps(request_id,store,action,status) VALUES($1,$2,$3,'pending')",
          [i.id, text(step.store, 100), text(step.action, 100)],
        );
    },
    async steps(tx, subjectId, requestId) {
      await lockSubjects(scope, tx, [subjectId]);
      const r = await q(
        tx,
        'SELECT f.id,f.store,f.action,f.status,f.revision,f.evidence_digest FROM privacy.fulfillment_steps f JOIN privacy.privacy_requests r ON r.id=f.request_id WHERE r.id=$1 AND r.subject_id=$2 ORDER BY f.id LIMIT 33',
        [requestId, subjectId],
      );
      if (r.rows.length > 32) stop('integrity');
      return r.rows.map((x) => ({
        id: rid('privacy_step', x.id),
        store: text(x.store),
        action: text(x.action),
        status: text(x.status),
        revision: rev(x.revision),
        evidenceDigest: x.evidence_digest === null ? null : hex(x.evidence_digest).toString('hex'),
      }));
    },
    async finishStep(tx, subjectId, requestId, id, expected, status, evidence) {
      await lockSubjects(scope, tx, [subjectId]);
      const r = await q(
        tx,
        `UPDATE privacy.fulfillment_steps f SET status=$5,evidence_digest=$6,revision=f.revision+1,updated_at=clock_timestamp() FROM privacy.privacy_requests r WHERE f.id=$1 AND f.request_id=$2 AND r.id=f.request_id AND r.subject_id=$3 AND f.revision=$4 AND f.status NOT IN ('completed','exempted') RETURNING f.revision`,
        [id, requestId, subjectId, expected.toString(), status, hex(evidence).toString('hex')],
      );
      return rev(one(r.rows).revision);
    },
    async resources(tx, subjectId, kind, page) {
      await lockSubjects(scope, tx, [subjectId]);
      if (!Object.hasOwn(resourceQueries, kind)) return reject();
      const s = ['privacy-resources', subjectId, kind],
        limit = pageLimit(page.limit),
        after = cursor(s, page.after);
      const r = await q(
        tx,
        `SELECT id FROM (${resourceQueries[kind]}) resources WHERE ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
        [subjectId, after, limit + 1],
      );
      const items: PrivacyResource[] = r.rows
        .slice(0, limit)
        .map((x) => ({ id: rid('resource', x.id), kind }));
      return { items, next: r.rows.length > limit ? nextCursor(s, items.at(-1)!.id) : null };
    },
    async restrict(tx, subjectId) {
      await lockSubjects(scope, tx, [subjectId]);
      await q(
        tx,
        "UPDATE app.subjects SET status='restricted',permission_revision=permission_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
        [subjectId],
      );
      await q(
        tx,
        "UPDATE privacy.contacts SET status='restricted',revision=revision+1,updated_at=clock_timestamp() WHERE subject_id=$1",
        [subjectId],
      );
    },
    async marker(tx, i) {
      digestKeys([i.key]);
      await q(
        tx,
        'INSERT INTO privacy.deletion_markers(resource_kind,resource_key_hmac,key_version,deleted_at,policy_version,expires_at) VALUES($1,$2,$3,clock_timestamp(),$4,$5) ON CONFLICT DO NOTHING',
        [text(i.kind, 100), hex(i.key.digest), i.key.keyVersion, i.policyVersion, i.expiresAt],
      );
    },
    async marked(tx, kind, keys) {
      const r = await q(
        tx,
        `SELECT m.id FROM privacy.deletion_markers m JOIN jsonb_to_recordset($2::jsonb) k(key_version text,digest text) ON m.key_version=k.key_version AND m.resource_key_hmac=decode(k.digest,'hex') WHERE m.resource_kind=$1 AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) LIMIT 1`,
        [text(kind, 100), keyJson(keys)],
      );
      return r.rows.length > 0;
    },
  };
  return guarded(scope, repo);
}
