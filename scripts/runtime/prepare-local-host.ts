import {
  mkdir,
  readFile,
  writeFile,
  rename,
  chown,
  chmod,
  rmdir,
  readdir,
  lstat,
  open,
} from 'node:fs/promises';
import pg from 'pg';
import {
  localHostSettings,
  digest,
  readProviderState,
  verifyProviderState,
} from './local-host-state.ts';
import { prepareFixtureProvider, providerSelection } from './fixture-provider.ts';
import { readServiceHostSettings } from '../../packages/config/src/service-host-settings.ts';
import { pendingMigrations, loadSources } from '../database/manifest.ts';
import { readHistory } from '../database/migrate.ts';

async function main() {
  const target = process.env.LOCAL_ENV,
    check = process.argv[2] === 'check';
  if (
    !['dev', 'stage'].includes(target ?? '') ||
    process.env.APP_ENV !== target + '-local' ||
    process.env.PROVIDER_MODE !== 'fixtures' ||
    (process.argv[2] && !check)
  )
    throw Error();
  // No inherited URL, target path or native database override is accepted by this operator.
  const dir = '/state/current',
    { endpoint, file: providerFile } = providerSelection(process.env.LOCAL_PROVIDER_MODE);
  await mkdir('/state/lock', { mode: 0o700 });
  const client = new pg.Client({
    connectionString: `postgresql://tt_app_migrator:${process.env.DB_PASSWORD_TT_APP_MIGRATOR}@postgres:5432/tt_app`,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    lock_timeout: 1000,
  });
  try {
    await client.connect();
    if (pendingMigrations(loadSources('app'), await readHistory(client)).length) throw Error();
    const files = await readdir('/state');
    let settings;
    if (files.includes('current')) {
      if (files.some((f) => !['current', 'lock', 'provider-v2'].includes(f)))
        throw Error('Incomplete setup');
      const info = await lstat(dir + '/settings.json');
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536 || info.mode & 0o077)
        throw Error();
      settings = readServiceHostSettings(
        JSON.parse(await readFile(dir + '/settings.json', 'utf8')),
      );
      const expected = localHostSettings(target!, process.env);
      if (
        JSON.stringify(settings.plan) !== JSON.stringify(expected.plan) ||
        settings.policy.version !== expected.policy.version ||
        JSON.stringify(settings.maintenance) !== JSON.stringify(expected.maintenance)
      )
        throw Error('Retained configuration differs; do not rotate');
      await verifyProviderState(await readProviderState(providerFile, target!), endpoint);
    } else {
      if (check || files.some((f) => f !== 'lock'))
        throw Error('Prepare or inspect incomplete setup');
      settings = localHostSettings(target!, process.env);
      if (process.env.LOCAL_PROVIDER_MODE)
        throw Error('Initialize legacy settings before explicit provider upgrade');
      const state = await prepareFixtureProvider(target as 'dev' | 'stage', endpoint);
      await mkdir('/state/pending', { mode: 0o700 });
      for (const [name, data] of [
        ['settings', settings],
        ['provider', state],
      ] as const) {
        const path = `/state/pending/${name}.json`;
        await writeFile(path, JSON.stringify(data) + '\n', { flag: 'wx', mode: 0o600 });
        await chown(path, 1000, 1000);
        const handle = await open(path, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await chown('/state/pending', 1000, 1000);
      const staged = await open('/state/pending', 'r');
      try {
        await staged.sync();
      } finally {
        await staged.close();
      }
      await rename('/state/pending', dir);
      const stateDirectory = await open('/state', 'r');
      try {
        await stateDirectory.sync();
      } finally {
        await stateDirectory.close();
      }
    }
    if (!check) {
      // Narrow, explicit synthetic fixture preparation; no existing notice/template is updated.
      await client.query('BEGIN');
      try {
        for (const [purpose, id] of Object.entries(settings.policy.notices)) {
          const hash = digest(`Synthetic ${settings.policy.version} ${purpose}`);
          await client.query(
            "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,$3,'local-fixture-v1',$4,now(),'synthetic-local-host') ON CONFLICT DO NOTHING",
            [id, purpose, settings.policy.version, hash],
          );
          const r = await client.query(
            "SELECT 1 FROM privacy.notices WHERE id=$1 AND purpose=$2 AND market_policy=$3 AND version='local-fixture-v1' AND content_hash=$4 AND content_ref='synthetic-local-host' AND published_at<=now()",
            [id, purpose, settings.policy.version, hash],
          );
          if (r.rowCount !== 1) throw Error('Conflicting synthetic policy');
        }
        await client.query(
          "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,$2,'local-fixture-v1','en-US','report',$3,'published',now()) ON CONFLICT DO NOTHING",
          [settings.policy.templateId, settings.policy.version, settings.policy.rendererHash],
        );
        const r = await client.query(
          "SELECT 1 FROM email.template_versions WHERE id=$1 AND template_key=$2 AND renderer_hash=$3 AND status='published' AND purpose='report' AND locale='en-US' AND version='local-fixture-v1'",
          [settings.policy.templateId, settings.policy.version, settings.policy.rendererHash],
        );
        if (r.rowCount !== 1) throw Error('Conflicting synthetic template');
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      await mkdir('/journal', { recursive: true, mode: 0o700 });
      await chmod('/journal', 0o700);
      await chown('/journal', 1000, 1000);
    }
    console.log(
      JSON.stringify({
        target,
        prepared: !check,
        providerVerified: true,
        rotation: false,
        maintenanceEnabled: settings.maintenance.enabled,
        productApis: false,
      }),
    );
  } finally {
    await client.end();
    await rmdir('/state/lock');
  }
}
main().catch(() => {
  console.error(
    'Local host preparation refused; retain private state and inspect migrations, fixture custody or interrupted setup. No reset performed.',
  );
  process.exitCode = 1;
});
