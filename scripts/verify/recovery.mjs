import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan } from '../dev/plan.mjs';

export function verifyRecovery({ custody = false } = {}) {
  const plan = environmentPlan('test', randomBytes(8).toString('hex'));
  initialize(plan);
  const started = Date.now();
  const call = (args, options) =>
    compose(
      plan,
      [
        '-f',
        'infra/local/compose.recovery.yaml',
        ...(custody ? ['-f', 'infra/local/compose.custody.yaml'] : []),
        ...args,
      ],
      {
        timeout: 600_000,
        ...options,
      },
    );
  const fixture = (file) =>
    call([
      'run',
      '--rm',
      '--no-deps',
      'test',
      'pnpm',
      'exec',
      'tsx',
      `tests/fixtures/recovery/${file}.ts`,
    ]);
  try {
    call(['--profile', 'verify', 'build', 'test']);
    call(['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'recovery-postgres']);
    fixture('prepare');
    if (custody) fixture('custody-seed');
    const versions = call(['exec', '-T', 'postgres', 'pg_dump', '--version'], { capture: true });
    if (!versions.includes('18.6'))
      throw new Error('Recovery requires pinned PostgreSQL 18.6 tools');
    for (const kind of ['app', 'cms'])
      call([
        'exec',
        '-T',
        'postgres',
        'pg_dump',
        '-U',
        'local_harness',
        `--role=tt_${kind}_migrator`,
        '--format=custom',
        '--no-tablespaces',
        `--file=/recovery/${kind}.dump`,
        `tt_${kind}_recovery`,
      ]);
    fixture('seal');
    if (custody) {
      fixture('custody-seal');
      fixture('custody-admit');
    }
    const restore = (file, kind, database, options) =>
      call(
        [
          'exec',
          '-T',
          'recovery-postgres',
          'pg_restore',
          '-U',
          'local_harness',
          `--role=tt_${kind}_migrator`,
          '--no-owner',
          '--no-tablespaces',
          '--exit-on-error',
          '--single-transaction',
          `--dbname=${database}`,
          `/recovery/${file}.dump`,
        ],
        options,
      );
    // The negative run intentionally bypasses checksum admission to test PostgreSQL's rollback.
    let failed = false;
    try {
      if (!custody) restore('corrupt', 'app', 'tt_app_recovery_bad', { capture: true });
    } catch {
      failed = true;
    }
    if (!custody && !failed) throw new Error('Corrupt archive unexpectedly restored');
    for (const kind of ['app', 'cms']) restore(kind, kind, `tt_${kind}_recovery`);
    call(['run', '--rm', '--no-deps', 'test', 'pnpm', custody ? 'test:custody' : 'test:recovery']);
    mkdirSync('.local/recovery-evidence', { recursive: true });
    const file = `.local/recovery-evidence/${plan.project}.json`;
    call(['cp', 'recovery-postgres:/recovery/result.json', file]);
    const result = JSON.parse(readFileSync(file, 'utf8'));
    const evidence = {
      project: plan.project,
      elapsedMs: Date.now() - started,
      tools: versions,
      ...result,
    };
    console.log(
      (custody ? 'Local custody drill evidence: ' : 'Recovery drill evidence: ') +
        JSON.stringify(evidence),
    );
    return evidence;
  } finally {
    call(['down', '--volumes', '--remove-orphans']);
    unlinkSync(plan.envFile);
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify/recovery.mjs'))
  verifyRecovery();
