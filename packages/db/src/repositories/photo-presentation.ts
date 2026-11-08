import type { PhotoPresentationRepository } from '../../../application/src/ports/photo-presentation.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { uid } from './analysis-values.ts';
import { stored } from './analysis-values.ts';
import { photoContext } from './photo-owners.ts';
import { photoStatusFromRow } from './photo-mappers.ts';
import { cursor, nextCursor, pageLimit } from './bounds.ts';
export function createPhotoPresentationRepository(s: WriteScope): PhotoPresentationRepository {
  return guarded<PhotoPresentationRepository>(s, {
    async list(tx, owner, page) {
      const person = await photoContext(s, tx, owner),
        limit = pageLimit(page.limit),
        binding = { kind: 'photo_web_status', owner: person },
        after = cursor(binding, page.after);
      const rows = (
        await s.query(
          tx,
          `SELECT i.id,coalesce(u.state,i.state) AS state,i.created_at,i.expires_at,u.saved_at FROM app.photo_service_intents i LEFT JOIN app.photo_owner_status u ON u.id=i.id WHERE i.owner_id=$1 AND app.photo_intent_current(i.id) AND ($2::uuid IS NULL OR i.id>$2) ORDER BY i.id LIMIT $3`,
          [person, after, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map((r) => stored(photoStatusFromRow(r)));
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(binding, items.at(-1)!.id) : null,
      });
    },
    async available(tx, policy) {
      const rows = (
        await s.query(
          tx,
          `SELECT 1 FROM app.ai_policy_versions p JOIN app.photo_upload_plans u ON u.policy_id=p.id JOIN app.ai_cost_plans c ON c.policy_id=p.id AND c.configuration_hash=p.configuration_hash WHERE p.id=$1 AND p.status='active' AND p.task='photo_extraction' AND p.schema_version='photo-selection-v1' AND p.validator_version='photo-fields-v1' AND u.status='active' AND c.status='active'`,
          [uid('ai_policy', policy)],
        )
      ).rows;
      return rows.length === 1;
    },
  });
}
