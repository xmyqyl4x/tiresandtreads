import type { OwnerRepository } from '../../../application/src/ports/owner-report.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { hex, digestKeys, keyJson, rid, ownerGuard } from './private-values.ts';
import { stop } from './ingestion.ts';
export function createOwnerRepository(scope: WriteScope): OwnerRepository {
  const q = scope.query;
  const repo: OwnerRepository = {
    async create(tx, input) {
      digestKeys([input.key]);
      await q(tx, "INSERT INTO app.subjects(id,kind,status) VALUES($1,'guest','active')", [
        input.owner.subjectId,
      ]);
      await q(
        tx,
        'INSERT INTO app.owner_sessions(id,subject_id,token_hash,key_version,expires_at) VALUES($1,$2,$3,$4,$5)',
        [
          input.owner.sessionId,
          input.owner.subjectId,
          hex(input.key.digest),
          input.key.keyVersion,
          input.expiresAt,
        ],
      );
      return input.owner;
    },
    async resolve(tx, keys) {
      const r = await q(
        tx,
        `SELECT o.id,o.subject_id FROM app.owner_sessions o JOIN app.subjects s ON s.id=o.subject_id
        JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON o.key_version=k.key_version AND o.token_hash=decode(k.digest,'hex')
        WHERE o.revoked_at IS NULL AND o.expires_at>clock_timestamp() AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())`,
        [keyJson(keys)],
      );
      if (r.rows.length > 1) return stop('integrity');
      const row = r.rows[0];
      return row
        ? { subjectId: rid('subject', row.subject_id), sessionId: rid('owner_session', row.id) }
        : null;
    },
    async rotate(tx, owner, input) {
      await ownerGuard(scope, tx, owner);
      digestKeys([input.key]);
      await repo.revoke(tx, owner);
      await q(
        tx,
        'INSERT INTO app.owner_sessions(id,subject_id,token_hash,key_version,expires_at) VALUES($1,$2,$3,$4,$5)',
        [
          input.sessionId,
          owner.subjectId,
          hex(input.key.digest),
          input.key.keyVersion,
          input.expiresAt,
        ],
      );
      return { subjectId: owner.subjectId, sessionId: input.sessionId };
    },
    async revoke(tx, owner) {
      await ownerGuard(scope, tx, owner);
      await q(
        tx,
        'UPDATE app.owner_sessions SET revoked_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1',
        [owner.sessionId],
      );
    },
  };
  return guarded(scope, repo);
}
