import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { disposableTargets } from '../foundation/target.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  type DatabaseRole,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';

export async function schemaFixture() {
  const harness = disposableTargets(process.env);
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((role) => [role, randomBytes(32).toString('hex')]),
  ) as RolePasswords;
  const urls = {} as Record<DatabaseRole, string>;
  for (const kind of ['app', 'cms'] as const) {
    const database = `tt_${kind}_schema`;
    const admin = new pg.Client({ connectionString: harness[kind], connectionTimeoutMillis: 3000 });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${database}`);
    } finally {
      await admin.end();
    }
    const adminUrl = new URL(harness[kind]);
    adminUrl.pathname = `/${database}`;
    await bootstrapDatabase(adminUrl.toString(), kind, database, passwords);
    await bootstrapDatabase(adminUrl.toString(), kind, database, passwords);
    for (const role of databaseRoles[kind]) {
      const url = new URL(adminUrl);
      url.username = role;
      url.password = passwords[role];
      urls[role] = url.toString();
    }
  }
  return urls;
}
