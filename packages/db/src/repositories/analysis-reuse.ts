import type { AIReuseRepository } from '../../../application/src/ports/analysis-repositories.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { lockScope } from './analysis-scope.ts';
import { uid, hash, num, revisionValue, object, at, word } from './analysis-values.ts';
import { cursor, nextCursor, pageLimit, reject } from './bounds.ts';
export function createAIReuseRepository(s: WriteScope): AIReuseRepository {
  return guarded<AIReuseRepository>(s, {
    async claim(tx, scopeId, digest, holder, seconds) {
      const scope = uid('ai_scope', scopeId),
        key = hash(digest),
        owner = uid('ai_holder', holder),
        ttl = num(seconds, 1, 120);
      await lockScope(s, tx, scope);
      const r = (
        await s.query(tx, 'SELECT app.ai_claim_reuse($1,$2,$3,$4)::text AS fence', [
          scope,
          key,
          owner,
          ttl,
        ])
      ).rows[0]!;
      return r.fence === null
        ? null
        : Object.freeze({
            scopeId: scope,
            digest: key,
            holder: owner,
            fence: revisionValue(r.fence),
          });
    },
    async publish(tx, input, artifactId) {
      const lease = {
          scopeId: uid('ai_scope', input.scopeId),
          digest: hash(input.digest),
          holder: uid('ai_holder', input.holder),
          fence: revisionValue(input.fence),
        },
        artifact = uid('ai_artifact', artifactId);
      await lockScope(s, tx, lease.scopeId);
      const r = (
        await s.query(tx, 'SELECT app.ai_publish_reuse($1,$2,$3,$4,$5) AS ok', [
          lease.scopeId,
          lease.digest,
          lease.holder,
          lease.fence.toString(),
          artifact,
        ])
      ).rows[0]!;
      if (typeof r.ok !== 'boolean') return stop('integrity');
      return r.ok;
    },
    async current(tx, scopeId, digest) {
      const row = (
        await s.query(
          tx,
          'SELECT artifact_id,output,valid_until,fence::text FROM app.ai_current_reuse WHERE scope_id=$1 AND cache_key=$2',
          [uid('ai_scope', scopeId), hash(digest)],
        )
      ).rows[0];
      return row
        ? Object.freeze({
            artifactId: uid('ai_artifact', row.artifact_id),
            output: object(row.output),
            validUntil: at(row.valid_until),
            fence: revisionValue(row.fence),
          })
        : null;
    },
    async affectedScopes(tx, input, page) {
      const kind = word(input.kind, 20);
      if (!['dataset', 'advice'].includes(kind)) return reject();
      const source = uid(kind, input.id),
        limit = pageLimit(page.limit),
        binding = { kind: 'ai_source_invalidation', source, type: kind },
        after = cursor(binding, page.after);
      const rows = (
        await s.query(tx, 'SELECT scope_id FROM app.ai_repository_affected($1,$2,$3,$4)', [
          kind,
          source,
          after,
          limit + 1,
        ])
      ).rows;
      const items = rows.slice(0, limit).map((r) => uid('ai_scope', r.scope_id));
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(binding, items.at(-1)!) : null,
      });
    },
  });
}
