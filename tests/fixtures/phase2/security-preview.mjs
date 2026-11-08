import { randomBytes } from 'node:crypto';
import { unlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';
if (process.argv.length !== 2) throw Error('Disposable owner preview accepts no arguments');
const mode = 'dev',
  scenario = 'synthetic';
const port = mode === 'dev' ? 8380 : 8480,
  plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
const record = '.local/p2-security-preview.json';
let owned = false;
const localCompose = (args) =>
  compose(plan, ['-f', 'infra/local/compose.web-preview.yaml', ...args], {
    env: { LOCAL_WEB_PORT: String(port), LOCAL_PREVIEW_MODE: mode },
  });
function removeRecord() {
  if (JSON.parse(readFileSync(record, 'utf8')).project !== plan.project)
    throw Error('Preview ownership changed');
  rmSync(record);
}
try {
  writeFileSync(
    record,
    JSON.stringify(
      {
        project: plan.project,
        envFile: plan.envFile,
        origin: 'http://127.0.0.1:' + port,
        disposable: true,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  owned = true;
  localCompose(['--profile', 'verify', '--profile', 'web-preview', 'build', 'test']);
  localCompose([
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
  console.log('Starting disposable ' + mode + ' web preview at http://127.0.0.1:' + port);
  localCompose([
    'run',
    '--rm',
    '--no-deps',
    '--use-aliases',
    '--env',
    'LOCAL_PREVIEW_MODE=' + mode,
    '--env',
    'LOCAL_UI_SCENARIO=' + scenario,
    'test',
    'node',
    '--import',
    'tsx',
    'tests/fixtures/phase2/serve-security.ts',
  ]);
} finally {
  try {
    if (owned) {
      localCompose([
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
    if (owned) removeRecord();
  }
}
