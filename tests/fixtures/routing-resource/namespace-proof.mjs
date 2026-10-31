import { randomBytes } from 'node:crypto';
import { run } from '../../../scripts/lib/process.mjs';
import { assertFresh } from './ownership.mjs';

// Two fixed parent-owned surrogate volumes. Refusal must not enter primary
// setup/down scope. Only the explicit creator may later remove its surrogates.
export function namespaceProof() {
  for (const mode of ['unlabelled-name', 'foreign-name-labelled']) {
    const project = 'tt-test-' + randomBytes(8).toString('hex');
    const other = 'tt-test-' + randomBytes(8).toString('hex');
    assertFresh(project);
    assertFresh(other);
    const name = mode === 'unlabelled-name' ? project + '_postgres-data' : other + '_collision';
    const token = randomBytes(16).toString('hex');
    run(
      'docker',
      [
        'volume',
        'create',
        '--label',
        'fixture.custody=' + token,
        ...(mode === 'foreign-name-labelled'
          ? ['--label', 'com.docker.compose.project=' + project]
          : []),
        name,
      ],
      { capture: true, timeout: 10000 },
    );
    const inspect = () =>
      JSON.parse(run('docker', ['volume', 'inspect', name], { capture: true, timeout: 10000 }))[0];
    const before = inspect();
    const cleanup = () => {
      const current = inspect();
      if (current.Name !== name || current.Labels?.['fixture.custody'] !== token)
        throw Error('Owned surrogate identity unknown');
      run('docker', ['volume', 'rm', name], { capture: true, timeout: 10000 });
      assertFresh(project);
      assertFresh(other);
    };
    try {
      let refused = false;
      try {
        assertFresh(project);
      } catch {
        refused = true;
      }
      if (!refused) throw Error('Pre-existing namespace was admitted');
      if (JSON.stringify(inspect()) !== JSON.stringify(before)) throw Error('Surrogate changed');
      console.log(
        'RR_NAMESPACE_EVIDENCE ' +
          JSON.stringify({
            mode,
            refused: true,
            setupDispatches: 0,
            primaryTeardownDispatches: 0,
            surrogatePreserved: true,
            casesClosed: 0,
            gatesClosed: 0,
          }),
      );
    } finally {
      cleanup();
    }
    console.log(
      'RR_NAMESPACE_CLEANUP ' +
        JSON.stringify({
          mode,
          ownedControlVolumeRemoved: true,
          emptyProposedNamespaceObserved: true,
          unknown: false,
        }),
    );
  }
}
