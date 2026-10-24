import pg from 'pg';
import { pendingMigrations, validateSources, type MigrationSource } from './manifest.ts';

export interface MigrationTarget {
  readonly url: string;
  readonly database: string;
  readonly kind: 'app' | 'cms';
}

export async function withMigrationLock<T>(
  target: MigrationTarget,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString: target.url,
    connectionTimeoutMillis: 3000,
    statement_timeout: 15000,
    lock_timeout: 3000,
  });
  await client.connect();
  try {
    const identity = await client.query(
      'SELECT current_user AS role, current_database() AS database, pg_get_userbyid(datdba) AS owner, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolinherit FROM pg_roles JOIN pg_database ON datname=current_database() WHERE rolname=current_user',
    );
    const row = identity.rows[0];
    if (
      row?.role !== `tt_${target.kind}_migrator` ||
      row.database !== target.database ||
      row.owner !== row.role ||
      row.rolsuper ||
      row.rolcreatedb ||
      row.rolcreaterole ||
      row.rolbypassrls ||
      row.rolreplication ||
      row.rolinherit
    )
      throw new Error('Migration requires the matching restricted database owner');
    const locked = await client.query('SELECT pg_try_advisory_lock(7724004, 1) AS acquired');
    if (!locked.rows[0]?.acquired)
      throw new Error('Another migration executor holds the database lock');
    await client.query(`CREATE SCHEMA IF NOT EXISTS migration_meta;
      CREATE TABLE IF NOT EXISTS migration_meta.applied (
        position integer CONSTRAINT applied_pk PRIMARY KEY,
        id text NOT NULL CONSTRAINT applied_id_uq UNIQUE,
        sha256 text NOT NULL CONSTRAINT applied_sha256_ck CHECK (sha256 ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT applied_position_ck CHECK (position > 0)
      );`);
    return await work(client);
  } finally {
    // Closing the dedicated connection also releases the session advisory lock on any failure.
    await client.end();
  }
}

export async function readHistory(client: pg.Client): Promise<{ id: string; sha256: string }[]> {
  const result = await client.query(
    'SELECT position, id, sha256 FROM migration_meta.applied ORDER BY position',
  );
  if (result.rows.some((row, index) => row.position !== index + 1))
    throw new Error('Migration history has gaps');
  return result.rows;
}

export async function migrateApplication(
  target: MigrationTarget,
  sources: readonly MigrationSource[],
): Promise<number> {
  if (target.kind !== 'app') throw new Error('Application runner refuses CMS target');
  validateSources(sources);
  return withMigrationLock(target, async (client) => {
    const history = await readHistory(client);
    const pending = pendingMigrations(sources, history);
    for (const [index, migration] of pending.entries()) {
      await client.query('BEGIN');
      try {
        await client.query(migration.source);
        await client.query(
          'INSERT INTO migration_meta.applied (position,id,sha256) VALUES ($1,$2,$3)',
          [history.length + index + 1, migration.id, migration.sha256],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return pending.length;
  });
}
