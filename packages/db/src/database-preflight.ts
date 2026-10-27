import pg from 'pg';
import { X509Certificate } from 'node:crypto';
import { readLocalDatabasePreflight } from '../../config/src/database-preflight.ts';
import { databaseRoles } from '../../config/src/database-roles.ts';

export type DatabasePreflightFinding =
  | 'tls'
  | 'version'
  | 'identity'
  | 'database_owner'
  | 'missing_schema'
  | 'schema_owner'
  | 'object_owner'
  | 'missing_role'
  | 'role_capabilities'
  | 'role_memberships'
  | 'database_acl'
  | 'schema_acl'
  | 'runtime_database_privileges'
  | 'default_privileges'
  | 'migrations';
export interface DatabasePreflightReport {
  scope: 'local-fixture';
  status: 'compatible' | 'incompatible' | 'configuration' | 'unavailable';
  compatible: boolean;
  findings: readonly DatabasePreflightFinding[];
  checks?: {
    readOnly: true;
    tls: boolean;
    serverVersion: number;
    expectedRoles: number;
    actualRoles: number;
    schemas: number;
    relations: number;
    migrations: number;
  };
}

export async function preflightLocalDatabase(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
): Promise<DatabasePreflightReport> {
  const failed = (status: 'configuration' | 'unavailable'): DatabasePreflightReport => ({
    scope: 'local-fixture',
    status,
    compatible: false,
    findings: [],
  });
  let s: ReturnType<typeof readLocalDatabasePreflight>;
  try {
    s = readLocalDatabasePreflight(input, env);
    const ca = new X509Certificate(s.connection.ssl.ca);
    if (!ca.ca || Date.parse(ca.validTo) <= Date.now() || Date.parse(ca.validFrom) > Date.now())
      throw Error();
  } catch {
    return failed('configuration');
  }
  const client = new pg.Client(s.connection);
  client.on('error', () => {});
  try {
    await client.connect();
    await client.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='1s'; SET LOCAL lock_timeout='250ms'; SET LOCAL idle_in_transaction_session_timeout='1s'; SET LOCAL transaction_timeout='5s'",
    );
    const owner = databaseRoles[s.target][0],
      roles = databaseRoles[s.target];
    const namespaces =
      s.target === 'app'
        ? ['app', 'admin', 'privacy', 'email', 'analytics', 'public', 'migration_meta']
        : ['public', 'migration_meta'];
    const state = (
      await client.query(`SELECT current_user AS actor,current_database() AS database,current_setting('server_version_num')::integer AS version,current_setting('transaction_read_only') AS readonly,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
      pg_get_userbyid(d.datdba) AS owner,
      (SELECT count(*)::int FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0) AS public_grants
      FROM pg_database d WHERE d.datname=current_database()`)
    ).rows[0];
    const schema = (
      await client.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE pg_get_userbyid(nspowner)<>$2)::int AS wrong_owner,
      (SELECT count(*)::int FROM pg_namespace x CROSS JOIN LATERAL aclexplode(COALESCE(x.nspacl,acldefault('n',x.nspowner))) a WHERE x.nspname=ANY($1) AND a.grantee=0) AS public_grants
      FROM pg_namespace WHERE nspname=ANY($1)`,
        [namespaces, owner],
      )
    ).rows[0];
    const objects = (
      await client.query(
        `SELECT count(*)::int AS relations,count(*) FILTER(WHERE pg_get_userbyid(c.relowner)<>$2)::int AS wrong_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1)`,
        [namespaces, owner],
      )
    ).rows[0];
    const otherObjects = (
      await client.query(
        `SELECT (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND pg_get_userbyid(p.proowner)<>$2) + (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY($1) AND pg_get_userbyid(t.typowner)<>$2) AS wrong_owner`,
        [namespaces, owner],
      )
    ).rows[0];
    const roleRows = (
      await client.query(
        `SELECT r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit,r.rolcanlogin,
      EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) AS memberships,
      has_database_privilege(r.oid,(SELECT oid FROM pg_database WHERE datname=$2),'CONNECT') AS connect,
      has_database_privilege(r.oid,(SELECT oid FROM pg_database WHERE datname=$2),'CREATE') AS create_db,
      has_database_privilege(r.oid,(SELECT oid FROM pg_database WHERE datname=$2),'TEMP') AS temp,
      has_database_privilege(r.oid,(SELECT oid FROM pg_database WHERE datname=$3),'CONNECT') AS peer_connect
      FROM pg_roles r WHERE r.rolname=ANY($1) ORDER BY r.rolname`,
        [roles, s.database, s.peerDatabase],
      )
    ).rows;
    const defaults = (
      await client.query(
        `SELECT count(*)::int AS public_grants FROM (VALUES ('f'::"char"),('T'::"char")) k(kind)
      CROSS JOIN LATERAL aclexplode(COALESCE((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=$1::regrole AND defaclnamespace=0 AND defaclobjtype=k.kind),acldefault(k.kind,$1::regrole))) a WHERE a.grantee=0`,
        [owner],
      )
    ).rows[0];
    const history = (
      await client.query(
        'SELECT id,sha256 FROM migration_meta.applied ORDER BY position LIMIT 1001',
      )
    ).rows;
    const findings: DatabasePreflightFinding[] = [];
    const add = (bad: boolean, code: DatabasePreflightFinding) => {
      if (bad) findings.push(code);
    };
    add(state.tls !== true, 'tls');
    add(state.version !== s.expectedVersion, 'version');
    add(
      state.actor !== owner || state.database !== s.database || state.readonly !== 'on',
      'identity',
    );
    add(state.owner !== owner, 'database_owner');
    add(schema.total !== namespaces.length, 'missing_schema');
    add(schema.wrong_owner !== 0, 'schema_owner');
    add(objects.wrong_owner !== 0 || otherObjects.wrong_owner !== 0, 'object_owner');
    add(roleRows.length !== roles.length, 'missing_role');
    add(
      roleRows.some(
        (r) =>
          r.rolsuper ||
          r.rolcreatedb ||
          r.rolcreaterole ||
          r.rolreplication ||
          r.rolbypassrls ||
          r.rolinherit ||
          !r.rolcanlogin,
      ),
      'role_capabilities',
    );
    add(
      roleRows.some((r) => r.memberships),
      'role_memberships',
    );
    add(state.public_grants !== 0, 'database_acl');
    add(schema.public_grants !== 0, 'schema_acl');
    add(
      roleRows.some(
        (r) =>
          r.rolname !== owner && (!r.connect || r.create_db || r.temp || r.peer_connect !== false),
      ),
      'runtime_database_privileges',
    );
    add(defaults.public_grants !== 0, 'default_privileges');
    add(
      history.length !== s.expectedMigrations ||
        history.some(
          (r, i) => r.id !== s.expectedHistory[i]?.id || r.sha256 !== s.expectedHistory[i]?.sha256,
        ),
      'migrations',
    );
    await client.query('COMMIT');
    return {
      scope: 'local-fixture',
      status: findings.length ? 'incompatible' : 'compatible',
      compatible: findings.length === 0,
      findings,
      checks: {
        readOnly: true,
        tls: state.tls === true,
        serverVersion: state.version,
        expectedRoles: roles.length,
        actualRoles: roleRows.length,
        schemas: schema.total,
        relations: objects.relations,
        migrations: history.length,
      },
    };
  } catch {
    return failed('unavailable');
  } finally {
    await client.end().catch(() => {});
  }
}
