import { guard, bindings, inspectEndpoint, ReadFault } from './common.ts';
import {
  admitSeal,
  compareObservations,
  terminal,
  HandoffRefusal,
  type Observation,
} from './contract.ts';
import { readBounded, readCurrentFile } from './files.ts';

let attempts = 0,
  ends = 0;
const observations: Observation[] = [];
async function observe() {
  guard();
  const raw = readBounded('/handoff-meta/seal.json', 65536, 'metadata');
  const seal = admitSeal(raw, bindings(), Date.now());
  readCurrentFile('/handoff-current/current.json', seal, Date.now());
  if (
    process.env.HANDOFF_OBSERVER_MODE !== undefined &&
    process.env.HANDOFF_OBSERVER_MODE !== 'loss'
  )
    throw new HandoffRefusal('mode');
  for (const e of seal.observations) {
    attempts++;
    try {
      observations.push(await inspectEndpoint(e.slot, e.kind));
      ends++;
    } catch (error) {
      if (error instanceof ReadFault && error.nativeEndObserved) ends++;
      throw error;
    }
    if (process.env.HANDOFF_OBSERVER_MODE === 'loss' && observations.length === 1) {
      console.log(
        'RESTORE_HANDOFF_STARTED ' +
          JSON.stringify({
            firstEndpointObserved: true,
            firstDriverEndObserved: true,
            wholeBatchComplete: false,
          }),
      );
      // Fixed bounded parent stop point after a closed read. No claim of killing pending SQL.
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  if (readBounded('/handoff-meta/seal.json', 65536, 'metadata') !== raw)
    throw new HandoffRefusal('phase-changed');
  readCurrentFile('/handoff-current/current.json', seal, Date.now());
  const findings = compareObservations(seal.observations, observations);
  const receipt = terminal(
    findings.length ? 'refused' : 'success',
    findings.length ? 'catalog-drift' : 'compatible',
    attempts,
    ends,
  );
  console.log(
    'RESTORE_HANDOFF_OBSERVATION ' +
      JSON.stringify({
        ...receipt,
        findings,
        completedEndpointObservations: observations.length,
        verifiedTlsEndpoints: observations.length,
        readOnlyTransactions: observations.length,
      }),
  );
}
observe().catch((error) => {
  const code = error instanceof HandoffRefusal ? error.code : 'observation-unavailable';
  const status =
    error instanceof ReadFault && !error.nativeEndObserved
      ? 'unknown'
      : code === 'checkpoint-unavailable' ||
          code === 'metadata-unavailable' ||
          code === 'observation-unavailable' ||
          code === 'read-unavailable'
        ? 'unavailable'
        : 'refused';
  console.log(
    'RESTORE_HANDOFF_OBSERVATION ' +
      JSON.stringify({
        ...terminal(status, code, attempts, ends),
        findings: [],
        completedEndpointObservations: observations.length,
        verifiedTlsEndpoints: observations.length,
        readOnlyTransactions: observations.length,
      }),
  );
});
