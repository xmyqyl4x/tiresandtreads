import { it, expect } from 'vitest';
import {
  partnerPrincipal,
  partnerDraft,
  partnerDomain,
  couponCode,
} from '../../packages/domain/src/partner-policy.ts';
const now = Date.parse('2026-11-05T12:00:00.000Z');
const actor = {
  subject: 'provider:alice',
  emailVerified: true,
  emailDomain: 'tireshop.example',
  mfaAt: '2026-11-05T11:59:00.000Z',
  expiresAt: '2026-11-05T12:30:00.000Z',
  staffId: null,
};
const draft = () => ({
  title: 'Ten percent off',
  description: 'Synthetic terms for a pilot offer',
  terms: { included: ['tires'], excluded: ['tax'] },
  discount: { kind: 'percent_off', basisPoints: 1000 },
  minimumTires: 1,
  minimumPurchase: null,
  redemptionMethod: 'in_store_code',
  redemptionDomain: null,
  redemptionUrl: null,
  logoAssetId: null,
  logoRightsWarranted: false,
  validFrom: '2026-11-05T12:00:00.000Z',
  validUntil: '2026-11-09T12:00:00.000Z',
});
it.each([
  { kind: 'amount_off', money: { minor: 9223372036854775807n, currency: 'USD' } },
  { kind: 'set_of_four_off', money: { minor: 1n, currency: 'USD' } },
  { kind: 'mail_in_rebate', money: { minor: 100n, currency: 'USD' } },
  { kind: 'free_service', service: 'alignment' },
  { kind: 'buy_three_get_one' },
  { kind: 'price_match' },
])('supports the explicit commercial discount type %#', (discount) => {
  expect(
    partnerDraft(
      { ...draft(), discount, minimumTires: 4, minimumPurchase: { minor: 0n, currency: 'USD' } },
      now,
    ).ok,
  ).toBe(true);
});
it.each([
  { discount: { kind: 'other' } },
  { discount: { kind: 'amount_off', money: { minor: 1, currency: 'USD' } } },
  { discount: { kind: 'amount_off', money: { minor: -1n, currency: 'USD' } } },
  { discount: { kind: 'amount_off', money: { minor: 9223372036854775808n, currency: 'USD' } } },
  { discount: { kind: 'amount_off', money: { minor: 1n, currency: 'EUR' } } },
  { discount: { kind: 'free_service', service: 'unknown' } },
  { discount: { kind: 'buy_three_get_one' } },
  { terms: { unknown: 'x' } },
  { terms: {} },
  { terms: { included: Array.from({ length: 33 }, () => 'x') } },
  { terms: { included: ['x'], conditions: 'a'.repeat(2001) } },
  { redemptionMethod: 'other' },
  { redemptionMethod: 'link' },
  { redemptionDomain: 'x.example' },
  { redemptionDomain: 'x.example', redemptionUrl: 'https://x.example/a%2Fb' },
  { redemptionDomain: 'x.example', redemptionUrl: 'https://x.example/#x' },
  { redemptionDomain: 'x.example', redemptionUrl: 'https://x.example:999/a' },
  { redemptionDomain: 'localhost', redemptionUrl: 'https://localhost' },
  { logoAssetId: '11111111-1111-4111-8111-111111111111', logoRightsWarranted: false },
  { validUntil: '2028-11-05T12:00:00.000Z' },
  { validUntil: '2026-11-01T12:00:00.000Z' },
])('denies malformed commercial fields %#', (change) =>
  expect(partnerDraft({ ...draft(), ...change }, now).ok).toBe(false),
);
it('supports explicit verified links, rights-warranted logos and typed staff principals', () => {
  expect(
    partnerDraft(
      {
        ...draft(),
        redemptionMethod: 'link',
        redemptionDomain: 'shop.example',
        redemptionUrl: 'https://shop.example/deal',
        logoAssetId: '11111111-1111-4111-8111-111111111111',
        logoRightsWarranted: true,
      },
      now,
    ).ok,
  ).toBe(true);
  expect(
    partnerPrincipal({ ...actor, staffId: '11111111-1111-4111-8111-111111111111' }, now).ok,
  ).toBe(true);
  for (const v of [
    null,
    [],
    { ...actor, staffId: 'bad' },
    { ...actor, mfaAt: 'bad' },
    { ...actor, expiresAt: '2026-11-05T14:00:00.000Z' },
  ])
    expect(partnerPrincipal(v, now).ok).toBe(false);
  expect(partnerPrincipal(actor, NaN).ok).toBe(false);
  expect(partnerPrincipal(actor, now, 0).ok).toBe(false);
  expect(partnerPrincipal(actor, now, 900001).ok).toBe(false);
  expect(partnerDraft(null, now).ok).toBe(false);
  expect(partnerDraft(draft(), NaN).ok).toBe(false);
  expect(couponCode(null).ok).toBe(false);
});
it('requires verified email and recent provider-attested MFA', () => {
  expect(partnerPrincipal(actor, now).ok).toBe(true);
});
it.each([
  { emailVerified: false },
  { mfaAt: '2026-11-05T11:50:00.000Z' },
  { mfaAt: '2026-11-05T12:01:00.000Z' },
  { expiresAt: '2026-11-05T11:59:00.000Z' },
  { subject: '' },
])('rejects incomplete/stale authority %j', (change) => {
  expect(partnerPrincipal({ ...actor, ...change }, now).ok).toBe(false);
});
it('normalizes a DNS business domain', () => {
  expect(partnerDomain('Shop.Example')).toEqual({ ok: true, value: 'shop.example' });
});
it.each([
  '127.0.0.1',
  'localhost',
  'a..example',
  'user@shop.example',
  'https://shop.example',
  'shop.example:443',
  '-bad.example',
  '169.254.169.254',
  'shop.example.',
])('rejects unsafe domain %s', (domain) => {
  expect(partnerDomain(domain).ok).toBe(false);
});
it('validates and freezes the commercial draft', () => {
  const source = draft(),
    r = partnerDraft(source, now);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(Object.isFrozen(r.value.terms)).toBe(true);
    source.terms.included.push('changed');
    expect(r.value.terms.included).toEqual(['tires']);
  }
});
it.each([
  { validUntil: '2026-11-07T12:00:00.000Z' },
  { title: '<script>bad</script>' },
  { description: 'Guaranteed safest tire for every vehicle' },
  {
    redemptionUrl: 'http://shop.example/x',
    redemptionDomain: 'shop.example',
    redemptionMethod: 'link',
  },
  {
    redemptionUrl: 'https://shop.example@evil.example/x',
    redemptionDomain: 'shop.example',
    redemptionMethod: 'link',
  },
  { logoAssetId: 'bad', logoRightsWarranted: true },
  { discount: { kind: 'percent_off', basisPoints: 10001 } },
  { minimumTires: 0 },
])('rejects unsafe offer %j', (change) => {
  expect(partnerDraft({ ...draft(), ...change }, now).ok).toBe(false);
});
it('allows a plain coupon code without changing case', () => {
  expect(couponCode(' SAVE-20 ')).toEqual({ ok: true, value: 'SAVE-20' });
});
it.each([
  '=SUM(A1)',
  '+cmd',
  '@link',
  '-formula',
  'with space',
  'comma,here',
  'a\nb',
  'x'.repeat(129),
  '',
])('rejects unsafe coupon %s', (code) => {
  expect(couponCode(code).ok).toBe(false);
});
