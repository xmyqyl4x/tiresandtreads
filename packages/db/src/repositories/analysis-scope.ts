import type { AIScopeRepository } from '../../../application/src/ports/analysis-repositories.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { aiPolicyFromRow, aiScopeFromRow } from './analysis-mappers.ts';
import { uid, word, hash, big, stored, type Row } from './analysis-values.ts';
import { reject } from './bounds.ts';
export const scopeColumns =
  's.id,s.policy_version_id,s.owner_subject_id,s.kind,g.permission_revision::text,g.subject_permission_revision::text,g.invalidation_revision::text,g.state,g.processing_allowed,g.notice_version';
export async function scopeRow(s: WriteScope, tx: Tx, id: unknown): Promise<Row | null> {
  return (
    (
      await s.query(
        tx,
        `SELECT ${scopeColumns} FROM app.ai_reuse_scopes s JOIN app.ai_scope_guards g ON g.scope_id=s.id WHERE s.id=$1`,
        [uid('ai_scope', id)],
      )
    ).rows[0] ?? null
  );
}
export async function lockScope(s: WriteScope, tx: Tx, id: unknown, current = true) {
  await s.query(tx, 'SELECT app.ai_repository_scope($1,$2)', [uid('ai_scope', id), current]);
}
export function createAIScopeRepository(s: WriteScope): AIScopeRepository {
  const repo: AIScopeRepository = {
    async policy(tx, id) {
      const r = (
        await s.query(
          tx,
          'SELECT id,task,canonical_version,validator_version,shared_allowed,shared_parameter_allowlist,status FROM app.ai_policy_versions WHERE id=$1',
          [uid('ai_policy', id)],
        )
      ).rows[0];
      return r ? stored(aiPolicyFromRow(r)) : null;
    },
    async scope(tx, id) {
      const r = await scopeRow(s, tx, id);
      return r ? stored(aiScopeFromRow(r)) : null;
    },
    async create(tx, input) {
      const id = uid('ai_scope', input.id),
        policy = uid('ai_policy', input.policyId),
        owner = input.ownerId === null ? null : uid('subject', input.ownerId),
        key = word(input.key),
        notice = word(input.noticeVersion, 100),
        evidence = hash(input.evidenceHash),
        subject = input.subjectRevision === null ? null : big(input.subjectRevision, 1n).toString();
      if ((owner === null) !== (subject === null)) return reject();
      if (owner) {
        const actual = (
          await s.query(tx, 'SELECT app.ai_repository_subject($1,true)::text AS revision', [owner])
        ).rows[0]!.revision;
        if (actual !== subject) return stop('conflict');
      }
      await s.query(
        tx,
        'INSERT INTO app.ai_reuse_scopes(id,kind,owner_subject_id,scope_key,policy_version_id) VALUES($1,$2,$3,$4,$5)',
        [id, owner ? 'owner' : 'shared', owner, key, policy],
      );
      await s.query(
        tx,
        'INSERT INTO app.ai_scope_guards(scope_id,subject_permission_revision,processing_allowed,notice_version,choice_evidence_hash,choice_recorded_at) VALUES($1,$2,true,$3,$4,clock_timestamp())',
        [id, subject, notice, evidence],
      );
      return (await repo.scope(tx, id)) ?? stop('integrity');
    },
    async choice(tx, input) {
      const id = uid('ai_scope', input.scopeId),
        expected = big(input.expectedRevision, 1n).toString(),
        subject = input.subjectRevision === null ? null : big(input.subjectRevision, 1n).toString(),
        notice = word(input.noticeVersion, 100),
        evidence = hash(input.evidenceHash),
        allowed = input.allowed;
      if (typeof allowed !== 'boolean') return reject();
      await lockScope(s, tx, id, false);
      const scope = (await repo.scope(tx, id)) ?? stop('not_found');
      if (scope.ownerId) {
        const actual = (
          await s.query(tx, 'SELECT app.ai_repository_subject($1,$2)::text AS revision', [
            scope.ownerId,
            allowed,
          ])
        ).rows[0]!.revision;
        if (actual !== subject) return stop('conflict');
      }
      const row = (
        await s.query(
          tx,
          "UPDATE app.ai_scope_guards SET permission_revision=permission_revision+1,subject_permission_revision=$3,processing_allowed=$4,state=CASE WHEN $4 THEN 'active' ELSE 'withdrawn' END,notice_version=$5,choice_evidence_hash=$6,choice_recorded_at=clock_timestamp(),updated_at=clock_timestamp() WHERE scope_id=$1 AND permission_revision=$2 AND state<>'deleting' RETURNING scope_id",
          [id, expected, subject, allowed, notice, evidence],
        )
      ).rows[0];
      if (!row) return stop('conflict');
      return (await repo.scope(tx, id)) ?? stop('integrity');
    },
    async invalidate(tx, id, expected) {
      const target = uid('ai_scope', id),
        old = big(expected).toString();
      await lockScope(s, tx, target, false);
      const r = (
        await s.query(
          tx,
          "UPDATE app.ai_scope_guards SET invalidation_revision=invalidation_revision+1,updated_at=clock_timestamp() WHERE scope_id=$1 AND invalidation_revision=$2 AND state<>'deleting' RETURNING scope_id",
          [target, old],
        )
      ).rows[0];
      if (!r) return stop('conflict');
      return (await repo.scope(tx, target)) ?? stop('integrity');
    },
  };
  return guarded(s, repo);
}
