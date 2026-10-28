import { run } from '../lib/process.mjs';

// Read-only inspection of one generated project; never enumerate or remove retained resources.
export function assertDisposableRemoved(plan) {
  if (plan.target !== 'test' || !/^tt-test-[a-f0-9]{16}$/.test(plan.project))
    throw Error('Cleanup inspection requires its generated test project');
  for (const args of [
    ['ps', '--all', '--quiet'],
    ['volume', 'ls', '--quiet'],
    ['network', 'ls', '--quiet'],
  ])
    if (
      run('docker', [...args, '--filter', `label=com.docker.compose.project=${plan.project}`], {
        capture: true,
      })
    )
      throw Error('Disposable project cleanup incomplete');
}
