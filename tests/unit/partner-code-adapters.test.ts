import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPartnerCrypto } from '../../packages/integrations/src/partner-crypto.ts';
import { couponCsv } from '../../packages/integrations/src/partner-csv.ts';
import { createPartnerFiles } from '../../packages/integrations/src/partner-files.ts';
const encoder = new TextEncoder(),
  crypto = createPartnerCrypto('v1', { v1: randomBytes(32) }, randomBytes(32)),
  org = crypto.id('organization'),
  pool = crypto.id('coupon_pool');
it('round trips encrypted coupons with scoped stable dedupe and fresh nonces', () => {
  const a = crypto.seal(org, pool, 'SAVE-20', 'v1'),
    b = crypto.seal(org, pool, 'SAVE-20', 'v1');
  expect(a.hash).toBe(b.hash);
  expect(a.cipherHex).not.toBe(b.cipherHex);
  expect(crypto.open(org, pool, a)).toBe('SAVE-20');
  expect(a.cipherHex).not.toContain(Buffer.from('SAVE-20').toString('hex'));
});
it('refuses cross-pool, cross-org, tampered and missing-key code boxes', () => {
  const a = crypto.seal(org, pool, 'SAFE', 'v1');
  expect(() => crypto.open(crypto.id('organization'), pool, a)).toThrow();
  expect(() => crypto.open(org, crypto.id('coupon_pool'), a)).toThrow();
  expect(() =>
    crypto.open(org, pool, {
      ...a,
      cipherHex:
        a.cipherHex.slice(0, -2) +
        (parseInt(a.cipherHex.slice(-2), 16) ^ 1).toString(16).padStart(2, '0'),
    }),
  ).toThrow();
  expect(() => crypto.open(org, pool, { ...a, keyVersion: 'missing' })).toThrow();
  expect(() => crypto.open(org, pool, { ...a, hash: '0'.repeat(64) })).toThrow();
});
it('binds deterministic command IDs to kind and key', () => {
  expect(crypto.id('organization', 'a')).toBe(crypto.id('organization', 'a'));
  expect(crypto.id('organization', 'a')).not.toBe(crypto.id('pool', 'a'));
  expect(crypto.digest({ a: 1, b: 2n })).toBe(crypto.digest({ b: 2n, a: 1 }));
});
it('copies configured keys and verifies invitation token shape', () => {
  expect(crypto.token()).toHaveLength(43);
  expect(crypto.tokenHash(crypto.token())).toHaveLength(64);
  expect(() => crypto.tokenHash('bad')).toThrow();
  expect(() =>
    createPartnerCrypto('none', { v1: new Uint8Array(32) }, new Uint8Array(32)),
  ).toThrow();
});
it('parses quoted and CRLF code CSV without changing code case', () => {
  expect([...couponCsv(encoder.encode('code\r\n"Save-1"\r\nSAVE2\r\n'))]).toEqual([
    { row: 1, code: 'Save-1', reason: null },
    { row: 2, code: 'SAVE2', reason: null },
  ]);
});
it.each(['wrong\na', 'code,other\na,b', 'code\n', 'code\n' + 'x'.repeat(513), 'code\n\0'])(
  'refuses invalid CSV envelope %s',
  (text) => {
    expect(() => [...couponCsv(encoder.encode(text))]).toThrow();
  },
);
it('counts malformed/formula rows without exposing them in errors', () => {
  const rows = [...couponCsv(encoder.encode('code\n=SUM(A1)\n"unclosed'))];
  expect(rows).toEqual([
    { row: 1, code: null, reason: 'invalid_code' },
    { row: 2, code: null, reason: 'malformed_csv' },
  ]);
});
it('bounds 100000 rows and refuses the next', () => {
  const bytes = encoder.encode(
    'code\n' + Array.from({ length: 100000 }, (_, i) => 'CODE' + i).join('\n'),
  );
  expect([...couponCsv(bytes)]).toHaveLength(100000);
  expect(() => [
    ...couponCsv(encoder.encode(new TextDecoder().decode(bytes) + '\nOVER')),
  ]).toThrow();
});
it('accepts only explicit structured private evidence and coupon bytes', async () => {
  const f = createPartnerFiles(),
    bytes = encoder.encode('{"registry":"synthetic"}');
  expect(await f.inspect('verification', 'application/json', bytes)).toEqual(bytes);
  expect(await f.inspect('coupon_pool', 'text/csv', encoder.encode('code\nA'))).toBeInstanceOf(
    Uint8Array,
  );
  await expect(f.inspect('verification', 'text/html', bytes)).rejects.toThrow();
  await expect(
    f.inspect('agreement', 'application/json', encoder.encode('{"x":"<script>"}')),
  ).rejects.toThrow();
  await expect(f.inspect('logo', 'image/svg+xml', bytes)).rejects.toThrow();
});
it('validates and strips PNG metadata by bounded re-encoding', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAGHRFWHRDb21tZW50AHByaXZhdGUgbWV0YWRhdGGezJzmAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  const f = createPartnerFiles();
  const clean = await f.inspect('logo', 'image/png', png);
  expect(Buffer.from(clean).includes(Buffer.from('private metadata'))).toBe(false);
  expect(clean.length).toBeLessThan(png.length);
  expect(await f.inspect('logo', 'image/png', clean)).toEqual(clean);
  const bad = png.slice();
  bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
  await expect(f.inspect('logo', 'image/png', bad)).rejects.toThrow();
  await expect(f.inspect('logo', 'image/png', new Uint8Array(4))).rejects.toThrow();
});

it('copies Node Buffer input so later caller mutations cannot change inspected bytes', async () => {
  const source = Buffer.from('code\nBEFORE'),
    expected = new Uint8Array(source),
    clean = await createPartnerFiles().inspect('coupon_pool', 'text/csv', source);
  source.fill(88);
  expect(new Uint8Array(clean)).toEqual(expected);
});
