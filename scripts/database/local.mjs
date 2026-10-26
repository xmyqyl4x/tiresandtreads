import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan, validateEnvironmentFile } from '../dev/plan.mjs';
import { addRoleCredentials } from './credentials.mjs';

const [action, target] = process.argv.slice(2);
if (
  !['bootstrap', 'migrate', 'status', 'seed'].includes(action) ||
  !['dev', 'stage'].includes(target)
)
  throw new Error('Usage: pnpm database <bootstrap|migrate|status|seed> <dev|stage>');
const plan = environmentPlan(target);
initialize(plan);
const environment = validateEnvironmentFile(plan, readFileSync(plan.envFile, 'utf8'));
const roles = [
  'tt_app_migrator',
  'tt_app_runtime',
  'tt_staff_runtime',
  'tt_asset_runtime',
  'tt_catalog_runtime',
  'tt_ingest_runtime',
  'tt_publish_runtime',
  'tt_private_runtime',
  'tt_content_runtime',
  'tt_public_runtime',
  'tt_analytics_runtime',
  'tt_limiter_runtime',
  'tt_operations_runtime',
  'tt_report_source_runtime',
  'tt_privacy_runtime',
  'tt_cms_migrator',
  'tt_cms_runtime',
];
const keys = [...roles.map((role) => `DB_PASSWORD_${role.toUpperCase()}`), 'CMS_SECRET'];
const credentialFile = `.local/db-${target}.env`;
mkdirSync('.local', { recursive: true });
if (!existsSync(credentialFile)) {
  if (action !== 'bootstrap') throw new Error('Bootstrap this local database target first');
  writeFileSync(
    credentialFile,
    keys.map((key) => `${key}=${randomBytes(32).toString('hex')}`).join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
}
if (action === 'bootstrap') {
  const existing = readFileSync(credentialFile, 'utf8');
  const expanded = addRoleCredentials(
    existing,
    keys,
    [
      'TT_CATALOG_RUNTIME',
      'TT_INGEST_RUNTIME',
      'TT_PUBLISH_RUNTIME',
      'TT_PRIVATE_RUNTIME',
      'TT_CONTENT_RUNTIME',
      'TT_PUBLIC_RUNTIME',
      'TT_ANALYTICS_RUNTIME',
      'TT_LIMITER_RUNTIME',
      'TT_OPERATIONS_RUNTIME',
      'TT_REPORT_SOURCE_RUNTIME',
      'TT_PRIVACY_RUNTIME',
    ].map((role) => `DB_PASSWORD_${role}`),
    () => randomBytes(32).toString('hex'),
  );
  if (expanded !== existing) writeFileSync(credentialFile, expanded, { mode: 0o600 });
}
const entries = readFileSync(credentialFile, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split('='));
if (
  entries.length !== keys.length ||
  new Set(entries.map(([key]) => key)).size !== keys.length ||
  entries.some(
    ([key, value, extra]) =>
      !keys.includes(key) || !/^[a-f0-9]{64}$/.test(value ?? '') || extra !== undefined,
  )
)
  throw new Error('Invalid local database credential file');
const adminFile = `.local/db-admin-${target}.env`;
if (existsSync(adminFile))
  throw new Error('Unexpected existing bootstrap credential file; inspect it locally');
try {
  if (action === 'bootstrap') {
    writeFileSync(
      adminFile,
      ['app', 'cms']
        .map(
          (kind) =>
            `DB_ADMIN_${kind.toUpperCase()}_URL=postgresql://local_harness:${environment.POSTGRES_PASSWORD}@postgres:5432/tt_${kind}`,
        )
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  compose(plan, ['--profile', 'database', 'build', 'database']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
  compose(plan, [
    'run',
    '--rm',
    '--no-deps',
    'database',
    'pnpm',
    'exec',
    'tsx',
    'scripts/database/cli.ts',
    action,
  ]);
} finally {
  if (action === 'bootstrap' && existsSync(adminFile)) unlinkSync(adminFile);
}
