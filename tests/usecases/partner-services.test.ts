import { it, expect } from 'vitest';
import {
  capture,
  identifier,
  string,
  timestamp,
} from '../../packages/application/src/partners/partner-work.ts';
import { offerTargets } from '../../packages/application/src/partners/partner-offers.ts';
import { target, uuid } from '../fixtures/phase2/compose-partner-services.ts';
import { partnerPreview } from '../../packages/integrations/src/partner-preview.ts';
import type { PartnerOfferVersion } from '../../packages/domain/src/entities/partner.ts';
it('captures mutable DTOs before asynchronous authority checks and rejects exotic inputs', () => {
  const v = { x: ['value'], n: 1n },
    r = capture(v);
  v.x.push('changed');
  expect(r.x).toEqual(['value']);
  expect(Object.isFrozen(r.x)).toBe(true);
  for (const bad of [
    undefined,
    () => 1,
    new Date(),
    NaN,
    Array(1001).fill(0),
    Object.defineProperty({}, 'x', {
      get() {
        throw Error('must not run');
      },
    }),
  ])
    expect(() => capture(bad)).toThrow();
  const cycle: Record<string, unknown> = {};
  cycle.x = cycle;
  expect(() => capture(cycle)).toThrow();
  let deep: unknown = {};
  for (let i = 0; i < 12; i++) deep = { x: deep };
  expect(() => capture(deep)).toThrow();
  expect(() => capture(Array.from({ length: 1000 }, () => Array(6).fill(0)))).toThrow();
});
it('validates opaque identifiers, text and instants without coercion', () => {
  expect(() => identifier('organization', 'bad')).toThrow();
  expect(() => string('\n')).toThrow();
  expect(() => string('<html>')).toThrow();
  expect(() => timestamp('bad')).toThrow();
  expect(string(' value ')).toBe('value');
  expect(capture(1.5)).toBe(1.5);
});
it.each([
  'store_wide',
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
] as const)('validates the fixed %s targeting shape', (strategy) => {
  const t = {
    ...target(),
    strategy,
    ...(strategy === 'sku'
      ? { skuId: uuid('sku') }
      : strategy === 'model'
        ? { modelId: uuid('tire_model') }
        : strategy === 'brand'
          ? { brandId: uuid('domain_entity') }
          : strategy === 'rim'
            ? { rimInches: '18' }
            : strategy === 'radius'
              ? { radiusKm: '25.5', locationId: uuid('partner_location') }
              : strategy === 'store_wide'
                ? {}
                : { value: 'synthetic' }),
  };
  expect(offerTargets([t])).toHaveLength(1);
});
it.each([
  () => [],
  () => Array(33).fill(target()),
  () => [{ ...target(), market: 'XX' }],
  () => [{ ...target(), strategy: 'unknown' }],
  () => [{ ...target(), strategy: 'sku' }],
  () => [{ ...target(), strategy: 'model', skuId: uuid('sku') }],
  () => [{ ...target(), strategy: 'brand', brandId: 'bad' }],
  () => [{ ...target(), strategy: 'category' }],
  () => [{ ...target(), strategy: 'rim', rimInches: '99' }],
  () => [{ ...target(), strategy: 'radius', radiusKm: '0' }],
  () => [{ ...target(), rule: { x: 1 } }],
  () => {
    const t = target();
    return [t, t];
  },
])('denies malformed target shapes %#', (make) =>
  expect(() => offerTargets(make() as Parameters<typeof offerTargets>[0])).toThrow(),
);
it('escapes previews and preserves int64 currency precision without private authors or codes', async () => {
  const offer = {
    title: '<script>"x"&',
    description: "'<b>",
    terms: { included: ['x', 'y'], conditions: 'cash only' },
    discount: { kind: 'amount_off', money: { minor: 9223372036854775807n, currency: 'USD' } },
    minimumTires: 1,
    minimumPurchase: null,
    redemptionMethod: 'in_store_code',
    redemptionUrl: null,
    validFrom: 'synthetic',
    validUntil: 'synthetic',
    partnerAuthor: 'must-not-leak',
    code: 'SECRET',
  } as unknown as PartnerOfferVersion;
  const p = await partnerPreview.render({ offer, eligible: false });
  expect(p.html).not.toContain('<script>');
  expect(p.html).toContain('&lt;script&gt;&quot;x&quot;&amp;');
  expect(p.text).toContain('92233720368547758.07');
  expect(p.text).not.toContain('SECRET');
  expect(p.text).not.toContain('must-not-leak');
  for (const discount of [{ kind: 'percent_off', basisPoints: 1250 }, { kind: 'price_match' }])
    expect(
      (
        await partnerPreview.render({
          offer: { ...offer, discount } as PartnerOfferVersion,
          eligible: true,
        })
      ).text,
    ).toContain('Offer preview');
});

it.each([
  [{ kind: 'percent_off', basisPoints: 1250 }, 'Percent off: 12.5%'],
  [{ kind: 'amount_off', money: { minor: 2500n, currency: 'USD' } }, 'Amount off: USD 25.00'],
  [
    { kind: 'set_of_four_off', money: { minor: 2500n, currency: 'USD' } },
    'Set of four discount: USD 25.00',
  ],
  [
    { kind: 'mail_in_rebate', money: { minor: 2500n, currency: 'USD' } },
    'Mail-in rebate: USD 25.00',
  ],
  [{ kind: 'free_service', service: 'alignment' }, 'Free service: alignment'],
  [{ kind: 'buy_three_get_one' }, 'Buy three, get one'],
  [{ kind: 'price_match' }, 'Price match'],
] as const)(
  'distinguishes commercial discount semantics in previews %#',
  async (discount, label) => {
    const offer = {
      title: 'Synthetic offer',
      description: 'Local preview',
      terms: { included: ['tires'] },
      discount,
      minimumTires: 4,
      minimumPurchase: { minor: 50000n, currency: 'USD' },
      redemptionMethod: 'in_store_code',
      redemptionUrl: null,
      validFrom: 'synthetic',
      validUntil: 'synthetic',
    } as unknown as PartnerOfferVersion;
    const p = await partnerPreview.render({ offer, eligible: false });
    expect(p.text).toContain(label);
    expect(p.text).toContain('Minimum tires: 4');
    expect(p.text).toContain('Minimum purchase: USD 500.00');
    expect(p.text).toContain('Redemption: in store code');
  },
);
