import { expect, it } from 'vitest';
import type { PartnerAllocationPlan } from '../../packages/application/src/ports/partner-repositories.ts';
import { allocationInput } from '../../packages/db/src/repositories/partner-allocation-input.ts';
const ids = Array.from(
  { length: 6 },
  (_, n) => `10000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
);
function plan() {
  return {
    organizationId: ids[0],
    offerId: ids[1],
    sendId: ids[2],
    subjectId: ids[3],
    poolId: ids[4],
    version: 1,
    slot: 1,
    requestKey: 'synthetic-command',
    policyVersion: 'synthetic-v1',
    reasons: ['local'],
    frequencies: [
      { scope: 'overall_marketing', kind: 'calendar_month', timeZone: 'UTC', limit: 4 },
      { scope: 'offer:' + ids[1], kind: 'rolling_30_days', timeZone: null, limit: 1 },
    ],
    caps: [{ id: ids[5], units: 9007199254740993n }],
  } as unknown as PartnerAllocationPlan;
}
it('captures an immutable command before awaiting persistence and hashes canonical cap/frequency order', () => {
  const input = plan(),
    p = allocationInput(input),
    reverse = allocationInput({ ...input, frequencies: [...input.frequencies].reverse() });
  expect(p.sha256).toBe(reverse.sha256);
  expect(p.caps[0]?.units).toBe('9007199254740993');
  (input.reasons as string[])[0] = 'changed';
  expect(p.reasons).toEqual(['local']);
  expect(allocationInput({ ...plan(), requestKey: 'another' }).sha256).not.toBe(p.sha256);
});
it.each([
  ['slot', 0],
  ['slot', 4],
  ['version', 0],
  ['organizationId', 'not-uuid'],
  ['requestKey', ''],
  ['policyVersion', 'x'.repeat(101)],
  ['caps', []],
  ['caps', [{ id: ids[5], units: 0n }]],
  ['caps', [{ id: ids[5], units: 9223372036854775808n }]],
  ['reasons', Array(33).fill('reason')],
  ['frequencies', []],
] as const)('refuses malformed bounded %s input', (key, value) => {
  expect(() => allocationInput({ ...plan(), [key]: value } as PartnerAllocationPlan)).toThrow();
});
it.each([
  'wrong_scope',
  'duplicate_scope',
  'bad_zone',
  'wrong_kind',
  'zero_limit',
  'duplicate_cap',
])('refuses %s without a persistence call', (kind) => {
  let input = plan();
  const [overall, offer] = input.frequencies;
  if (!overall || !offer) throw Error('fixed fixture');
  if (kind === 'wrong_scope')
    input = { ...input, frequencies: [overall, { ...offer, scope: 'offer:' + ids[0] }] };
  if (kind === 'duplicate_scope') input = { ...input, frequencies: [overall, overall] };
  if (kind === 'bad_zone')
    input = { ...input, frequencies: [{ ...overall, timeZone: 'invalid/zone' }, offer] };
  if (kind === 'wrong_kind')
    input = { ...input, frequencies: [overall, { ...offer, kind: 'calendar_month' }] };
  if (kind === 'zero_limit') input = { ...input, frequencies: [{ ...overall, limit: 0 }, offer] };
  if (kind === 'duplicate_cap') input = { ...input, caps: [...input.caps, ...input.caps] };
  expect(() => allocationInput(input)).toThrow();
});
