import { it, expect } from 'vitest';
import { retryDecision, validateMail } from '../../packages/domain/src/delivery-policy.ts';
const at = '2026-10-25T00:00:00.000Z';
it('never retries beyond the conservative provider window or attempt limit', () => {
  expect(retryDecision(at, '2026-10-25T22:59:59.000Z', 4)).toBe('retry');
  expect(retryDecision(at, '2026-10-25T23:00:00.000Z', 4)).toBe('manual_review');
  expect(retryDecision(at, at, 5)).toBe('manual_review');
  expect(() => retryDecision(at, 'bad', 1)).toThrow();
  expect(() => retryDecision(at, at, -1)).toThrow();
});
it('requires a bounded fixed report message without injected headers or remote attachments', () => {
  const value = {
    subject: 'Technical fixture',
    html: '<p>Fixture</p>',
    text: 'Fixture',
    pdf: 'JVBERi0xLjQK',
    fixture: true,
    commercial: false as const,
  };
  expect(validateMail(value)).toEqual(value);
  for (const invalid of [
    { ...value, subject: 'a\r\nBcc: x' },
    { ...value, html: '' },
    { ...value, text: 'a'.repeat(65537) },
    { ...value, pdf: 'http://private.test/pdf' },
    { ...value, commercial: true },
    { ...value, unknown: true },
  ])
    expect(() => validateMail(invalid as never)).toThrow();
});
it.each([
  ['bad', at, 1],
  [at, 'bad', 1],
  [at, at, -1],
  [at, at, 1.5],
  [at, '2026-10-24T00:00:00.000Z', 1],
])('rejects invalid retry clocks/counts %#', (first, now, n) =>
  expect(() => retryDecision(first as string, now as string, n as number)).toThrow(),
);
const message = {
  subject: 'Report',
  html: '<p>Report</p>',
  text: 'Report',
  pdf: 'JVBERi0xLjQK',
  fixture: false,
  commercial: false as const,
};
it.each([
  { ...message, subject: 42 },
  { ...message, subject: ' ' },
  { ...message, subject: 'x'.repeat(201) },
  { ...message, html: null },
  { ...message, html: '\u00e9'.repeat(50000) },
  { ...message, text: '' },
  { ...message, text: null },
  { ...message, text: '\u00e9'.repeat(32769) },
  { ...message, pdf: null },
  { ...message, pdf: 'JVBERi0=====' },
  { ...message, pdf: 'JVBERi0xLjQKx' },
  { ...message, pdf: 'JVBERi0' + 'A'.repeat(6 * 1024 * 1024) },
  { ...message, fixture: 'yes' },
])('rejects unsafe or oversized fixed message %#', (v) =>
  expect(() => validateMail(v as never)).toThrow(),
);
it('measures UTF-8 limits in bytes and accepts exact text/html boundaries', () =>
  expect(
    validateMail({ ...message, html: '\u00e9'.repeat(49999), text: '\u00e9'.repeat(32768) }),
  ).toHaveProperty('fixture', false));
