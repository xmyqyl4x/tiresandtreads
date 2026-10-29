import type { PairBinding } from './contract.ts';

// Synthetic records for pure state decisions; SQL behavior is tested separately.
export const binding: PairBinding = {
  project: 'tt-test-0123456789abcdef',
  fixtureId: '1'.repeat(32),
  operationId: '2'.repeat(32),
  releaseDigest: '3'.repeat(64),
  credentialGeneration: '4'.repeat(32),
  phase: 'migrated',
  sourceDigest: '5'.repeat(64),
  baselineDigest: '6'.repeat(64),
  targetsDigest: '7'.repeat(64),
};
export const reports = (phase = binding.phase) =>
  (['app', 'cms'] as const).map((target) => ({
    scope: 'disposable-local-lifecycle' as const,
    target,
    phase,
    status: 'compatible' as const,
    compatible: true,
    findings: [],
    hostedAccepted: false as const,
    productActivation: false as const,
    checks: {
      readOnly: true,
      tls: true,
      serverVersion: 180006,
      scopedRoles: 19,
      memberships: 0,
      migrations: phase === 'foundation' ? 0 : target === 'app' ? 33 : 3,
    },
  }));
