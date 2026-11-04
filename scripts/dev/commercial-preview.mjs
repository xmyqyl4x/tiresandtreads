import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { initialize, compose } from './local.mjs';
import { environmentPlan } from './plan.mjs';
import { assertDisposableRemoved } from '../verify/disposable-cleanup.mjs';
if (process.argv.length !== 2)
  throw Error('Commercial preview accepts no provider or authority arguments');
const plan = environmentPlan('test', randomBytes(8).toString('hex')),
  record = '.local/commercial-preview.json';
initialize(plan);
let owned = false;
const local = (args) =>
  compose(plan, ['-f', 'infra/local/compose.web-preview.yaml', ...args], {
    env: { LOCAL_WEB_PORT: '8380', LOCAL_PREVIEW_MODE: 'dev' },
  });
function removeOwnedRecord() {
  if (JSON.parse(readFileSync(record, 'utf8')).project !== plan.project)
    throw Error('Preview ownership changed');
  unlinkSync(record);
}
try {
  writeFileSync(
    record,
    JSON.stringify({
      project: plan.project,
      envFile: plan.envFile,
      origin: 'http://127.0.0.1:8380',
      disposable: true,
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  owned = true;
  local(['--profile', 'verify', '--profile', 'web-preview', 'build', 'test']);
  local([
    '--profile',
    'verify',
    '--profile',
    'web-preview',
    'up',
    '--detach',
    '--wait',
    '--wait-timeout',
    '120',
    'postgres',
    'moto',
    'inngest',
    'preview-proxy',
  ]);
  local([
    'run',
    '--rm',
    '--no-deps',
    '--use-aliases',
    '--name',
    plan.project + '-commercial-ui',
    'test',
    'node',
    '--import',
    'tsx',
    'tests/fixtures/http/commercial-serve.ts',
  ]);
} finally {
  try {
    if (owned) {
      local([
        '--profile',
        'verify',
        '--profile',
        'web-preview',
        'down',
        '--volumes',
        '--remove-orphans',
      ]);
      assertDisposableRemoved(plan);
    }
  } finally {
    unlinkSync(plan.envFile);
    if (owned) {
      removeOwnedRecord();
    }
  }
}
