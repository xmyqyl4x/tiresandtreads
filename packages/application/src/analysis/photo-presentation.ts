import { id, instant, ok, fail } from '../../../domain/src/values/core.ts';
import type { UnitOfWork } from '../ports/transactions.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { PhotoServiceRepository } from '../ports/photo-services.ts';
import type { PhotoPresentationRepository } from '../ports/photo-presentation.ts';
import { serviceWork, serviceFailure, demand } from '../services/service-work.ts';
import { pageRequest } from '../ports/pagination.ts';
export const photoNotice =
  'Optional photo processing reads visible sidewall text. Photos are private and normally expire after 24 hours. Extracted text may be incomplete, conflicting or wrong; explicitly confirm or correct each field before using it. Photos cannot establish tire condition, fitment or recall clearance. Manual entry is always available. Removing a photo does not erase answers you already chose to apply to your assessment.';
export function createPhotoPresentationService(d: {
  uow: UnitOfWork;
  repository: Pick<PhotoServiceRepository, 'owner'>;
  presentation: PhotoPresentationRepository;
  policyId: string | null;
  noticeVersion: string;
  now: () => string;
}) {
  return Object.freeze({
    async read(keys: readonly KeyDigest[], after: unknown = null) {
      try {
        demand(Array.isArray(keys) && keys.length > 0 && keys.length <= 4);
        const auth = Object.freeze(
          keys.map((k) => {
            demand(
              k && /^[A-Za-z0-9_-]{1,100}$/.test(k.keyVersion) && /^[a-f0-9]{64}$/.test(k.digest),
            );
            return Object.freeze({ ...k });
          }),
        );
        demand(new Set(auth.map((k) => k.keyVersion)).size === auth.length);
        demand(
          after === null || (typeof after === 'string' && after.length > 0 && after.length <= 2048),
        );
        const page = pageRequest(25, after as string | null);
        demand(page.ok);
        const checked = instant(d.now());
        demand(checked.ok && /^[A-Za-z0-9_-]{1,100}$/.test(d.noticeVersion), 'internal');
        const policy = d.policyId === null ? null : id('ai_policy', d.policyId);
        demand(policy === null || policy.ok, 'internal');
        return await serviceWork(d.uow, async (tx) => {
          const who = await d.repository.owner(tx, auth);
          demand(who, 'forbidden');
          const available =
            policy !== null && policy.ok && (await d.presentation.available(tx, policy.value));
          const owned = await d.presentation.list(tx, who.subjectId, page.value);
          return ok(
            Object.freeze({
              checkedAt: checked.value,
              processing: Object.freeze({
                available,
                policyId: available && policy?.ok ? policy.value : null,
                noticeVersion: d.noticeVersion,
                notice: photoNotice,
                maxBytes: 10485760 as const,
                expiresAfterHours: 24 as const,
              }),
              items: owned.items.map((p) => ({
                id: p.id,
                state: p.state,
                createdAt: p.createdAt,
                expiresAt: p.expiresAt,
                savedAt: p.savedAt,
              })),
              next: owned.next,
            }),
          );
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  });
}
