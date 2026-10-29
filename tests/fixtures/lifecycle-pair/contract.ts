import { digest } from '../../../scripts/database/inventory.ts';
import {
  lifecyclePhases,
  type LifecyclePhase,
  inspectLifecycle,
} from '../lifecycle-validation/reader.ts';

// Test-only state machine. The SQL coordinator supplies reports; no production
// process imports this module or treats its records as release authority.
export interface PairBinding {
  readonly project: string;
  readonly fixtureId: string;
  readonly operationId: string;
  readonly releaseDigest: string;
  readonly credentialGeneration: string;
  readonly phase: LifecyclePhase;
  readonly sourceDigest: string;
  readonly baselineDigest: string;
  readonly targetsDigest: string;
}
export type Inspection = Awaited<ReturnType<typeof inspectLifecycle>>;
const flags = { hostedAccepted: false, productActivation: false, runtimeAdmission: false } as const;
const ttlMs = 15000;

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function pairCompatible(reports: readonly Inspection[], phase: LifecyclePhase) {
  return (
    reports.length === 2 &&
    reports.every(
      (r, i) =>
        r.scope === 'disposable-local-lifecycle' &&
        r.target === (i === 0 ? 'app' : 'cms') &&
        r.phase === phase &&
        r.status === 'compatible' &&
        r.compatible === true &&
        r.findings.length === 0 &&
        r.hostedAccepted === false &&
        r.productActivation === false &&
        r.checks?.readOnly === true &&
        r.checks.tls === true &&
        r.checks.scopedRoles === 19 &&
        r.checks.memberships === 0 &&
        r.checks.migrations === (phase === 'foundation' ? 0 : i === 0 ? 33 : 3),
    )
  );
}

export function receiptLedger(raw: PairBinding) {
  const keys = [
    'project',
    'fixtureId',
    'operationId',
    'releaseDigest',
    'credentialGeneration',
    'phase',
    'sourceDigest',
    'baselineDigest',
    'targetsDigest',
  ];
  if (
    !raw ||
    Object.keys(raw).length !== keys.length ||
    Object.keys(raw).some((k) => !keys.includes(k)) ||
    keys.some((k) => typeof raw[k as keyof PairBinding] !== 'string') ||
    !/^tt-test-[a-f0-9]{16}$/.test(raw.project) ||
    !lifecyclePhases.includes(raw.phase) ||
    ['fixtureId', 'operationId', 'credentialGeneration'].some(
      (k) => !/^[a-f0-9]{32}$/.test(raw[k as keyof PairBinding]),
    ) ||
    ['releaseDigest', 'sourceDigest', 'baselineDigest', 'targetsDigest'].some(
      (k) => !/^[a-f0-9]{64}$/.test(raw[k as keyof PairBinding]),
    )
  )
    throw Error('Invalid disposable pair binding');
  const binding = freeze({ ...raw });
  let epoch = 0;
  let current: object | null = null;
  let started = 0;
  let issued = 0;
  function invalidate() {
    epoch++;
    current = null;
  }
  return {
    invalidate,
    begin(now: number) {
      invalidate();
      started = now;
      return epoch;
    },
    issue(ticket: number, reports: readonly Inspection[], now: number) {
      if (
        ticket !== epoch ||
        current ||
        !Number.isFinite(started) ||
        !Number.isFinite(now) ||
        now < started ||
        now - started >= ttlMs ||
        !pairCompatible(reports, binding.phase)
      )
        return null;
      // Select only bounded public summaries. No URI, password or password hash,
      // row values, SQL text, CA body or driver errors enter the receipt.
      const observations = reports.map((r) => ({
        target: r.target!,
        phase: r.phase!,
        checks: {
          readOnly: r.checks!.readOnly,
          tls: r.checks!.tls,
          serverVersion: r.checks!.serverVersion,
          scopedRoles: r.checks!.scopedRoles,
          memberships: r.checks!.memberships,
          migrations: r.checks!.migrations,
        },
      }));
      const record = {
        scope: 'disposable-local-pair' as const,
        formatVersion: 1 as const,
        ...binding,
        epoch,
        issuedAt: new Date().toISOString(),
        ttlMs,
        observations,
        ...flags,
      };
      const receipt = freeze({ ...record, digest: digest(record) });
      current = receipt;
      issued = now;
      return receipt;
    },
    consume(candidate: unknown, now: number) {
      const valid =
        current !== null &&
        candidate === current &&
        Number.isFinite(now) &&
        now >= issued &&
        now - started < ttlMs;
      invalidate();
      return valid;
    },
    isCurrent(ticket: number) {
      return ticket === epoch;
    },
  };
}

export type PairReceipt = NonNullable<ReturnType<ReturnType<typeof receiptLedger>['issue']>>;
