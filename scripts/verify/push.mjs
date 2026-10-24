import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { run } from '../lib/process.mjs';
import { verifyLocal } from './local.mjs';

if (run('git', ['status', '--porcelain'], { capture: true }))
  throw new Error('Commit all changes before exact-commit verification');
const sha = run('git', ['rev-parse', 'HEAD'], { capture: true });
const tree = run('git', ['rev-parse', 'HEAD^{tree}'], { capture: true });
process.env.SOURCE_REVISION = sha;
const evidence = verifyLocal();
if (
  run('git', ['status', '--porcelain'], { capture: true }) ||
  run('git', ['rev-parse', 'HEAD'], { capture: true }) !== sha
)
  throw new Error('Source changed during verification');
mkdirSync('.local', { recursive: true });
writeFileSync(
  '.local/verified-commit.json',
  JSON.stringify(
    {
      sha,
      tree,
      lockfileSha256: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
      verifiedAt: new Date().toISOString(),
      ...evidence,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Exact commit ${sha} passed local Linux verification; ready to push`);
