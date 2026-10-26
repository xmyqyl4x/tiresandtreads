import pg from 'pg';

export const databaseRoles = {
  app: [
    'tt_app_migrator',
    'tt_app_runtime',
    'tt_staff_runtime',
    'tt_asset_runtime',
    'tt_catalog_runtime',
    'tt_ingest_runtime',
    'tt_publish_runtime',
    'tt_private_runtime',
    'tt_content_runtime',
    'tt_public_runtime',
    'tt_analytics_runtime',
    'tt_limiter_runtime',
    'tt_operations_runtime',
    'tt_report_source_runtime',
    'tt_privacy_runtime',
    'tt_staff_service_runtime',
    'tt_commercial_runtime',
  ],
  cms: ['tt_cms_migrator', 'tt_cms_runtime'],
} as const;
export type DatabaseRole = (typeof databaseRoles)[keyof typeof databaseRoles][number];
export type RolePasswords = Readonly<Record<DatabaseRole, string>>;

export function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid database identifier');
  return `"${value}"`;
}

// Operator-only provisioning. Callers select an isolated cluster before supplying admin access.
// No application process receives these credentials or imports this module.
export async function bootstrapDatabase(
  adminUrl: string,
  target: 'app' | 'cms',
  database: string,
  passwords: RolePasswords,
): Promise<void> {
  const dbName = identifier(database);
  for (const role of databaseRoles[target]) {
    if (!/^[a-f0-9]{64}$/.test(passwords[role]))
      throw new Error('Invalid generated role credential');
  }
  const owner = databaseRoles[target][0];
  const client = new pg.Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 15000,
  });
  await client.connect();
  try {
    const state = await client.query(
      'SELECT current_database() AS name, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()',
    );
    if (
      state.rows[0]?.name !== database ||
      !['local_harness', owner].includes(state.rows[0]?.owner)
    )
      throw new Error(
        'Refusing unexpected database or ownership; provision the selected host explicitly',
      );
    const foreign = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND tableowner <> $1 LIMIT 1",
      [owner],
    );
    if (foreign.rowCount) throw new Error('Refusing tables owned by an unexpected role');
    await client.query('BEGIN');
    for (const role of databaseRoles[target]) {
      const existing = await client.query(
        'SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles WHERE rolname=$1',
        [role],
      );
      if (existing.rowCount) {
        const flags = existing.rows[0];
        if (
          flags.rolsuper ||
          flags.rolcreatedb ||
          flags.rolcreaterole ||
          flags.rolreplication ||
          flags.rolbypassrls ||
          flags.rolinherit ||
          !flags.rolcanlogin
        )
          throw new Error('Existing role has unexpected capabilities');
        const membership = await client.query(
          'SELECT 1 FROM pg_auth_members WHERE member=$1::regrole OR roleid=$1::regrole',
          [role],
        );
        if (membership.rowCount) throw new Error('Existing role has unexpected memberships');
      } else {
        // Identifiers are constants; password is generated hex, never a user-supplied SQL fragment.
        await client.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${passwords[role]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`,
        );
      }
      // Payload's generated DDL is unqualified. Only its owner may create in public.
      const searchPath = role === owner ? 'public, pg_catalog' : 'pg_catalog, public';
      await client.query(
        `ALTER ROLE ${role} IN DATABASE ${dbName} SET search_path TO ${searchPath}`,
      );
      await client.query(`ALTER ROLE ${role} IN DATABASE ${dbName} SET statement_timeout TO '15s'`);
      await client.query(`ALTER ROLE ${role} IN DATABASE ${dbName} SET lock_timeout TO '3s'`);
      await client.query(
        `ALTER ROLE ${role} IN DATABASE ${dbName} SET idle_in_transaction_session_timeout TO '10s'`,
      );
    }
    await client.query(`ALTER DATABASE ${dbName} OWNER TO ${owner}`);
    await client.query(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query(`ALTER SCHEMA public OWNER TO ${owner}`);
    for (const role of databaseRoles[target].slice(1)) {
      await client.query(`REVOKE ALL ON DATABASE ${dbName} FROM ${role}`);
      await client.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${role}`);
    }
    // Never automatically grant future sensitive tables or functions to a runtime role.
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE USAGE ON TYPES FROM PUBLIC`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
