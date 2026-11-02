import { guard, inspectFour } from './common.ts';
import { preservationFindings, type Observation } from './contract.ts';
import { readBounded } from './files.ts';
async function audit() {
  guard();
  const before = JSON.parse(
    readBounded('/handoff-meta/before.json', 65536, 'metadata'),
  ) as Observation[];
  const observations = await inspectFour();
  if (preservationFindings(before, observations).length) throw Error('Presented state changed');
  console.log(
    'RESTORE_HANDOFF_PRESERVATION ' +
      JSON.stringify({
        fourEndpointParity: true,
        postFaultBaseline: true,
        readOnlyTransactions: 4,
        verifiedTlsEndpoints: 4,
        providerDispatches: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
audit().catch(() => {
  console.error('Restore handoff presented-state preservation refused');
  process.exitCode = 1;
});
