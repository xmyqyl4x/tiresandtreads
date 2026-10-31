import { createHmac, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';
import { snapshot } from './snapshot.ts';
import { must } from './contract.ts';

must(
  process.env.APP_ENV === 'test-local' &&
    process.env.PROVIDER_MODE === 'fixtures' &&
    /^tt-test-[a-f0-9]{16}$/.test(process.env.ISOLATED_TEST_PROJECT ?? '') &&
    /^[a-f0-9]{32}$/.test(process.env.FIXTURE_GENERATION ?? '') &&
    /^[a-f0-9]{64}$/.test(process.env.POSTGRES_PASSWORD ?? ''),
);
const root = process.env.POSTGRES_PASSWORD!;
const owners = [];
for (const [slot, host] of ['postgres', 'recovery-postgres'].entries()) {
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((role) => [
        role,
        createHmac('sha256', root)
          .update(host + ':' + role)
          .digest('hex'),
      ]),
  ) as RolePasswords;
  for (const kind of ['app', 'cms'] as const) {
    const database = `tt_${kind}_recovery`,
      owner = `tt_${kind}_migrator` as const;
    const admin = new pg.Client({
      host,
      port: 5432,
      user: 'local_harness',
      password: root,
      database: 'postgres',
      ssl: false,
      connectionTimeoutMillis: 1500,
      statement_timeout: 1000,
    });
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${identifier(database)}`);
    } finally {
      await admin.end();
    }
    const url = new URL(`postgresql://local_harness@${host}:5432/${database}`);
    url.password = root;
    await bootstrapDatabase(url.toString(), kind, database, passwords);
    const db = new pg.Client({
      host,
      port: 5432,
      user: owner,
      password: passwords[owner],
      database,
      ssl: false,
      connectionTimeoutMillis: 1500,
      statement_timeout: 1000,
    });
    try {
      await db.connect();
      for (const role of databaseRoles[kind].slice(1))
        await db.query(
          `REVOKE CONNECT ON DATABASE ${identifier(database)} FROM ${identifier(role)}`,
        );
    } finally {
      await db.end();
    }
  }
  // Both role sets must exist before recording the declared foundation baseline.
  for (const kind of ['app', 'cms'] as const) {
    const user = `tt_${kind}_migrator` as const;
    const db = new pg.Client({
      host,
      port: 5432,
      user,
      password: passwords[user],
      database: `tt_${kind}_recovery`,
      ssl: false,
      connectionTimeoutMillis: 1500,
      statement_timeout: 1000,
    });
    try {
      await db.connect();
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const baseline = await snapshot(db, user);
      await db.query('ROLLBACK');
      owners.push({ slot, kind, password: passwords[user], baseline });
    } finally {
      await db.end();
    }
  }
}
const caSha256 = createHash('sha256').update(readFileSync('/trust/ca.crt')).digest('hex');
writeFileSync(
  '/owners/context.json',
  JSON.stringify({
    version: 1,
    scope: 'private-tls-admission',
    project: process.env.ISOLATED_TEST_PROJECT,
    fixtureGeneration: process.env.FIXTURE_GENERATION,
    caSha256,
    owners,
  }),
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'Owned foundation setup complete; both domains runtime-quarantined, admin sessions closed',
);
