import { it, expect } from 'vitest';
import { parsePrivateQuote } from '../../packages/application/src/services/report-comparison.ts';
import {
  canonical,
  publicComparison,
  publicReport,
} from '../../packages/application/src/services/report-records.ts';
const base = () => ({
  id: null,
  expectedRevision: null,
  skuId: null,
  productText: 'Unverified product',
  shopName: null,
  currency: 'USD',
  totalMinor: '74900',
  quantity: 4,
  basis: 'installed_set',
  observedOn: '2026-10-25',
  taxContextConfirmed: false,
  taxIncluded: true,
  components: [{ kind: 'tax', included: true, basis: 'per_order', minor: null }],
});
it('accepts exact user-declared quote values while preserving unknown product and private text', () => {
  const r = parsePrivateQuote(base());
  expect(r).toMatchObject({
    id: null,
    skuId: null,
    totalMinor: 74900n,
    productText: 'Unverified product',
  });
  expect(r.components[0]).toMatchObject({ taxContextConfirmed: false });
  expect(
    parsePrivateQuote({
      ...base(),
      id: '11111111-1111-4111-8111-111111111111',
      expectedRevision: '1',
      skuId: '22222222-2222-4222-8222-222222222222',
      productText: '',
    }),
  ).toHaveProperty('expectedRevision', 1n);
});
const bad: Record<string, unknown>[] = [
  { token: 'no' },
  { currency: 'EUR' },
  { quantity: 3 },
  { quantity: '4' },
  { quantity: 1.5 },
  { totalMinor: 74900 },
  { totalMinor: '-1' },
  { totalMinor: '1000000000001' },
  { id: 'bad' },
  { id: '11111111-1111-4111-8111-111111111111' },
  { expectedRevision: '0' },
  { expectedRevision: '1' },
  { skuId: 'bad' },
  { productText: '' },
  { productText: 12 },
  { productText: 'x'.repeat(201) },
  { shopName: 12 },
  { shopName: 'x'.repeat(201) },
  { basis: 'per_axle' },
  { observedOn: '2026-02-30' },
  { observedOn: 'future' },
  { taxContextConfirmed: 'true' },
  { taxIncluded: 'true' },
  { components: null },
  { components: Array(8).fill({ kind: 'tax', included: true, basis: 'per_order', minor: null }) },
  { components: [{ kind: 'unexpected', included: true, basis: 'per_order', minor: null }] },
  { components: [{ kind: 'tax', included: 1, basis: 'per_order', minor: null }] },
  { components: [{ kind: 'tax', included: true, basis: 'unknown', minor: null }] },
  { components: [{ kind: 'tax', included: false, basis: 'per_order', minor: '-1' }] },
  { components: [{ kind: 'tax', included: false, basis: 'per_order', minor: '1' }] },
  { components: Array(2).fill({ kind: 'tax', included: true, basis: 'per_order', minor: null }) },
];
it.each(bad.map((x, i) => [i, x] as const))('rejects malformed private quote %i', (_i, change) =>
  expect(() => parsePrivateQuote({ ...base(), ...change })).toThrow(),
);
it('bounds canonical data and projects legacy comparisons without private notes or scenario inputs', () => {
  for (const x of [
    undefined,
    () => {},
    new Date(),
    { x: Array(2001).fill(0) },
    { x: 'é'.repeat(524289) },
  ])
    expect(() => canonical(x)).toThrow();
  const x: Record<string, unknown> = {};
  x.x = x;
  expect(() => canonical(x)).toThrow();
  expect(() => canonical({ x: [] }, 1)).toThrow();
  const c = publicComparison({
    revision: 1n,
    scenario: { ownerEmail: 'private' },
    items: [
      {
        slot: 1,
        kind: 'quote',
        sourceKey: 'Private Shop',
        snapshot: {
          privateNotes: 'private',
          productKnown: false,
          fit: 'unverified',
          climate: 'unknown',
          scoreBp: null,
          price: {
            currency: 'USD',
            quantity: 4,
            installed: { low: '123', high: '124', currency: 'USD', private: 'no' },
            privateText: 'private',
          },
          verdict: {
            fit: 'unverified',
            climate: 'unknown',
            relation: 'not_comparable',
            score: null,
            evidenceMissing: true,
            private: 'no',
            delta: { lowMinor: '0', highMinor: '1', currency: 'USD', private: 'no' },
          },
        },
      },
    ],
  });
  expect(canonical(c)).not.toMatch(/private|Private Shop|ownerEmail|sourceKey|scenario/);
  expect(c).toMatchObject({ revision: '1', items: [{ snapshot: { fit: 'unverified' } }] });
  expect(() => publicComparison({ items: Array(5).fill({}) })).toThrow();
  expect(() => publicReport({ result: { decisions: 'bad' } })).toThrow();
});
