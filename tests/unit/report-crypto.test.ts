import { it, expect } from 'vitest';
import { createReportCrypto } from '../../packages/integrations/src/report-crypto.ts';
const a = new Uint8Array(32).fill(1),
  b = new Uint8Array(32).fill(2),
  identity = new Uint8Array(32).fill(3);
it('separates token audiences, supports retained key versions and never changes command identities on bearer-key rotation', () => {
  const old = createReportCrypto('a', { a }, identity),
    rotated = createReportCrypto('b', { a, b }, identity),
    id = old.id('report_capability'),
    token = old.token('share', id, 'a');
  expect(rotated.token('share', id, 'a')).toEqual(token);
  expect(rotated.lookup('share', token.token)).toEqual([token.key]);
  expect(rotated.lookup('download', token.token)).toEqual([]);
  expect(rotated.token('download', id, 'a').key.digest).not.toBe(token.key.digest);
  expect(rotated.hash('actor', 'owner')).toBe(old.hash('actor', 'owner'));
  expect(rotated.hash('actor', 'owner')).not.toBe(old.hash('command-body', 'owner'));
  expect(rotated.id('plan', 'stable')).toBe(old.id('plan', 'stable'));
  expect(old.id('plan')).not.toBe(old.id('plan'));
  expect(JSON.stringify(token)).not.toContain(Buffer.from(a).toString('hex'));
});
it.each([
  null,
  42,
  'share.bad.id.digest',
  'share.a.id.' + 'z'.repeat(64),
  'share.a.x.' + 'a'.repeat(400),
  'share.a.x.' + 'a'.repeat(64) + '.extra',
])('ignores malformed token %s', (token) => {
  const c = createReportCrypto('a', { a }, identity);
  expect(c.lookup('share', token)).toEqual([]);
});
it('rejects missing, weak, overlarge and unavailable key rings', () => {
  for (const [current, keys, stable] of [
    ['a', {}, identity],
    ['a', { a: new Uint8Array(10) }, identity],
    ['x', { a }, identity],
    ['a', { a }, new Uint8Array(1)],
    ['a', { a, b, c: a, d: a, e: a }, identity],
    ['bad.', { 'bad.': a }, identity],
  ] as const)
    expect(() => createReportCrypto(current, keys, stable)).toThrow();
  expect(() => createReportCrypto('a', { a }, identity).token('share', 'id', 'absent')).toThrow();
});
