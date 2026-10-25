import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { disposableTargets } from '../fixtures/foundation/target.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type RolePasswords,
} from '../../scripts/database/bootstrap.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { loadSources } from '../../scripts/database/manifest.ts';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { moneyFromRow, reportHeadFromRow } from '../../packages/db/src/mappers.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import {
  failure,
  type TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';
let pool: pg.Pool, observer: pg.Client;
let adapter: ReturnType<typeof createTransactions>;
let ownedFixture = false;
beforeAll(async () => {
  const harness = disposableTargets(process.env),
    root = new URL(harness.app);
  const admin = new pg.Client({ connectionString: root.toString() });
  await admin.connect();
  try {
    // Roles are cluster-wide. Refuse pre-existing roles instead of borrowing or rotating them.
    const existing = await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)', [
      databaseRoles.app,
    ]);
    if (existing.rowCount) throw new Error('Transaction fixture requires absent application roles');
    await admin.query('CREATE DATABASE tt_app_transactions');
    ownedFixture = true;
  } finally {
    await admin.end();
  }
  root.pathname = '/tt_app_transactions';
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((role) => [role, randomBytes(32).toString('hex')]),
  ) as RolePasswords;
  await bootstrapDatabase(root.toString(), 'app', 'tt_app_transactions', passwords);
  root.username = 'tt_app_migrator';
  root.password = passwords.tt_app_migrator;
  await migrateApplication(
    { url: root.toString(), database: 'tt_app_transactions', kind: 'app' },
    loadSources('app'),
  );
  const owner = new pg.Client({ connectionString: root.toString() });
  await owner.connect();
  try {
    await owner.query(
      'CREATE SCHEMA tx_fixture; CREATE TABLE tx_fixture.parents(id int PRIMARY KEY); CREATE TABLE tx_fixture.children(id int PRIMARY KEY,parent_id int REFERENCES tx_fixture.parents(id) DEFERRABLE INITIALLY DEFERRED); GRANT USAGE ON SCHEMA tx_fixture TO tt_app_runtime; GRANT SELECT,INSERT ON tx_fixture.parents,tx_fixture.children TO tt_app_runtime',
    );
  } finally {
    await owner.end();
  }
  root.username = 'tt_app_runtime';
  root.password = passwords.tt_app_runtime;
  pool = new pg.Pool({
    connectionString: root.toString(),
    max: 2,
    connectionTimeoutMillis: 500,
    query_timeout: 3000,
  });
  observer = new pg.Client({ connectionString: root.toString() });
  await observer.connect();
  adapter = createTransactions(pool);
}, 30000);
afterAll(async () => {
  await pool?.end();
  await observer?.end();
  if (!ownedFixture) return;
  const admin = new pg.Client({ connectionString: disposableTargets(process.env).app });
  await admin.connect();
  try {
    await admin.query('DROP DATABASE tt_app_transactions');
    for (const role of databaseRoles.app)
      await admin.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
  } finally {
    await admin.end();
  }
});
async function exists(id: string) {
  return (await observer.query('SELECT id FROM app.subjects WHERE id=$1', [id])).rowCount;
}
async function subject(tx: TransactionContext, id: string) {
  await adapter.query(tx, "INSERT INTO app.subjects(id,kind) VALUES($1,'guest')", [id]);
  return (await adapter.query(tx, 'SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
}
async function session(tx: TransactionContext, owner: string) {
  await adapter.query(
    tx,
    "INSERT INTO app.owner_sessions(subject_id,token_hash,key_version,expires_at) VALUES($1,$2,'fixture',now()+interval '1 hour')",
    [owner, randomBytes(32)],
  );
  return (await adapter.query(tx, 'SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
}
it('commits two scoped writers on one restricted connection with atomic outside visibility', async () => {
  const id = randomUUID();
  expect(
    await adapter.unitOfWork.run(async (tx) => {
      const pid = await subject(tx, id);
      expect(await session(tx, id)).toBe(pid);
      expect(await exists(id)).toBe(0);
      expect((await adapter.query(tx, 'SELECT current_user AS role')).rows[0]?.role).toBe(
        'tt_app_runtime',
      );
      return ok(id);
    }),
  ).toEqual(ok(id));
  expect(await exists(id)).toBe(1);
  const client = await pool.connect();
  try {
    expect(
      (await client.query("SELECT current_setting('statement_timeout') AS timeout")).rows[0]
        .timeout,
    ).toBe('15s');
  } finally {
    client.release();
  }
});
it('rolls back all writers on a typed failure', async () => {
  const id = randomUUID();
  expect(
    await adapter.unitOfWork.run(async (tx) => {
      await subject(tx, id);
      await session(tx, id);
      return fail(failure('conflict'));
    }),
  ).toEqual(fail(failure('conflict')));
  expect(await exists(id)).toBe(0);
  expect(
    (await observer.query('SELECT id FROM app.owner_sessions WHERE subject_id=$1', [id])).rowCount,
  ).toBe(0);
});
it('refuses success after a caught PostgreSQL error and reuses a clean connection', async () => {
  const id = randomUUID();
  expect(
    await adapter.unitOfWork.run(async (tx) => {
      await subject(tx, id);
      await subject(tx, id).catch(() => {});
      return ok(id);
    }),
  ).toEqual(fail(failure('conflict')));
  expect(await exists(id)).toBe(0);
  expect(
    (
      await adapter.unitOfWork.run(async (tx) =>
        ok((await adapter.query(tx, 'SELECT 1 AS n')).rows[0]?.n),
      )
    ).ok,
  ).toBe(true);
});
it('reports a real deferred commit rejection as integrity failure', async () => {
  expect(
    await adapter.unitOfWork.run(async (tx) => {
      await adapter.query(tx, 'INSERT INTO tx_fixture.children VALUES(1,999)');
      return ok(1);
    }),
  ).toEqual(fail(failure('integrity')));
  expect((await observer.query('SELECT * FROM tx_fixture.children')).rowCount).toBe(0);
});
it('bounds a PostgreSQL statement and recovers the pool', async () => {
  const short = createTransactions(pool, { statementMs: 40, transactionMs: 2000 });
  expect(
    await short.unitOfWork.run(async (tx) => {
      await short.query(tx, 'SELECT pg_sleep(1)');
      return ok(1);
    }),
  ).toEqual(fail(failure('timeout', true)));
  expect(
    (
      await adapter.unitOfWork.run(async (tx) =>
        ok((await adapter.query(tx, 'SELECT 2 AS n')).rows[0]?.n),
      )
    ).ok,
  ).toBe(true);
});
it('abandons a stalled callback without committing its earlier write', async () => {
  const short = createTransactions(pool, { transactionMs: 300 });
  const id = randomUUID();
  let finish!: () => void;
  let saved!: TransactionContext;
  const result = await short.unitOfWork.run(async (tx) => {
    saved = tx;
    await short.query(tx, "INSERT INTO app.subjects(id,kind) VALUES($1,'guest')", [id]);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return ok(id);
  });
  expect(result).toEqual(fail(failure('timeout')));
  expect(await exists(id)).toBe(0);
  await expect(short.query(saved, 'SELECT 1')).rejects.toMatchObject({
    failure: { code: 'transaction_context' },
  });
  finish();
});
it('preserves one winner for concurrent expected-revision updates without implicit retries', async () => {
  const id = randomUUID();
  await adapter.unitOfWork.run(async (tx) => {
    await subject(tx, id);
    return ok(id);
  });
  const write = () =>
    adapter.unitOfWork.run(async (tx) => {
      const updated = await adapter.query(
        tx,
        'UPDATE app.subjects SET permission_revision=permission_revision+1 WHERE id=$1 AND permission_revision=1 RETURNING id',
        [id],
      );
      return updated.rowCount === 1 ? ok(id) : fail(failure('conflict'));
    });
  const results = await Promise.all([write(), write()]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    (await observer.query('SELECT permission_revision FROM app.subjects WHERE id=$1', [id])).rows[0]
      .permission_revision,
  ).toBe('2');
});
it('keeps SQL parameters literal and runtime DDL forbidden', async () => {
  const text = "private'); DROP TABLE app.subjects; --";
  expect(
    await adapter.unitOfWork.run(async (tx) =>
      ok((await adapter.query(tx, 'SELECT $1::text AS value', [text])).rows[0]?.value),
    ),
  ).toEqual(ok(text));
  expect(
    (
      await adapter.unitOfWork.run(async (tx) => {
        await adapter.query(tx, 'CREATE TABLE public.forbidden(id int)');
        return ok(1);
      })
    ).ok,
  ).toBe(false);
});
it('maps actual pg bigint and date results through the explicit storage boundary', async () => {
  const result = await adapter.unitOfWork.run(async (tx) => {
    const row = (
      await adapter.query(
        tx,
        "SELECT '9007199254740993'::bigint AS unit_price_minor,'USD'::text AS currency, '11111111-1111-4111-8111-111111111111'::uuid AS id, '22222222-2222-4222-8222-222222222222'::uuid AS owner_subject_id, 1::bigint AS revision, '2026-10-23T10:00:00Z'::timestamptz AS expires_at, 'draft'::text AS status,NULL::int AS current_version",
      )
    ).rows[0]!;
    expect(moneyFromRow(row, ['USD'])).toEqual(ok({ minor: 9007199254740993n, currency: 'USD' }));
    expect(reportHeadFromRow(row)).toMatchObject({
      ok: true,
      value: { status: 'draft', currentVersion: null },
    });
    return ok(1);
  });
  expect(result.ok).toBe(true);
});
it('bounds real pool saturation without running the abandoned callback and recovers capacity', async () => {
  const held = await Promise.all([pool.connect(), pool.connect()]);
  let ran = false;
  try {
    const short = createTransactions(pool, { admissionMs: 50 });
    expect(
      await short.unitOfWork.run(async () => {
        ran = true;
        return ok(1);
      }),
    ).toEqual(fail(failure('timeout')));
    expect(ran).toBe(false);
  } finally {
    held.forEach((c) => c.release());
  }
  expect(
    (
      await adapter.unitOfWork.run(async (tx) =>
        ok((await adapter.query(tx, 'SELECT 1 AS n')).rows[0]!.n),
      )
    ).ok,
  ).toBe(true);
  expect(pool.totalCount).toBeLessThanOrEqual(2);
  expect(pool.waitingCount).toBe(0);
});
