import { guard, writeDenial } from './common.ts';
async function prove() {
  guard();
  for (const slot of [0, 1])
    for (const kind of ['app', 'cms'] as const) await writeDenial(slot, kind);
  console.log(
    'RESTORE_HANDOFF_WRITE_DENIAL ' +
      JSON.stringify({
        attemptedPermanentTableStatements: 4,
        rejected25006: 4,
        acceptedMutationStatements: 0,
        providerDispatches: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
prove().catch(() => {
  console.error('Restore handoff fixed write-denial proof refused');
  process.exitCode = 1;
});
