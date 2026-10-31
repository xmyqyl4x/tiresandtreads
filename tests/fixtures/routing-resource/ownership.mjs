import { run } from '../../../scripts/lib/process.mjs';

// Fixed generated namespace only; any unavailable inspection also refuses.
export function assertFresh(project) {
  if (!/^tt-test-[a-f0-9]{16}$/.test(project)) throw Error('Generated namespace required');
  for (const [args, filters] of [
    [
      ['ps', '--all', '--quiet'],
      ['label=com.docker.compose.project=' + project, 'name=' + project],
    ],
    [
      ['volume', 'ls', '--quiet'],
      ['label=com.docker.compose.project=' + project, 'name=' + project],
    ],
    [
      ['network', 'ls', '--quiet'],
      ['label=com.docker.compose.project=' + project, 'name=' + project],
    ],
  ])
    for (const filter of filters) {
      const raw = run('docker', [...args, '--filter', filter], { capture: true, timeout: 10000 });
      if (raw.length > 65536 || raw) throw Error('Generated namespace is occupied or unavailable');
    }
}
