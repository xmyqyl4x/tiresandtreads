import { it, expect } from 'vitest';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
const k = new Uint8Array(32).fill(5),
  j = new Uint8Array(32).fill(6),
  stable = new Uint8Array(32).fill(7);
it('separates audiences, HMAC lookups and stable command identities across rotations', () => {
  const a = createContactCrypto('v1', { v1: k }, { l1: k }, stable),
    b = createContactCrypto('v2', { v1: k, v2: j }, { l1: k, l2: j }, stable),
    id = a.id('verification', 'stable');
  const t = a.token('verify', id, 'v1');
  expect(b.parse('verify', t.raw)?.id).toBe(id);
  expect(b.parse('unsubscribe', t.raw)).toBeNull();
  expect(b.id('verification', 'stable')).toBe(id);
  expect(b.hash('body', 'a')).toBe(a.hash('body', 'a'));
  expect(a.hash('key', 'a')).not.toBe(a.hash('body', 'a'));
  expect(b.emailKeys('a@example.com')).toContainEqual(a.emailKeys('a@example.com')[0]);
  expect(a.emailKeys('A@EXAMPLE.COM')).toEqual(a.emailKeys('a@example.com'));
  expect(a.id('contact')).not.toBe(a.id('contact'));
  expect(b.token('unsubscribe', id, 'v1').key).not.toEqual(t.key);
  expect(() => a.token('verify', id, 'missing')).toThrow();
  for (const raw of [
    '',
    'verify.v1.invalid.' + 'a'.repeat(64),
    t.raw.slice(0, -1) + '0',
    'v'.repeat(300),
    t.raw.replace('.v1.', '.v3.'),
    t.raw + '.extra',
    t.raw.slice(0, -1) + 'z',
  ])
    expect(a.parse('verify', raw)).toBeNull();
});
it.each([
  {},
  { bad: new Uint8Array(3) },
  { 'invalid.version': k },
  Object.fromEntries([1, 2, 3, 4, 5].map((i) => ['v' + i, k])),
])('rejects invalid keyrings', (ring) => {
  expect(() => createContactCrypto('v1', ring, { l1: k }, stable)).toThrow();
  expect(() => createContactCrypto('v1', { v1: k }, ring, stable)).toThrow();
});
it('requires a current bearer key and a strong independent identity key', () => {
  expect(() => createContactCrypto('v2', { v1: k }, { l1: k }, stable)).toThrow();
  expect(() => createContactCrypto('v1', { v1: k }, { l1: k }, new Uint8Array(4))).toThrow();
});
