import { randomBytes } from 'node:crypto';
import { it, expect } from 'vitest';
import { createInsightsTokens } from '../../packages/integrations/src/insights-tokens.ts';
const key = randomBytes(32),
  crypto = createInsightsTokens(key),
  at = Date.now(),
  data = { subject: '9ab86510-dce1-480c-9560-7694c68ab235', week: '2026-10-26' };
it('encrypts visitor handles without exposing subject IDs and survives a fresh adapter', () => {
  const token = crypto.issue('staff', 'visitor', data, at);
  expect(Buffer.from(token, 'base64url').toString()).not.toContain(data.subject);
  expect(createInsightsTokens(key).parse('staff', 'visitor', token, at + 1)).toEqual(data);
});
it('randomizes repeated handles', () =>
  expect(crypto.issue('staff', 'visitor', data, at)).not.toBe(
    crypto.issue('staff', 'visitor', data, at),
  ));
it.each([
  'actor',
  'purpose',
  'key',
  'tamper',
  'expired',
  'future',
  'invalid',
  'short',
  'long',
  'clock',
])('rejects %s token use', (kind) => {
  let token = crypto.issue('staff', 'visitor', data, at),
    actor = 'staff',
    purpose: 'visitor' | 'page' = 'visitor',
    now = at;
  if (kind === 'actor') actor = 'other';
  if (kind === 'purpose') purpose = 'page';
  if (kind === 'tamper') token = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
  if (kind === 'expired') now += 900000;
  if (kind === 'future') now--;
  if (kind === 'invalid') token = '%';
  if (kind === 'short') token = 'abcd';
  if (kind === 'long') token = 'a'.repeat(1025);
  if (kind === 'clock') now = NaN;
  expect(
    (kind === 'key' ? createInsightsTokens(randomBytes(32)) : crypto).parse(
      actor,
      purpose,
      token,
      now,
    ),
  ).toBeNull();
});
it('rejects invalid key lengths', () =>
  expect(() => createInsightsTokens(new Uint8Array(31))).toThrow());
it('rejects authenticated invalid payload IDs', () =>
  expect(
    crypto.parse(
      'staff',
      'page',
      crypto.issue('staff', 'page', { ...data, subject: 'invalid' }, at),
      at,
    ),
  ).toBeNull());
