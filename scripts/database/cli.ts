import { readFileSync } from 'node:fs';
import { bootstrapDatabase, databaseRoles, type RolePasswords } from './bootstrap.ts';
import { loadSources, pendingMigrations } from './manifest.ts';
import { migrateApplication, readHistory, withMigrationLock } from './migrate.ts';
import { migrateCms } from './cms.ts';

async function main(): Promise<void> {
  const [action] = process.argv.slice(2);
  if (
    !['bootstrap', 'migrate', 'status', 'seed'].includes(action ?? '') ||
    !['dev-local', 'stage-local'].includes(process.env.APP_ENV ?? '')
  )
    throw new Error('Use the selected local database operator command');
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((role) => {
        const value = process.env[`DB_PASSWORD_${role.toUpperCase()}`];
        if (!value || !/^[a-f0-9]{64}$/.test(value))
          throw new Error('Missing local role credential');
        return [role, value];
      }),
  ) as RolePasswords;
  const secret = process.env.CMS_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Missing CMS secret');
  for (const kind of ['app', 'cms'] as const) {
    const database = `tt_${kind}`;
    const role = databaseRoles[kind][0];
    const url = `postgresql://${role}:${passwords[role]}@postgres:5432/${database}`;
    const target = { kind, database, url };
    if (action === 'bootstrap') {
      const adminUrl = process.env[`DB_ADMIN_${kind.toUpperCase()}_URL`];
      if (!adminUrl) throw new Error('Bootstrap requires separate operator credentials');
      const parsed = new URL(adminUrl);
      if (
        parsed.protocol !== 'postgresql:' ||
        parsed.hostname !== 'postgres' ||
        parsed.port !== '5432' ||
        parsed.pathname !== `/${database}` ||
        parsed.username !== 'local_harness' ||
        parsed.search ||
        parsed.hash
      )
        throw new Error('Refusing redirected local bootstrap');
      await bootstrapDatabase(adminUrl, kind, database, passwords);
      console.log(`${kind}: database ownership and restricted roles provisioned`);
    } else if (action === 'migrate') {
      const count =
        kind === 'app'
          ? await migrateApplication(target, loadSources('app'))
          : await migrateCms(target, secret);
      console.log(`${kind}: applied ${count} migration(s)`);
    } else if (action === 'status') {
      await withMigrationLock(target, async (client) => {
        const history = await readHistory(client);
        const pending = pendingMigrations(loadSources(kind), history);
        console.log(`${kind}: ${history.length} applied, ${pending.length} pending`);
      });
    } else if (action === 'seed' && kind === 'app') {
      await withMigrationLock(target, async (client) => {
        if (pendingMigrations(loadSources('app'), await readHistory(client)).length)
          throw new Error('Apply migrations before seeding');
        await client.query('BEGIN');
        try {
          await client.query(readFileSync('infra/database/seeds/synthetic.sql', 'utf8'));
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      console.log('app: synthetic local fixtures seeded; no identity or access enabled');
    }
  }
}

// SDK generation/migration tooling can retain idle handles; all owned clients are drained first.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // Do not print connection strings, driver messages, SQL parameters or SDK error objects.
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9]{5}$/.test(error.code)
        ? error.code
        : 'OPERATOR_FAILURE';
    console.error(
      `Database command failed (${code}); inspect the local target and migration evidence`,
    );
    process.exit(1);
  });
