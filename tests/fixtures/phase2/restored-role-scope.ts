import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createTransactions, type PgPool } from '../../../packages/db/src/transactions.ts';
import { disposableTargets } from '../foundation/target.ts';
const roles = [
  'tt_private_runtime',
  'tt_privacy_runtime',
  'tt_asset_runtime',
  'tt_p2_analysis_service',
  'tt_p2_partner_service',
  'tt_p2_coupon_worker',
  'tt_p2_pilot_service',
  'tt_p2_insights_service',
  'tt_p2_csv_staff',
  'tt_ingest_runtime',
  'tt_publish_runtime',
] as const;
export type RestoredProofRole = (typeof roles)[number];
// Bounded disposable proof identity. Original runtime CONNECT remains revoked; no production authority is selected.
export async function withRestoredRoleScopes<T>(
  root: pg.Client,
  run: (scope: (role: RestoredProofRole) => ReturnType<typeof createTransactions>) => Promise<T>,
) {
  const database = (await root.query('SELECT current_database() AS name')).rows[0]?.name;
  if (database !== 'tt_app_p2_security_restore')
    throw Error('Fixed quarantined replay scope required');
  if (
    (await root.query("SELECT 1 FROM pg_roles WHERE rolname='local_p2_complete_restore'")).rowCount
  )
    throw Error('Owned replay identity must be absent');
  const password = randomBytes(32).toString('hex'),
    url = new URL(disposableTargets(process.env).app);
  url.pathname = '/tt_app_p2_security_restore';
  url.username = 'local_p2_complete_restore';
  url.password = password;
  let created = false,
    pool: pg.Pool | undefined;
  try {
    await root.query('SET default_transaction_read_only=off');
    await root.query(
      "CREATE ROLE local_p2_complete_restore LOGIN PASSWORD '" +
        password +
        "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS",
    );
    created = true;
    await root.query(
      'GRANT ' + roles.join(',') + ' TO local_p2_complete_restore WITH INHERIT FALSE',
    );
    await root.query(
      'GRANT CONNECT ON DATABASE tt_app_p2_security_restore TO local_p2_complete_restore',
    );
    pool = new pg.Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 3000 });
    const shared = pool;
    return await run((role) => {
      if (!roles.includes(role)) throw Error('Fixed local role required');
      const adapter: PgPool = {
        async connect() {
          const client = await shared.connect();
          return {
            async query(sql, values) {
              try {
                const result = await client.query(sql, values);
                if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED')
                  await client.query('SET LOCAL ROLE ' + role);
                return result;
              } catch (error) {
                const code =
                  error &&
                  typeof error === 'object' &&
                  'code' in error &&
                  typeof error.code === 'string'
                    ? error.code
                    : 'unknown';
                const constraint =
                  error &&
                  typeof error === 'object' &&
                  'constraint' in error &&
                  typeof error.constraint === 'string'
                    ? error.constraint
                    : null;
                // Fixed synthetic test SQL only; no values, identities, keys, ciphertext or raw error messages.
                console.log('P2_RESTORE_SQL_REFUSAL ' + JSON.stringify({ role, code, constraint }));
                throw error;
              }
            },
            on: (event, listener) => client.on(event, listener),
            removeListener: (event, listener) => client.removeListener(event, listener),
            release: (destroy) => client.release(destroy),
          };
        },
      };
      return createTransactions(adapter, { transactionMs: 15000, statementMs: 8000, lockMs: 3000 });
    });
  } finally {
    try {
      await pool?.end();
    } finally {
      if (created) {
        await root.query(
          'REVOKE CONNECT ON DATABASE tt_app_p2_security_restore FROM local_p2_complete_restore',
        );
        await root.query('DROP ROLE local_p2_complete_restore');
      }
      await root.query('SET default_transaction_read_only=on');
    }
  }
}
