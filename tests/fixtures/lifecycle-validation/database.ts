import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { disposableTargets } from '../foundation/target.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type DatabaseRole,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { digest } from '../../../scripts/database/inventory.ts';
import {
  inspectLifecycle,
  lifecycleDatabases,
  lifecycleCatalog,
  lifecycleDatabaseAcl,
  lifecycleSourceDigest,
  readLifecycleRequest,
  withReadOnlyLifecycle,
  type LifecycleBaseline,
  type LifecyclePhase,
  type LifecycleTarget,
} from './reader.ts';

export async function lifecycleFixture(phase: LifecyclePhase) {
  const targets = disposableTargets(process.env);
  if (process.env.PROVIDER_MODE !== 'fixtures')
    throw Error('Disposable lifecycle fixture requires fixture mode');
  const root = new pg.Client({ connectionString: targets.app, connectionTimeoutMillis: 3000 });
  const roles = Object.values(databaseRoles).flat();
  const passwords = Object.fromEntries(
    roles.map((role) => [role, randomBytes(32).toString('hex')]),
  ) as RolePasswords;
  const ca = readFileSync('/tls/ca.crt', 'utf8');
  const createdDatabases: string[] = [];
  let ownsRoles = false;
  const url = (
    target: LifecycleTarget,
    actor: DatabaseRole | 'local_harness' = databaseRoles[target][0],
  ) => {
    const u = new URL(targets[target]);
    u.pathname = '/' + lifecycleDatabases[target];
    if (actor !== 'local_harness') {
      u.username = actor;
      u.password = passwords[actor];
    }
    return u.toString();
  };
  const input = (target: LifecycleTarget) => {
    const u = new URL(url(target));
    u.hostname = 'postgres.preflight.test';
    return { mode: 'local-lifecycle-proof', phase, target, url: u.toString(), ca };
  };
  async function withClient<T>(
    target: LifecycleTarget,
    actor: DatabaseRole | 'local_harness',
    work: (c: pg.Client) => Promise<T>,
  ) {
    const client = new pg.Client({
      connectionString: url(target, actor),
      connectionTimeoutMillis: 1500,
      statement_timeout: 3000,
      options: '-c search_path=pg_catalog',
    });
    try {
      await client.connect();
      return await work(client);
    } finally {
      await client.end().catch(() => {});
    }
  }
  async function cleanup() {
    try {
      for (const database of createdDatabases)
        await root.query(`DROP DATABASE ${identifier(database)}`);
      if (ownsRoles)
        for (const role of roles) await root.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
    } finally {
      await root.end();
    }
  }
  let baseline: LifecycleBaseline;
  try {
    await root.connect();
    if (
      (
        await root.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [
          [...roles, 'lifecycle_missing'],
        ])
      ).rowCount ||
      (
        await root.query('SELECT 1 FROM pg_database WHERE datname=ANY($1)', [
          Object.values(lifecycleDatabases),
        ])
      ).rowCount
    )
      throw Error('Lifecycle fixture refuses pre-existing scoped roles or databases');
    ownsRoles = true;
    for (const target of ['app', 'cms'] as const) {
      await root.query(`CREATE DATABASE ${identifier(lifecycleDatabases[target])}`);
      createdDatabases.push(lifecycleDatabases[target]);
      await bootstrapDatabase(
        url(target, 'local_harness'),
        target,
        lifecycleDatabases[target],
        passwords,
      );
    }
    const foundation = {} as Record<LifecycleTarget, string>;
    const databaseAcls = {} as Record<LifecycleTarget, Record<LifecyclePhase, string>>;
    for (const target of ['app', 'cms'] as const) {
      await withReadOnlyLifecycle(
        readLifecycleRequest(input(target), process.env),
        async (client) => {
          foundation[target] = digest(await lifecycleCatalog(client));
          const acl = await lifecycleDatabaseAcl(client);
          databaseAcls[target] = Object.freeze({
            foundation: digest(acl),
            migrated: digest(acl),
            'quarantined-recovery': digest(
              acl.filter(
                (row) =>
                  !(
                    (databaseRoles[target].slice(1) as readonly string[]).includes(row.grantee) &&
                    row.privilege_type === 'CONNECT'
                  ),
              ),
            ),
          });
        },
      );
    }
    let migrated: Record<LifecycleTarget, string> | undefined;
    if (phase !== 'foundation') {
      await migrateApplication(
        { kind: 'app', database: lifecycleDatabases.app, url: url('app') },
        loadSources('app'),
      );
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'tests/fixtures/lifecycle-validation/migrate.ts'],
        {
          env: {
            ...process.env,
            TT_LIFECYCLE_CMS_URL: url('cms'),
            TT_LIFECYCLE_CMS_SECRET: randomBytes(32).toString('hex'),
          },
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      if (child.status !== 0) throw Error('Synthetic lifecycle CMS migration failed');
      migrated = {} as Record<LifecycleTarget, string>;
      for (const target of ['app', 'cms'] as const)
        migrated[target] = await withReadOnlyLifecycle(
          readLifecycleRequest(input(target), process.env),
          async (client) => digest(await lifecycleCatalog(client)),
        );
    }
    baseline = Object.freeze({
      project: process.env.ISOLATED_TEST_PROJECT!,
      sourceDigest: lifecycleSourceDigest(),
      foundation: Object.freeze(foundation),
      ...(migrated ? { migrated: Object.freeze(migrated) } : {}),
      databaseAcls: Object.freeze(databaseAcls),
    });
    if (phase === 'quarantined-recovery') {
      for (const target of ['app', 'cms'] as const)
        await withClient(target, databaseRoles[target][0], async (client) => {
          for (const role of databaseRoles[target].slice(1))
            await client.query(
              `REVOKE CONNECT ON DATABASE ${identifier(lifecycleDatabases[target])} FROM ${identifier(role)}`,
            );
        });
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  async function snapshot() {
    const roleState = (
      await root.query(
        'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname',
        [roles],
      )
    ).rows;
    const memberships = (
      await root.query(
        'SELECT r.rolname AS role,u.rolname AS member,g.rolname AS grantor,m.admin_option,m.set_option,m.inherit_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE r.rolname=ANY($1) OR u.rolname=ANY($1) ORDER BY role,member,grantor',
        [roles],
      )
    ).rows;
    const settings = (
      await root.query(
        'SELECT r.rolname AS role,d.datname AS database,ARRAY(SELECT v FROM unnest(s.setconfig) v ORDER BY v) AS config FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE r.rolname=ANY($1) ORDER BY role,database',
        [roles],
      )
    ).rows;
    const databases = [];
    for (const target of ['app', 'cms'] as const)
      databases.push(
        await withClient(target, 'local_harness', async (client) => {
          const exists = (
            await client.query(
              "SELECT to_regclass('migration_meta.applied') IS NOT NULL AS history,to_regclass('public.payload_migrations') IS NOT NULL AS cms",
            )
          ).rows[0];
          return {
            target,
            owner: (
              await client.query(
                'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()',
              )
            ).rows,
            catalog: await lifecycleCatalog(client),
            acl: await lifecycleDatabaseAcl(client),
            history: exists.history
              ? (
                  await client.query(
                    'SELECT position,id,sha256,applied_at::text AS applied_at FROM migration_meta.applied ORDER BY position',
                  )
                ).rows
              : [],
            native: exists.cms
              ? (
                  await client.query(
                    'SELECT id,name,batch FROM public.payload_migrations ORDER BY name',
                  )
                ).rows
              : [],
          };
        }),
      );
    return { roleState, memberships, settings, databases };
  }
  return {
    root,
    baseline,
    input,
    snapshot,
    cleanup,
    inspect: (target: LifecycleTarget, patch: Record<string, unknown> = {}) =>
      inspectLifecycle({ ...input(target), ...patch }, process.env, baseline),
    withOwner: <T>(target: LifecycleTarget, work: (c: pg.Client) => Promise<T>) =>
      withClient(target, databaseRoles[target][0], work),
    withRoot: <T>(target: LifecycleTarget, work: (c: pg.Client) => Promise<T>) =>
      withClient(target, 'local_harness', work),
    activeInspections: async () =>
      (
        await root.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'tt-lifecycle-proof:%'",
        )
      ).rows[0].n as number,
    async assertRuntimeDenied() {
      for (const target of ['app', 'cms'] as const)
        for (const role of databaseRoles[target].slice(1)) {
          let refused = false;
          try {
            await withClient(target, role, async () => undefined);
          } catch (error) {
            refused =
              !!error && typeof error === 'object' && 'code' in error && error.code === '42501';
          }
          if (!refused) throw Error('Quarantined runtime connection was not denied');
        }
    },
  };
}
