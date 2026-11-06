import type { Id } from '../../../domain/src/values/core.ts';
import { partnerDraft } from '../../../domain/src/partner-policy.ts';
import type { PartnerOfferTarget } from '../ports/partner-repositories.ts';
import type {
  PartnerModerationRepository,
  PartnerOfferPreview,
} from '../ports/partner-services.ts';
import {
  capture,
  identifier,
  partnerContext,
  string,
  type PartnerDependencies,
} from './partner-work.ts';
import { demand } from '../services/service-work.ts';
export function offerTargets(input: readonly PartnerOfferTarget[]): readonly PartnerOfferTarget[] {
  const rows = capture(input);
  demand(Array.isArray(rows) && rows.length > 0 && rows.length <= 32);
  for (const r of rows) {
    identifier('offer_target', r.id);
    demand(r.market === 'US');
    const kinds = [
      'sku',
      'model',
      'brand',
      'category',
      'size',
      'vehicle_type',
      'tier',
      'region',
      'postal',
      'rim',
      'radius',
      'store_wide',
    ];
    demand(kinds.includes(r.strategy));
    for (const [k, v] of [
      ['sku', r.skuId],
      ['tire_model', r.modelId],
      ['domain_entity', r.brandId],
      ['partner_location', r.locationId],
    ] as const)
      if (v !== null) identifier(k, v);
    const nonnull = [r.skuId, r.modelId, r.brandId, r.value, r.rimInches, r.radiusKm].filter(
      (x) => x !== null,
    ).length;
    demand(nonnull === (r.strategy === 'store_wide' ? 0 : 1));
    if (['sku', 'model', 'brand'].includes(r.strategy))
      demand(
        ({ sku: r.skuId, model: r.modelId, brand: r.brandId } as Record<string, unknown>)[
          r.strategy
        ] !== null,
      );
    if (['category', 'size', 'vehicle_type', 'tier', 'region', 'postal'].includes(r.strategy))
      string(r.value, 100);
    if (r.strategy === 'rim')
      demand(
        typeof r.rimInches === 'string' &&
          /^\d{1,2}(\.\d)?$/.test(r.rimInches) &&
          Number(r.rimInches) >= 10 &&
          Number(r.rimInches) <= 40,
      );
    if (r.strategy === 'radius')
      demand(
        r.locationId !== null &&
          typeof r.radiusKm === 'string' &&
          /^\d{1,4}(\.\d{1,2})?$/.test(r.radiusKm) &&
          Number(r.radiusKm) > 0 &&
          Number(r.radiusKm) <= 1000,
      );
    // Future matching policies must explicitly version new rule fields.
    demand(
      r.rule &&
        typeof r.rule === 'object' &&
        !Array.isArray(r.rule) &&
        Object.keys(r.rule).length === 0,
    );
  }
  demand(new Set(rows.map((x) => x.id)).size === rows.length);
  return rows;
}
export function createPartnerOfferServices(
  d: PartnerDependencies & {
    readonly offers: PartnerModerationRepository;
    readonly preview: PartnerOfferPreview;
  },
) {
  const c = partnerContext(d),
    repo = d.offers;
  const number = (v: number) => {
    demand(Number.isSafeInteger(v) && v >= 1 && v <= 2147483647);
    return v;
  };
  return {
    draft(
      handle: string,
      organizationId: Id<'organization'>,
      offerId: Id<'partner_offer'>,
      version: number,
      body: unknown,
      targets: readonly PartnerOfferTarget[],
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId),
          n = number(version),
          draft = partnerDraft(capture(body), d.clock.now()),
          rows = offerTargets(targets);
        demand(draft.ok);
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager'], true);
          const result = await repo.draft(
            tx,
            { organizationId: org, actor: p.subject },
            id,
            n,
            draft.value,
            rows,
          );
          await c.audit(tx, p, org, 'offer.draft', id, {
            version: n,
            body: draft.value,
            targets: rows,
          });
          return result;
        });
      });
    },
    submit(
      handle: string,
      organizationId: Id<'organization'>,
      offerId: Id<'partner_offer'>,
      version: number,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId),
          n = number(version),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager']);
          await repo.submit(tx, org, id, n, p.subject);
          await c.audit(tx, p, org, 'offer.submit', id, { version: n });
          return { submitted: true as const };
        });
      });
    },
    review(
      handle: string,
      organizationId: Id<'organization'>,
      offerId: Id<'partner_offer'>,
      version: number,
      approved: boolean,
      reason: string,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId),
          n = number(version);
        demand(typeof approved === 'boolean' && /^[a-z][a-z0-9_]{0,79}$/.test(reason));
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.staff(tx, p, org, 'partner.moderate', true);
          if (approved) await d.onboarding.currentAgreements(tx, org, c.policy);
          await repo.review(tx, org, id, n, p, approved, reason);
          await c.audit(tx, p, org, 'offer.review', id, { version: n, approved, reason });
          return { reviewed: true as const };
        });
      });
    },
    publish(
      handle: string,
      organizationId: Id<'organization'>,
      offerId: Id<'partner_offer'>,
      version: number,
      expected: number | null,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId),
          n = number(version);
        if (expected !== null) number(expected);
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.staff(tx, p, org, 'partner.moderate', true);
          await d.onboarding.currentAgreements(tx, org, c.policy);
          await repo.publish(tx, org, id, n, expected);
          await c.audit(tx, p, org, 'offer.publish', id, { version: n, expected });
          return { published: true as const };
        });
      });
    },
    pause(handle: string, organizationId: Id<'organization'>, offerId: Id<'partner_offer'>) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager']);
          await repo.pause(tx, org, id);
          await c.audit(tx, p, org, 'offer.pause', id, {});
          return { paused: true as const };
        });
      });
    },
    preview(
      handle: string,
      organizationId: Id<'organization'>,
      offerId: Id<'partner_offer'>,
      version: number,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('partner_offer', offerId),
          n = number(version),
          p = await c.principal(handle);
        const admitted = await c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager', 'analyst'], true);
          const offer = await repo.version(tx, { organizationId: org, actor: p.subject }, id, n);
          demand(offer, 'not_found');
          return { offer, eligible: await repo.eligible(tx, org, id) };
        });
        if (!admitted.ok) return admitted;
        const output = await d.preview.render(admitted.value),
          fresh = await c.principal(handle);
        demand(fresh.subject === p.subject, 'forbidden');
        return c.run(async (tx) => {
          await c.member(tx, fresh, org, ['owner', 'manager', 'analyst'], true);
          const current = await repo.version(
            tx,
            { organizationId: org, actor: fresh.subject },
            id,
            n,
          );
          demand(
            current && d.crypto.digest(current) === d.crypto.digest(admitted.value.offer),
            'conflict',
          );
          demand((await repo.eligible(tx, org, id)) === admitted.value.eligible, 'conflict');
          return output;
        });
      });
    },
  };
}
