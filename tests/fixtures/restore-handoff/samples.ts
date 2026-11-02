import type { Bindings, Current, Seal, Observation } from './contract.ts';
export function sample() {
  const now = Date.parse('2026-11-02T12:00:00.000Z');
  const bindings: Bindings = {
    project: 'tt-test-' + 'a'.repeat(16),
    generation: 'b'.repeat(32),
    image: 'sha256:' + 'c'.repeat(64),
    config: 'd'.repeat(64),
    sourceDigest: 'e'.repeat(64),
  };
  const current: Current = {
    version: 1,
    project: bindings.project,
    generation: bindings.generation,
    digest: 'a'.repeat(64),
    observedAt: new Date(now - 250).toISOString(),
    backupFinishedAt: new Date(now - 1000).toISOString(),
  };
  const observations: Observation[] = [0, 1].flatMap((slot) =>
    (['app', 'cms'] as const).map((kind) => ({
      slot,
      kind,
      catalog: '1'.repeat(64),
      rows: '2'.repeat(64),
      sequences: '3'.repeat(64),
      security: '4'.repeat(64),
      history: '5'.repeat(64),
      populated: true,
      historiesValid: true,
      quarantined: true,
      tables: kind === 'app' ? 141 : 28,
    })),
  );
  const seal: Seal = {
    version: 1,
    phase: 'maintenance-closed',
    ...bindings,
    maintenanceClosedAt: now - 500,
    setup: { appRestored: true, cmsRestored: true, privacyReplayed: true, maintenanceClosed: true },
    checkpoint: structuredClone(current),
    observations,
  };
  return { now, bindings, current, seal };
}
