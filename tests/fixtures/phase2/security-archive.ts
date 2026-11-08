import pg from 'pg';
import { createHash } from 'node:crypto';
import { disposableTargets } from '../foundation/target.ts';
import { gateCatalog } from './schema-gate.ts';
import { readFileSync } from 'node:fs';
// Fixed isolated archive rehearsal, never a production backup/restore executor or admission.
const database = 'tt_app_p2_security_restore',
  archive = '/tmp/tt_p2_security.dump';
const formatPairs = JSON.parse(
  readFileSync('tests/fixtures/phase2/restore-check-formatting.json', 'utf8'),
) as { before: string; after: string }[];
export function expectedSecurityRestoreCatalog(source: Awaited<ReturnType<typeof gateCatalog>>) {
  return {
    ...source,
    constraints: source.constraints.map((row) => ({
      ...row,
      definition: formatPairs.find((p) => p.before === row.definition)?.after ?? row.definition,
    })),
  };
}
async function snapshot(client: pg.Client, tables: readonly string[]) {
  const result = [];
  for (const name of tables) {
    if (
      !/^(app|partners|admin|privacy|email|analytics|migration_meta)\.[a-z][a-z0-9_]*$/.test(name)
    )
      throw Error('Fixed local catalog identifier required');
    const quoted = name
        .split('.')
        .map((s) => '"' + s + '"')
        .join('.'),
      rows = (
        await client.query(
          'SELECT to_jsonb(t) AS row FROM ' + quoted + ' t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    result.push({
      table: name,
      count: rows.length,
      hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    });
  }
  return result;
}
export async function withSecurityArchive<T>(
  run: (proof: {
    restored: pg.Client;
    sourceCatalog: Awaited<ReturnType<typeof gateCatalog>>;
    restoredCatalog: Awaited<ReturnType<typeof gateCatalog>>;
    sourceRows: Awaited<ReturnType<typeof snapshot>>;
    restoredRows: Awaited<ReturnType<typeof snapshot>>;
    archiveBytes: number;
  }) => Promise<T>,
) {
  const targets = disposableTargets(process.env),
    sourceUrl = new URL(targets.app);
  sourceUrl.pathname = '/tt_app_catalog';
  const root = new pg.Client({
      connectionString: targets.app,
      connectionTimeoutMillis: 3000,
      statement_timeout: 30000,
    }),
    source = new pg.Client({
      connectionString: sourceUrl.toString(),
      connectionTimeoutMillis: 3000,
      statement_timeout: 30000,
    });
  let restored: pg.Client | undefined,
    created = false,
    archiveOwned = false,
    rootConnected = false,
    sourceConnected = false,
    failed = false;
  let result: T | undefined, failure: unknown;
  try {
    await root.connect();
    rootConnected = true;
    if ((await root.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
      throw Error('Owned archive target must be absent');
    if (
      (await root.query('SELECT (pg_stat_file($1,true)).size AS size', [archive])).rows[0]?.size !=
      null
    )
      throw Error('Owned archive path must be absent');
    await source.connect();
    sourceConnected = true;
    if (
      (await source.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]?.n !== 55
    )
      throw Error('Exact local55 source required');
    const sourceCatalog = await gateCatalog(source),
      tables = sourceCatalog.relations
        .filter((r) => r.relkind === 'r')
        .map((r) => r.schema + '.' + r.relname);
    if (tables.length !== 225) throw Error('Exact local225 table inventory required');
    await source.query('BEGIN');
    // Read-share lock blocks writers while pg_dump reads its independent consistent snapshot.
    await source.query(
      'LOCK TABLE ' +
        tables
          .map((n) =>
            n
              .split('.')
              .map((s) => '"' + s + '"')
              .join('.'),
          )
          .join(',') +
        ' IN SHARE MODE',
    );
    const sourceRows = await snapshot(source, tables);
    archiveOwned = true;
    await root.query(
      "COPY (SELECT 1 WHERE false) TO PROGRAM 'pg_dump --username=local_harness --format=custom --no-tablespaces --file=/tmp/tt_p2_security.dump tt_app_catalog'",
    );
    const archiveBytes = Number(
      (await root.query('SELECT (pg_stat_file($1)).size::text AS bytes', [archive])).rows[0]!.bytes,
    );
    await source.query('COMMIT');
    await root.query('CREATE DATABASE ' + database);
    created = true;
    await root.query('REVOKE ALL ON DATABASE ' + database + ' FROM PUBLIC');
    await root.query(
      "COPY (SELECT 1 WHERE false) TO PROGRAM 'pg_restore --username=local_harness --no-tablespaces --exit-on-error --single-transaction --dbname=tt_app_p2_security_restore /tmp/tt_p2_security.dump'",
    );
    const restoredUrl = new URL(targets.app);
    restoredUrl.pathname = '/' + database;
    restored = new pg.Client({
      connectionString: restoredUrl.toString(),
      connectionTimeoutMillis: 3000,
      statement_timeout: 15000,
    });
    await restored.connect();
    await restored.query('SET default_transaction_read_only=on');
    result = await run({
      restored,
      sourceCatalog,
      restoredCatalog: await gateCatalog(restored),
      sourceRows,
      restoredRows: await snapshot(restored, tables),
      archiveBytes,
    });
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    const errors: unknown[] = [];
    for (const action of [
      async () => {
        if (sourceConnected) {
          await source.query('ROLLBACK');
          await source.end();
        }
      },
      async () => {
        await restored?.end();
      },
      async () => {
        if (created) await root.query('DROP DATABASE ' + database);
      },
      async () => {
        if (archiveOwned)
          await root.query(
            "COPY (SELECT 1 WHERE false) TO PROGRAM 'rm -f -- /tmp/tt_p2_security.dump'",
          );
      },
      async () => {
        if (rootConnected) await root.end();
      },
    ])
      try {
        await action();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) {
      failure = new AggregateError(
        failed ? [failure, ...errors] : errors,
        'Owned archive rehearsal cleanup failed',
      );
      failed = true;
    }
  }
  if (failed) throw failure;
  return result as T;
}
