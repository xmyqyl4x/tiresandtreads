import { z } from 'zod';
import { databaseRoles } from './database-roles.ts';

const schema = z
  .object({
    mode: z.literal('local-preflight'),
    target: z.enum(['app', 'cms']),
    url: z.string().min(1).max(4096),
    peerDatabase: z.string().max(63),
    ca: z.string().min(1).max(65536),
    expectedVersion: z.number().int().min(180000).max(189999),
    expectedMigrations: z.number().int().min(1).max(1000),
    expectedHistory: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d{4}_[a-z0-9_]{1,100}$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

// This is a disposable local probe, not permission to connect a runtime to a cloud host.
export function readLocalDatabasePreflight(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
) {
  try {
    if (
      env.APP_ENV !== 'test-local' ||
      env.PROVIDER_MODE !== 'fixtures' ||
      !/^tt-test-[a-f0-9]{8,32}$/.test(env.ISOLATED_TEST_PROJECT ?? '')
    )
      throw Error();
    const s = schema.parse(input),
      u = new URL(s.url);
    if (
      s.expectedHistory.length !== s.expectedMigrations ||
      s.expectedHistory.some((r, i) => i > 0 && r.id <= s.expectedHistory[i - 1]!.id)
    )
      throw Error();
    const user = decodeURIComponent(u.username),
      password = decodeURIComponent(u.password),
      database = u.pathname.slice(1);
    if (
      u.protocol !== 'postgresql:' ||
      !['postgres.preflight.test', 'postgres.mismatch.preflight.test'].includes(u.hostname) ||
      u.port !== '5432' ||
      u.search ||
      u.hash ||
      user !== databaseRoles[s.target][0] ||
      !/^[a-f0-9]{64}$/.test(password) ||
      !new RegExp(`^tt_${s.target}_[a-z0-9_]{1,40}$`).test(database) ||
      !new RegExp(`^tt_${s.target === 'app' ? 'cms' : 'app'}_[a-z0-9_]{1,40}$`).test(s.peerDatabase)
    )
      throw Error();
    return Object.freeze({
      target: s.target,
      database,
      peerDatabase: s.peerDatabase,
      expectedVersion: s.expectedVersion,
      expectedMigrations: s.expectedMigrations,
      expectedHistory: s.expectedHistory,
      connection: Object.freeze({
        host: u.hostname,
        port: 5432,
        user,
        password,
        database,
        ssl: Object.freeze({ ca: s.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' as const }),
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
        statement_timeout: 1000,
        lock_timeout: 250,
        idle_in_transaction_session_timeout: 1000,
        application_name: 'tt-db-preflight:' + s.target,
        options: '-c search_path=pg_catalog -c default_transaction_read_only=on',
      }),
    });
  } catch {
    throw Error('Invalid local database preflight');
  }
}
