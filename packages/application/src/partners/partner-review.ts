import type { PrivateObjects } from '../ports/assets.ts';
import type { Id } from '../../../domain/src/values/core.ts';
import type { PartnerReviewRepository, ReviewKind, ReviewCursor } from '../ports/partner-review.ts';
import { partnerContext, identifier, type PartnerDependencies } from './partner-work.ts';
import { demand } from '../services/service-work.ts';
import type {
  PartnerModerationRepository,
  PartnerOfferPreview,
  PartnerServiceAssets,
  PartnerFiles,
} from '../ports/partner-services.ts';
export function createPartnerReviewServices(
  d: PartnerDependencies & {
    review: PartnerReviewRepository;
    offers: PartnerModerationRepository;
    preview: PartnerOfferPreview;
    assets: PartnerServiceAssets;
    objects: PrivateObjects;
    files: PartnerFiles;
  },
) {
  const c = partnerContext(d);
  const permission = (kind: ReviewKind) =>
    kind === 'businesses' ? ('partner.verify' as const) : ('partner.moderate' as const);
  return {
    queue(handle: string, kind: ReviewKind, rawAfter: string | null, limit: number) {
      return c.safe(async () => {
        demand(kind === 'businesses' || kind === 'offers');
        demand(Number.isInteger(limit) && limit >= 1 && limit <= 25);
        let after: ReviewCursor | null = null;
        if (rawAfter !== null) {
          demand(typeof rawAfter === 'string' && rawAfter.length <= 128);
          const v = rawAfter.split(':');
          demand(v.length === (kind === 'businesses' ? 1 : 3));
          after = {
            org: identifier('organization', v[0]),
            offer: kind === 'offers' ? identifier('partner_offer', v[1]) : null,
            version: kind === 'offers' ? Number(v[2]) : null,
          };
          if (kind === 'offers')
            demand(
              /^[1-9][0-9]{0,9}$/.test(v[2]!) &&
                Number.isSafeInteger(after.version) &&
                after.version! <= 2147483647,
            );
        }
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await d.onboarding.staff(tx, p, permission(kind));
          const rows = await d.review.queue(tx, kind, after, limit + 1);
          await d.onboarding.staff(tx, p, permission(kind));
          const items = rows.slice(0, limit),
            last = items.at(-1);
          return {
            items,
            next:
              rows.length > limit && last
                ? kind === 'businesses'
                  ? last.org
                  : [last.org, last.resource, last.version].join(':')
                : null,
          };
        });
      });
    },
    business(handle: string, organizationId: Id<'organization'>) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          const root = await c.staff(tx, p, org, 'partner.verify');
          demand(root.profile, 'not_found');
          const context = await d.review.context(tx, org);
          await c.staff(tx, p, org, 'partner.verify');
          return {
            organization: root.organization,
            profile: {
              services: root.profile.services,
              state: root.profile.state,
              revision: root.profile.revision,
              emailDomain: root.profile.emailDomain,
            },
            ...context,
          };
        });
      });
    },
    offer(
      handle: string,
      organizationId: Id<'organization'>,
      offerId: Id<'partner_offer'>,
      version: number,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId);
        demand(Number.isSafeInteger(version) && version >= 1 && version <= 2147483647);
        const p = await c.principal(handle);
        const admitted = await c.run(async (tx) => {
          await c.staff(tx, p, org, 'partner.moderate');
          const offer = await d.offers.version(
            tx,
            { organizationId: org, actor: p.subject },
            id,
            version,
          );
          demand(offer, 'not_found');
          return {
            offer,
            targets: await d.review.targets(tx, org, id, version),
            eligible: await d.offers.eligible(tx, org, id, version),
          };
        });
        if (!admitted.ok) return admitted;
        const output = await d.preview.render({
            offer: admitted.value.offer,
            eligible: admitted.value.eligible,
          }),
          fresh = await c.principal(handle);
        demand(fresh.subject === p.subject, 'forbidden');
        return c.run(async (tx) => {
          await c.staff(tx, fresh, org, 'partner.moderate');
          const current = await d.offers.version(
            tx,
            { organizationId: org, actor: fresh.subject },
            id,
            version,
          );
          demand(
            current && d.crypto.digest(current) === d.crypto.digest(admitted.value.offer),
            'conflict',
          );
          demand(
            (await d.offers.eligible(tx, org, id, version)) === admitted.value.eligible,
            'conflict',
          );
          return {
            org,
            offer: id,
            version,
            state: current.status,
            text: output.text,
            targets: admitted.value.targets,
          };
        });
      });
    },
    evidence(
      handle: string,
      organizationId: Id<'organization'>,
      assetId: Id<'asset'>,
      purpose: 'agreement' | 'verification',
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('asset', assetId);
        demand(purpose === 'agreement' || purpose === 'verification');
        const p = await c.principal(handle);
        const admitted = await c.run(async (tx) => {
          await c.staff(tx, p, org, 'partner.verify');
          const asset = await d.assets.get(tx, org, id, purpose);
          demand(
            asset.state === 'ready' && asset.mime === 'application/json' && asset.size <= 65536,
            'not_found',
          );
          return asset;
        });
        if (!admitted.ok) return admitted;
        const bytes = await d.objects.get(admitted.value);
        demand(
          bytes.byteLength === admitted.value.size &&
            d.crypto.checksum(bytes) === admitted.value.sha256,
          'integrity',
        );
        const inspected = await d.files.inspect(purpose, 'application/json', bytes),
          text = new TextDecoder('utf-8', { fatal: true }).decode(inspected),
          fresh = await c.principal(handle);
        demand(fresh.subject === p.subject, 'forbidden');
        return c.run(async (tx) => {
          await c.staff(tx, fresh, org, 'partner.verify');
          const current = await d.assets.get(tx, org, id, purpose);
          demand(
            current.state === 'ready' &&
              d.crypto.digest(current) === d.crypto.digest(admitted.value),
            'conflict',
          );
          await c.audit(tx, fresh, org, 'review.evidence', id, { id, purpose });
          return { id, purpose, text };
        });
      });
    },
  };
}
