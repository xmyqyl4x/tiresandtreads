import { expect, it } from 'vitest';
import { rightsPolicy } from '../../packages/domain/src/privacy-policy.ts';
import { rightsClock } from '../../packages/application/src/services/privacy-clock.ts';
const policy = { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 5 };
it('uses reviewed jurisdiction configuration and a calendar response clock', () => {
  expect(rightsPolicy(policy)).toEqual(policy);
  expect(rightsClock('2026-10-26T12:00:00.000Z', policy)).toEqual({
    dueAt: '2026-11-09T12:00:00.000Z',
    proofExpiresAt: '2026-10-26T12:30:00.000Z',
  });
});
it.each([
  {},
  { ...policy, responseDays: 0 },
  { ...policy, responseDays: 366 },
  { ...policy, escalationDays: 14 },
  { ...policy, proofMinutes: 1441 },
  { ...policy, maxAttempts: 100 },
  { ...policy, script: 'DELETE' },
])('rejects invalid policy %j', (p) => {
  expect(() => rightsPolicy(p)).toThrow();
});
