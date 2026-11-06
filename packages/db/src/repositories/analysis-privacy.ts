import type { AnalysisPrivacyRepository } from '../../../application/src/ports/analysis-privacy.ts';
import type { PrivacyLease } from '../../../application/src/ports/privacy-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, big, word, hash, num, revisionValue, choice } from './analysis-values.ts';
import { cursor, nextCursor, pageLimit } from './bounds.ts';
function lease(l: PrivacyLease) {
  return [uid('privacy_request', l.id), uid('lease', l.token), big(l.generation, 1n).toString()];
}
export function createAnalysisPrivacyRepository(
  s: WriteScope,
  bucket: string,
  keyVersions: readonly string[],
): AnalysisPrivacyRepository {
  const expectedBucket = word(bucket, 200),
    keys = Object.freeze(keyVersions.map((x) => word(x, 100)));
  if (!keys.length || keys.length > 4) return stop('invalid_input');
  return guarded<AnalysisPrivacyRepository>(s, {
    async restrict(tx, l) {
      await s.query(tx, 'SELECT privacy.analysis_repository_restrict($1,$2,$3)', lease(l));
    },
    async assets(tx, l, page) {
      const values = lease(l),
        limit = pageLimit(page.limit),
        binding = { kind: 'analysis_erasure_assets', request: values[0] },
        after = cursor(binding, page.after),
        rows = (
          await s.query(tx, 'SELECT * FROM privacy.analysis_repository_assets($1,$2,$3,$4,$5)', [
            ...values,
            after,
            limit + 1,
          ])
        ).rows;
      const items = rows.slice(0, limit).map((r) => {
        if (r.bucket !== expectedBucket || !keys.includes(String(r.key_version)))
          return stop('forbidden');
        return Object.freeze({
          id: uid('asset', r.id),
          revision: revisionValue(r.revision),
          key: word(r.object_key, 2048),
          mime: word(r.mime_type, 100),
          sha256: hash(r.sha256),
          size: num(Number(r.size_bytes), 0, 10485760),
          version: r.object_version === null ? null : word(r.object_version, 1024),
          state: choice(r.state, ['deleting', 'deleted']),
        });
      });
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(binding, items.at(-1)!.id) : null,
      });
    },
    async erase(tx, l, scope) {
      return (
        (
          await s.query(tx, 'SELECT privacy.analysis_repository_erase($1,$2,$3,$4) AS done', [
            ...lease(l),
            uid('ai_scope', scope),
          ])
        ).rows[0]?.done === true
      );
    },
  });
}
