import { expect, it } from 'vitest';
import {
  channels,
  next,
  request,
  identity,
  sameIdentity,
  receipt,
} from '../fixtures/multitarget-coordination/contract.ts';

const ids = ['c0', 'c1', 'i0a', 'i0c', 'i1a', 'i1c'] as const;
const nonce = '1'.repeat(16),
  participant = '2'.repeat(16);
it('fixes six distinct descriptors, endpoints and session keys in canonical order', () => {
  expect(channels.map((c) => c.id)).toEqual(ids);
  expect(channels.map((c) => c.key)).toEqual([
    7724054, 7724054, 7724004, 7724004, 7724004, 7724004,
  ]);
  expect(channels.map((c) => [c.slot, c.kind])).toEqual([
    [0, 'app'],
    [1, 'app'],
    [0, 'app'],
    [0, 'cms'],
    [1, 'app'],
    [1, 'cms'],
  ]);
  expect(Object.isFrozen(channels)).toBe(true);
  for (const c of channels) expect(Object.isFrozen(c)).toBe(true);
});
it.each([0, 1, 2, 3, 4, 5])('admits exactly the acquired prefix at position %i', (i) =>
  expect(next(ids.slice(0, i))).toBe(ids[i]),
);
it.each(
  [[], ['c1'], ['i0a'], ['c0', 'c0'], ['c0', 'i0a'], ['c0', 'c1', 'i0c'], [...ids, 'c0']].map(
    (p) => [p],
  ),
)('refuses invalid or complete allocation %j', (p) => {
  if (!p.length) expect(next(p)).toBe('c0');
  else expect(() => next(p)).toThrow('Coordination proof refused');
});
it('refuses reentrant acquisition after the complete prefix', () =>
  expect(() => next(ids)).toThrow());
it.each(['join', 'register', 'sample'] as const)(
  'admits only the exact private %s message',
  (op) => {
    const value = {
      version: 1,
      nonce,
      op,
      participant,
      ...(op === 'join' ? { kind: 'candidate' } : op === 'register' ? { channel: 'c0' } : {}),
    };
    expect(request(JSON.stringify(value))).toMatchObject(value);
  },
);
it.each([
  { sql: 'SELECT 1' },
  { pid: 1 },
  { key: 7724054 },
  { url: 'postgresql://retained.invalid/x' },
  { timeout: 9999 },
  { callback: 'x' },
  { role: 'postgres' },
  { extra: true },
])('refuses private request extensions %j', (extra) =>
  expect(() =>
    request(JSON.stringify({ version: 1, nonce, op: 'sample', participant, ...extra })),
  ).toThrow(),
);
it.each(['root', 'lose-common0', 'execute', '', null])(
  'refuses an effect-dispatch operation %j',
  (op) => expect(() => request(JSON.stringify({ version: 1, nonce, op, participant }))).toThrow(),
);
it.each(['c2', 'root', 'i0x', 'c0;SELECT 1', null])(
  'refuses an unknown private channel %j',
  (channel) =>
    expect(() =>
      request(JSON.stringify({ version: 1, nonce, op: 'register', participant, channel })),
    ).toThrow(),
);
it.each([
  '{"version":1,"version":1}',
  '[]',
  '\ufeff{}',
  '{}'.repeat(3000),
  '{"op":"sample","\\u006fp":"sample"}',
])('refuses malformed bounded raw IPC %j', (raw) => expect(() => request(raw)).toThrow());
const row = () => ({
  pid: 123,
  start: '2026-10-31 02:00:00.123456+00',
  database: 'tt_app_recovery',
  role: 'tt_app_migrator',
  application: `tt-mt:${nonce}:${participant}:c0`,
  type: 'client backend',
});
it('preserves exact private backend text including microseconds', () => {
  const r = identity(row(), channels[0]!, nonce, participant);
  expect(r.start).toBe('2026-10-31 02:00:00.123456+00');
  expect(sameIdentity(r, row())).toBe(true);
  expect(sameIdentity(r, { ...row(), start: '2026-10-31 02:00:00.123000+00' })).toBe(false);
  expect(Object.isFrozen(r)).toBe(true);
});
it.each([
  { pid: 0 },
  { pid: 1.5 },
  { start: new Date() },
  { database: 'postgres' },
  { role: 'local_harness' },
  { application: 'tt-mt:foreign' },
  { type: 'autovacuum worker' },
])('refuses identity mismatch %j', (patch) =>
  expect(() => identity({ ...row(), ...patch }, channels[0]!, nonce, participant)).toThrow(),
);
it.each(['pid', 'start', 'database', 'role', 'application', 'type'] as const)(
  'refuses a changed %s before any owned-backend fault',
  (key) => expect(sameIdentity(row(), { ...row(), [key]: 'changed' })).toBe(false),
);
it('produces bounded immutable redacted receipts without authority or gate claims', () => {
  const r = receipt({
    status: 'refused',
    trace: ['joined'],
    opened: 0,
    ended: 0,
    workStarted: 0,
    workCompleted: 0,
    lateResults: 0,
    cleanupUnknown: false,
  });
  expect(r).toMatchObject({
    productionPolicyChanged: false,
    independentDurability: false,
    authenticated: false,
    targetFencing: false,
    runtimeAdmission: false,
    hostedAccepted: false,
    productActivation: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
  expect(Object.isFrozen(r)).toBe(true);
  expect(Object.isFrozen(r.trace)).toBe(true);
});
it('refuses trace overflow instead of truncating a clean claim', () =>
  expect(() => receipt({ trace: Array(65).fill('x') })).toThrow());
