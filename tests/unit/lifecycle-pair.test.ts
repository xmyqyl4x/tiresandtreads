import { expect, it } from 'vitest';
import { receiptLedger, type PairBinding } from '../fixtures/lifecycle-pair/contract.ts';
import { binding, reports } from '../fixtures/lifecycle-pair/samples.ts';

it('issues frozen, redacted, exact-pair evidence and consumes it once with a monotonic expiry', () => {
  const ledger = receiptLedger(binding);
  const ticket = ledger.begin(100);
  const receipt = ledger.issue(ticket, reports(), 150);
  expect(receipt).toMatchObject({ ...binding, scope: 'disposable-local-pair', ttlMs: 15000 });
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(Object.isFrozen(receipt!.observations)).toBe(true);
  expect(receipt!.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(ledger.consume(receipt, 200)).toBe(true);
  expect(ledger.consume(receipt, 201)).toBe(false);
});

it.each([
  { project: 'tt-stage' },
  { phase: 'runtime-eligible' },
  { operationId: 'named-operator' },
  { releaseDigest: 'main' },
  { credentialGeneration: 'password' },
  { fixtureId: '' },
  { targetsDigest: 'hosted' },
  { sql: 'repair' },
])('refuses malformed or expanded trusted binding %j', (patch) => {
  expect(() => receiptLedger({ ...binding, ...patch } as PairBinding)).toThrow(
    'Invalid disposable pair binding',
  );
});

it.each(['configuration', 'unavailable', 'incompatible'] as const)(
  'refuses a %s result on either side and never issues partial evidence',
  (status) => {
    for (const side of [0, 1]) {
      const ledger = receiptLedger(binding),
        ticket = ledger.begin(100),
        pair = reports();
      const invalid = pair.map((r, i) => (i === side ? { ...r, status, compatible: false } : r));
      expect(ledger.issue(ticket, invalid, 200)).toBeNull();
    }
  },
);

it.each(['missing', 'duplicate', 'mixed-phase', 'wrong-target', 'unsafe-flags', 'unsafe-checks'])(
  'rejects a %s pair rather than trusting a success label',
  (fault) => {
    const ledger = receiptLedger(binding),
      ticket = ledger.begin(100);
    const pair = reports();
    if (fault === 'missing') pair.pop();
    if (fault === 'duplicate') pair[1] = pair[0]!;
    if (fault === 'mixed-phase') pair[1]!.phase = 'foundation';
    if (fault === 'wrong-target') pair[0]!.target = 'cms';
    if (fault === 'unsafe-flags') Object.assign(pair[1]!, { productActivation: true });
    if (fault === 'unsafe-checks') pair[1]!.checks.memberships = 1;
    expect(ledger.issue(ticket, pair, 200)).toBeNull();
  },
);

it('does not trust exported JSON, another fixture, operation, release or credential generation', () => {
  const ledger = receiptLedger(binding),
    receipt = ledger.issue(ledger.begin(100), reports(), 200)!;
  expect(ledger.consume(JSON.parse(JSON.stringify(receipt)), 300)).toBe(false);
  for (const field of [
    'fixtureId',
    'operationId',
    'releaseDigest',
    'credentialGeneration',
    'sourceDigest',
    'baselineDigest',
    'targetsDigest',
  ] as const) {
    const other = receiptLedger({ ...binding, [field]: 'a'.repeat(binding[field].length) });
    expect(other.consume(receipt, 300)).toBe(false);
  }
});

it('expires from the start of observation, rejects backward time, and refuses obsolete or invalidated epochs', () => {
  for (const now of [99, 15100, NaN, Infinity]) {
    const ledger = receiptLedger(binding),
      receipt = ledger.issue(ledger.begin(100), reports(), 200);
    expect(ledger.consume(receipt, now)).toBe(false);
  }
  const ledger = receiptLedger(binding),
    ticket = ledger.begin(100);
  ledger.invalidate();
  expect(ledger.issue(ticket, reports(), 200)).toBeNull();
  const current = ledger.issue(ledger.begin(300), reports(), 400);
  ledger.begin(500);
  expect(ledger.consume(current, 600)).toBe(false);
});

it('refuses observations that already exhausted the bounded evidence lifetime', () => {
  const ledger = receiptLedger(binding),
    ticket = ledger.begin(100);
  expect(ledger.issue(ticket, reports(), 15100)).toBeNull();
});

it('rejects a clock value earlier than receipt issuance, even if after observation started', () => {
  const ledger = receiptLedger(binding),
    receipt = ledger.issue(ledger.begin(100), reports(), 200);
  expect(ledger.consume(receipt, 199)).toBe(false);
});

it('serializes only selected receipt fields even when a synthetic report has extra private fields', () => {
  const ledger = receiptLedger(binding),
    pair = reports();
  Object.assign(pair[0]!.checks, { password: 'private-sentinel', sql: 'private-sentinel' });
  const receipt = ledger.issue(ledger.begin(100), pair, 200);
  expect(JSON.stringify(receipt)).not.toContain('private-sentinel');
});

it('refuses coercible objects as identity labels before formatting or receipt serialization', () => {
  for (const field of Object.keys(binding).filter((k) => k !== 'phase')) {
    const value = {
      toString: () => binding[field as keyof PairBinding],
      private: 'private-sentinel',
    };
    expect(() => receiptLedger({ ...binding, [field]: value } as unknown as PairBinding)).toThrow(
      'Invalid disposable pair binding',
    );
  }
});
