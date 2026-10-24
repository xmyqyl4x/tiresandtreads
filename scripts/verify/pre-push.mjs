import { readFileSync } from 'node:fs';
import { run } from '../lib/process.mjs';

const stamp = JSON.parse(readFileSync('.local/verified-commit.json', 'utf8'));
const sha = run('git', ['rev-parse', 'HEAD'], { capture: true });
if (stamp.sha !== sha || run('git', ['status', '--porcelain'], { capture: true }))
  throw new Error('Run pnpm verify:push against the clean committed source before pushing');
for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
  const [, pushedSha] = line.split(/\s+/);
  if (pushedSha !== '0'.repeat(40) && pushedSha !== stamp.sha)
    throw new Error('Every pushed ref must match the locally verified commit');
}
console.log(`Local verification stamp matches ${sha}; CI will verify independently`);
