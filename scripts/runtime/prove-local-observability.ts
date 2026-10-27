import pg from 'pg';
import { localObserver } from './local-observer.ts';
import { proveObservability } from './local-observer-proof.ts';
import { providerSelection } from './fixture-provider.ts';
try {
  const target = process.env.LOCAL_ENV,
    appEnv = process.env.APP_ENV;
  if (
    !['dev', 'stage'].includes(target ?? '') ||
    appEnv !== target + '-local' ||
    process.env.PROVIDER_MODE !== 'fixtures'
  )
    throw Error();
  const password = (role: string) => {
    const value = process.env['DB_PASSWORD_' + role.toUpperCase()];
    if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw Error();
    return value;
  };
  const url = (role: string) => `postgresql://${role}:${password(role)}@postgres:5432/tt_app`;
  const owner = new pg.Client({
    connectionString: url('tt_app_migrator'),
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
    lock_timeout: 1000,
  });
  try {
    await owner.connect();
    const proof = await proveObservability(owner, (actor) =>
      localObserver(
        url('tt_operations_runtime'),
        actor,
        'http://service-host:8123',
        providerSelection(process.env.LOCAL_PROVIDER_MODE).endpoint,
        appEnv!,
      ),
    );
    const api = await fetch('http://service-host:8123/api/reports', {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    await api.body?.cancel();
    if (api.status !== 404) throw Error('Product APIs must remain held');
    console.log(
      JSON.stringify({
        target,
        proof,
        productApis: false,
        productApiStatus: api.status,
        observerPoolMax: 1,
        additionalOperatorConnections: 1,
      }),
    );
  } finally {
    await owner.end();
  }
} catch {
  console.error(
    'Local observability drill failed; preserve unrelated records and inspect fixture cleanup',
  );
  process.exitCode = 1;
}
