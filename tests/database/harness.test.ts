import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';

const clients: pg.Client[] = [];

beforeAll(async () => {
  if (
    process.env.APP_ENV !== 'test-local' ||
    !/^tt-test-[a-f0-9]{8,32}$/.test(process.env.ISOLATED_TEST_PROJECT ?? '')
  ) {
    throw new Error('Database tests require the disposable local test runner');
  }
  for (const [variable, database] of [
    ['TEST_DATABASE_URL', 'tt_app'],
    ['TEST_CMS_DATABASE_URL', 'tt_cms'],
  ] as const) {
    const connectionString = process.env[variable];
    if (!connectionString) throw new Error('Missing isolated database configuration');
    const url = new URL(connectionString);
    if (
      url.hostname !== 'postgres' ||
      url.pathname !== `/${database}` ||
      url.username !== 'local_harness'
    )
      throw new Error('Refusing a non-harness database target');
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    clients.push(client);
    await client.connect();
  }
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()));
});

it('ENG-02 uses real PostgreSQL 18 and distinct app/CMS databases', async () => {
  const databases = await Promise.all(
    clients.map(
      async (client) =>
        (
          await client.query(
            "select current_database() as db, current_setting('server_version_num')::int as version, current_setting('TimeZone') as timezone",
          )
        ).rows[0] as { db: string; version: number; timezone: string },
    ),
  );
  expect(databases.map((row) => row.db)).toEqual(['tt_app', 'tt_cms']);
  for (const row of databases) {
    expect(row.version).toBeGreaterThanOrEqual(180000);
    expect(row.version).toBeLessThan(190000);
    expect(row.timezone).toBe('UTC');
  }
});

it('ENG-02 observes a real constraint failure and transaction rollback', async () => {
  const client = clients[0];
  if (!client) throw new Error('Harness not initialized');
  await client.query('begin');
  try {
    await client.query('create temporary table bootstrap_probe (id integer primary key)');
    await client.query('insert into bootstrap_probe values (1)');
    await expect(client.query('insert into bootstrap_probe values (1)')).rejects.toMatchObject({
      code: '23505',
    });
  } finally {
    await client.query('rollback');
  }
  expect(
    (await client.query("select to_regclass('pg_temp.bootstrap_probe') as relation")).rows[0],
  ).toEqual({ relation: null });
});
