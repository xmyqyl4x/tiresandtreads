import { it, expect } from 'vitest';
import {
  quotedDifference,
  addChoice,
  replaceChoice,
  removeChoice,
  blankQuote,
  quoteBody,
  shareReference,
  existingShare,
  type Choices,
} from '../../apps/web/src/comparison/model.ts';
import { uuid } from '../fixtures/engine/base.ts';
const item = (n: number) => ({ kind: 'catalog' as const, key: uuid(n) });
function four() {
  let s: Choices = { items: [], pending: null };
  for (let i = 1; i <= 4; i++) s = addChoice(s, item(i));
  return s;
}
it('keeps four items unchanged when a fifth requires an explicit choice', () => {
  const s = four(),
    next = addChoice(s, item(5));
  expect(next.items).toEqual(s.items);
  expect(next.pending).toEqual(item(5));
  expect(replaceChoice(next, 1)).toEqual({
    items: [item(1), item(5), item(3), item(4)],
    pending: null,
  });
  expect(s.items).toHaveLength(4);
});
it('does not silently insert a pending fifth item when removing a slot', () => {
  const s = removeChoice(addChoice(four(), item(5)), 2);
  expect(s.items).toEqual([item(1), item(2), item(4)]);
  expect(s.pending).toEqual(item(5));
  expect(addChoice({ ...s, pending: null }, s.pending!)).toEqual({
    items: [item(1), item(2), item(4), item(5)],
    pending: null,
  });
});
it('deduplicates the same selection while preserving distinct quote/catalog kinds', () => {
  const s = four();
  expect(addChoice(s, item(1))).toBe(s);
  expect(addChoice(s, { kind: 'quote', key: uuid(1) }).pending).toMatchObject({ kind: 'quote' });
});
it.each([-1, 4, NaN])('refuses an invalid replacement or removal slot %s', (n) => {
  expect(() => replaceChoice({ ...four(), pending: item(5) }, n)).toThrow();
  expect(() => removeChoice(four(), n)).toThrow();
});
it('requires the quoted product, quantity, price basis, amount and date instead of inventing defaults', () => {
  const v = quoteBody(blankQuote());
  expect(v.ok).toBe(false);
  if (!v.ok)
    expect(Object.keys(v.errors).sort()).toEqual([
      'amount',
      'basis',
      'observedOn',
      'product',
      'quantity',
    ]);
});
function valid() {
  return {
    ...blankQuote(),
    product: 'Unknown example tire',
    amount: '199.99',
    quantity: '4',
    basis: 'per_tire',
    observedOn: '2026-11-03',
  };
}
it('keeps unknown product, tax and required fees unknown and omits unrequested alignment', () => {
  const v = quoteBody(valid());
  expect(v.ok).toBe(true);
  if (v.ok) {
    expect(v.input).toMatchObject({
      skuId: null,
      totalMinor: '19999',
      taxIncluded: null,
      taxContextConfirmed: false,
      quantity: 4,
      basis: 'per_tire',
    });
    expect(v.input.components).toHaveLength(6);
    expect(v.input.components.every((c) => c.minor === null && !c.included)).toBe(true);
  }
});
it('records exact extra amounts and explicit included/zero assumptions without computing totals', () => {
  const f = valid();
  f.charges.mounting = { state: 'extra', amount: '2.30', basis: 'per_tire' };
  f.charges.tax.state = 'included';
  f.charges.disposal.state = 'zero';
  f.alignment = true;
  const v = quoteBody(f);
  expect(v.ok).toBe(true);
  if (v.ok) {
    expect(v.input.totalMinor).toBe('19999');
    expect(v.input.taxIncluded).toBe(true);
    expect(v.input.components).toContainEqual({
      kind: 'mounting',
      included: false,
      basis: 'per_tire',
      minor: '230',
    });
    expect(v.input.components).toContainEqual({
      kind: 'disposal',
      included: false,
      basis: 'per_order',
      minor: '0',
    });
    expect(v.input.components).toHaveLength(7);
  }
});
it.each(['-1', '1e3', '1.111', '1,000'])('refuses ambiguous/invalid dollar entry %s', (amount) =>
  expect(quoteBody({ ...valid(), amount }).ok).toBe(false),
);
it('requires a stated extra fee amount and bounds private text', () => {
  const f = valid();
  f.shop = 'x'.repeat(201);
  f.charges.mounting.state = 'extra';
  const v = quoteBody(f);
  expect(v.ok).toBe(false);
  if (!v.ok)
    expect(v.errors).toMatchObject({
      shop: expect.any(String),
      'extra-mounting': expect.any(String),
    });
});
it('uses a same-site fragment for a share and supports owner revocation from an existing link', () => {
  const token = 'share.test.' + uuid(2) + '.' + 'c'.repeat(64),
    link = shareReference('http://127.0.0.1:8380', token);
  expect(new URL(link).search).toBe('');
  expect(existingShare('http://127.0.0.1:8380', link)).toEqual({ token, capability: uuid(2) });
  expect(existingShare('http://127.0.0.1:8480', link)).toBeNull();
  expect(existingShare('http://127.0.0.1:8380', link.replace('#', '?token='))).toBeNull();
  expect(() => shareReference('http://127.0.0.1:8380', 'bad')).toThrow();
});

it('formats the authoritative signed quote difference without recomputing it', () => {
  expect(quotedDifference({ lowMinor: '-123', highMinor: '456', currency: 'USD' })).toBe(
    '-$1.23 to $4.56 USD',
  );
  expect(quotedDifference(null)).toBe('Unavailable');
  expect(quotedDifference({ lowMinor: '0', highMinor: '0', currency: 'USD' })).toBe('$0.00 USD');
});
