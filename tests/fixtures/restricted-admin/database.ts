import { randomBytes } from 'node:crypto';
import pg from 'pg';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type DatabaseRole,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';
import { disposableTargets } from '../foundation/target.ts';

type Target = 'app' | 'cms';
type Actor = DatabaseRole | 'restricted_probe_admin' | 'local_harness';

// Investigation only. Nothing here is a hosted bootstrap adapter or runtime dependency.
export async function restrictedAdminFixture() {
  const targets = disposableTargets(process.env);
  const roles = Object.values(databaseRoles).flat();
  const proofRoles = [
    'restricted_probe_admin',
    'restricted_probe_child',
    'restricted_probe_elevated',
  ];
  const databases = { app: 'tt_app_restricted_probe', cms: 'tt_cms_restricted_probe' } as const;
  const passwords = Object.fromEntries(
    roles.map((role) => [role, randomBytes(32).toString('hex')]),
  ) as RolePasswords;
  const adminPassword = randomBytes(32).toString('hex');
  const root = new pg.Client({ connectionString: targets.app, connectionTimeoutMillis: 3000 });
  const ownedDatabases: string[] = [];
  let ownsRoles = false;
  let restricted: pg.Client | undefined;

  function url(target: Target, actor: Actor = 'restricted_probe_admin') {
    const value = new URL(targets[target]);
    value.pathname = '/' + databases[target];
    if (actor !== 'local_harness') {
      value.username = actor;
      value.password = actor === 'restricted_probe_admin' ? adminPassword : passwords[actor];
    }
    return value.toString();
  }

  async function withClient<T>(
    target: Target,
    actor: Actor,
    work: (client: pg.Client) => Promise<T>,
  ) {
    const client = new pg.Client({
      connectionString: url(target, actor),
      connectionTimeoutMillis: 3000,
      statement_timeout: 3000,
    });
    try {
      await client.connect();
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async function cleanup() {
    await restricted?.end();
    try {
      for (const database of ownedDatabases)
        await root.query(`DROP DATABASE ${identifier(database)}`);
      if (ownsRoles) {
        for (const role of [...roles, ...proofRoles])
          await root.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
      }
    } finally {
      await root.end();
    }
  }

  try {
    await root.connect();
    const existingRoles = await root.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [
      [...roles, ...proofRoles],
    ]);
    const existingDatabases = await root.query('SELECT 1 FROM pg_database WHERE datname=ANY($1)', [
      Object.values(databases),
    ]);
    if (existingRoles.rowCount || existingDatabases.rowCount)
      throw Error('Restricted-admin investigation requires absent proof roles and databases');
    ownsRoles = true;
    for (const database of Object.values(databases)) {
      await root.query(`CREATE DATABASE ${identifier(database)}`);
      ownedDatabases.push(database);
    }
    await root.query(
      `CREATE ROLE restricted_probe_admin LOGIN PASSWORD '${adminPassword}' NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`,
    );
    restricted = new pg.Client({
      connectionString: url('app'),
      connectionTimeoutMillis: 3000,
      statement_timeout: 3000,
    });
    await restricted.connect();
  } catch (error) {
    await cleanup();
    throw error;
  }

  const session = restricted;
  async function count(query: string) {
    return (await root.query(query, [roles])).rowCount;
  }
  async function snapshot() {
    const roleState = (
      await root.query(
        'SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname',
        [[...roles, ...proofRoles]],
      )
    ).rows;
    const memberships = (
      await root.query(
        'SELECT r.rolname AS role, u.rolname AS member, g.rolname AS grantor, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE r.rolname=ANY($1) OR u.rolname=ANY($1) ORDER BY r.rolname,u.rolname,g.rolname',
        [[...roles, ...proofRoles]],
      )
    ).rows;
    const state = [];
    for (const target of ['app', 'cms'] as const) {
      state.push(
        await withClient(target, 'local_harness', async (client) => ({
          database: (
            await client.query(
              'SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()',
            )
          ).rows,
          databaseAcl: (
            await client.query(
              "SELECT a.grantee, a.grantor, a.privilege_type, a.is_grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable",
            )
          ).rows,
          publicSchema: (
            await client.query(
              "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'",
            )
          ).rows,
          schemaAcl: (
            await client.query(
              "SELECT a.grantee, a.grantor, a.privilege_type, a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public' ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable",
            )
          ).rows,
          defaults: (
            await client.query(
              'SELECT pg_get_userbyid(d.defaclrole) AS role, d.defaclnamespace, d.defaclobjtype, a.grantee, a.grantor, a.privilege_type, a.is_grantable FROM pg_default_acl d LEFT JOIN LATERAL aclexplode(d.defaclacl) a ON true ORDER BY role,d.defaclnamespace,d.defaclobjtype,a.grantee,a.grantor,a.privilege_type,a.is_grantable',
            )
          ).rows,
        })),
      );
    }
    const roleSettings = (
      await root.query(
        'SELECT r.rolname AS role, d.datname AS database, ARRAY(SELECT v FROM unnest(s.setconfig) v ORDER BY v) AS config FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE r.rolname=ANY($1) ORDER BY r.rolname,d.datname',
        [[...roles, ...proofRoles]],
      )
    ).rows;
    return { roleState, memberships, roleSettings, databases: state };
  }

  return {
    root,
    restricted: session,
    passwords,
    url,
    withClient,
    cleanup,
    snapshot,
    database: (target: Target) => databases[target],
    scopedRoleCount: () => count('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)'),
    scopedMembershipCount: () =>
      count(
        'SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname=ANY($1) OR u.rolname=ANY($1)',
      ),
    async createChild() {
      await session.query(
        'CREATE ROLE restricted_probe_child NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
      );
    },
    async memberships(role: string) {
      return (
        await root.query<{
          member: string;
          grantor: string;
          admin_option: boolean;
          inherit_option: boolean;
          set_option: boolean;
        }>(
          'SELECT u.rolname AS member, g.rolname AS grantor, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE r.rolname=$1 ORDER BY u.rolname,g.rolname',
          [role],
        )
      ).rows;
    },
    async precreateScopedRoles() {
      for (const role of roles)
        await session.query(
          `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${passwords[role]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`,
        );
    },
    async bootstrapAsRoot() {
      for (const target of ['app', 'cms'] as const)
        await bootstrapDatabase(url(target, 'local_harness'), target, databases[target], passwords);
    },
    async allowAdminConnect() {
      for (const target of ['app', 'cms'] as const)
        await root.query(
          `GRANT CONNECT ON DATABASE ${identifier(databases[target])} TO restricted_probe_admin`,
        );
    },
  };
}
