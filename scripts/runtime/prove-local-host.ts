import pg from 'pg';
import { proveWorkflow } from './local-workflow-proof.ts';
import { readProviderState, verifyProviderState } from './local-host-state.ts';
try {
  const target = process.env.LOCAL_ENV;
  if (!['dev', 'stage'].includes(target ?? '') || process.env.APP_ENV !== target + '-local')
    throw Error();
  await verifyProviderState(
    await readProviderState('/state/current/provider.json', target!),
    'http://moto:5000',
  );
  const client = new pg.Client({
    connectionString: `postgresql://tt_app_migrator:${process.env.DB_PASSWORD_TT_APP_MIGRATOR}@postgres:5432/tt_app`,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
    lock_timeout: 1000,
  });
  try {
    await client.connect();
    console.log(
      JSON.stringify({
        target,
        workflow: await proveWorkflow(client, 'http://service-host:8123'),
        providerVersionsVerified: 4,
      }),
    );
  } finally {
    await client.end();
  }
} catch {
  console.error('Local composed workflow proof failed; no acceptance claimed');
  process.exitCode = 1;
}
