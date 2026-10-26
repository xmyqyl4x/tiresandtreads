import { it, expect } from 'vitest';
import { normalizeEmail, browserPolicy } from '../../packages/domain/src/contact-policy.ts';
it('preserves delivery spelling and provider aliases while normalizing the domain', () => {
  expect(normalizeEmail('  A.b+tag@EXAMPLE.COM  ')).toBe('A.b+tag@example.com');
  expect(normalizeEmail('a.b+tag@example.com')).not.toBe(normalizeEmail('A.b+tag@example.com'));
});
it.each([
  '',
  'a',
  'a@localhost',
  'a\r\n@example.com',
  'a..b@example.com',
  '.a@example.com',
  'a@-bad.com',
  'é@example.com',
  'a@b.com,a@c.com',
  'a'.repeat(65) + '@example.com',
])('rejects unsupported or malformed address %s', (x) => {
  expect(() => normalizeEmail(x)).toThrow();
});
it('defaults to necessary only on missing, failed or expired consent and applies GPC independently', () => {
  expect(browserPolicy([], true, false)).toEqual({
    necessary: true,
    analytics: false,
    ads: false,
    targeted_ads: false,
    identity_sharing: false,
  });
  expect(
    browserPolicy(['analytics', 'ads', 'targeted_ads', 'identity_sharing'], false, true),
  ).toEqual({
    necessary: true,
    analytics: true,
    ads: true,
    targeted_ads: true,
    identity_sharing: false,
  });
  expect(browserPolicy(['analytics', 'ads', 'targeted_ads'], true, true).targeted_ads).toBe(false);
  expect(browserPolicy(['analytics', 'ads'], false, false).analytics).toBe(false);
});
