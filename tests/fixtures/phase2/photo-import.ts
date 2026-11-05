import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { aiFixture, aiSources } from './ai.ts';
import { disposableTargets } from '../foundation/target.ts';
import { identifier } from '../../../scripts/database/bootstrap.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';

export const photoImportRoles = [
  'tt_p2_photo_runtime',
  'tt_p2_photo_worker',
  'tt_p2_csv_staff',
  'tt_p2_csv_worker',
] as const;
export type PhotoImportRole = (typeof photoImportRoles)[number];
const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
export function photoImportSources() {
  const directory = 'infra/database/phase-2-local/photo-import/';
  const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8')) as {
    kind: string;
    promoted: boolean;
    baseAppManifestSha256: string;
    priorLocalManifestSha256: string;
    priorLocalHead: string;
    migrations: { id: string; sha256: string }[];
    tables: string[];
  };
  const prior = aiSources(),
    ids = ['0040_photo_uploads', '0041_photo_results', '0042_staff_csv'];
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha(readFileSync('infra/database/app/manifest.json')) ||
    manifest.priorLocalManifestSha256 !==
      sha(readFileSync('infra/database/phase-2-local/ai/manifest.json')) ||
    prior.sources.at(-1)?.id !== manifest.priorLocalHead ||
    JSON.stringify(manifest.migrations.map((m) => m.id)) !== JSON.stringify(ids) ||
    JSON.stringify(
      readdirSync(directory)
        .filter((f) => f.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(ids.map((id) => id + '.sql'))
  )
    throw new Error('Local photo/import track requires exact prior sources');
  const extension = manifest.migrations.map((m) => ({
    ...m,
    source: readFileSync(directory + m.id + '.sql', 'utf8'),
  }));
  validateSources(extension);
  return { manifest, sources: [...prior.sources, ...extension] };
}
export async function photoImportFixture() {
  const targets = disposableTargets(process.env),
    base = await aiFixture();
  const control = new pg.Client({ connectionString: targets.app, connectionTimeoutMillis: 3000 });
  const clients: pg.Client[] = [],
    created: PhotoImportRole[] = [],
    passwords = new Map<PhotoImportRole, string>();
  let connected = false;
  async function cleanup() {
    try {
      await Promise.all(clients.map((c) => c.end()));
    } finally {
      try {
        await base.cleanup();
      } finally {
        if (connected) {
          try {
            for (const role of created) await control.query(`DROP ROLE ${identifier(role)}`);
          } finally {
            await control.end();
          }
        }
      }
    }
  }
  try {
    await control.connect();
    connected = true;
    if (
      (
        await control.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)', [
          photoImportRoles,
        ])
      ).rowCount
    )
      throw new Error('Photo/import fixture requires absent owned roles');
    for (const role of photoImportRoles) {
      const pw = randomBytes(32).toString('hex');
      await control.query(
        `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      created.push(role);
      passwords.set(role, pw);
      await control.query(`GRANT CONNECT ON DATABASE tt_app_catalog TO ${identifier(role)}`);
    }
    const observationUrl = new URL(targets.app);
    observationUrl.pathname = '/tt_app_catalog';
    const observer = new pg.Client({ connectionString: observationUrl.toString() });
    await observer.connect();
    clients.push(observer);
    if (
      !(await observer.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0]
        ?.rolsuper
    )
      throw new Error('Full snapshot requires the owned disposable observation identity');
    await observer.query('SET default_transaction_read_only=on');
    await base.admin.query(
      "INSERT INTO app.ai_policy_versions(task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash) VALUES('photo_extraction','retained-synthetic','retained-v1','p1','s1','v1','local-jsonb-v1',$1)",
      [sha(randomBytes(32))],
    );
    const p1 = JSON.parse(readFileSync('infra/database/s1-contract.json', 'utf8')) as {
      app: { tables: string[] };
    };
    const tables = [
      ...p1.app.tables,
      ...(JSON.parse(readFileSync('infra/database/phase-2-local/app/manifest.json', 'utf8'))
        .tables as string[]),
      ...aiSources().manifest.tables,
    ];
    async function snapshot() {
      const rows: { table: string; digest: string; count: number }[] = [];
      await observer.query('SET row_security=off');
      try {
        for (const table of tables) {
          const parts = table.split('.');
          if (parts.length !== 2) throw new Error('Invalid fixed table');
          const result = await observer.query(
            `SELECT to_jsonb(t) AS row FROM ${identifier(parts[0]!)}.${identifier(parts[1]!)} t${table === 'migration_meta.applied' ? ' WHERE position<=39' : table === 'app.code_values' ? " WHERE NOT (set_code='asset_purpose' AND code IN ('tire_photo_original','tire_photo_sanitized'))" : ''} ORDER BY to_jsonb(t)::text`,
          );
          rows.push({
            table,
            digest: sha(JSON.stringify(result.rows)),
            count: result.rowCount ?? 0,
          });
        }
      } finally {
        await observer.query('SET row_security=on');
      }
      return rows;
    }
    const before = await snapshot();
    const oldRelations = (
      await base.admin.query(
        "SELECT c.oid::int AS oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('r','v')",
        [['app', 'privacy', 'email', 'admin', 'analytics', 'migration_meta', 'partners']],
      )
    ).rows.map((r) => r.oid);
    const oldFunctions = (
      await base.admin.query(
        'SELECT p.oid::int AS oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1)',
        [['app', 'privacy', 'email', 'admin', 'analytics', 'migration_meta', 'partners']],
      )
    ).rows.map((r) => r.oid);
    async function permissions() {
      return {
        relations: (
          await base.admin.query(
            'SELECT oid::int,relowner::regrole::text,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=ANY($1::oid[]) ORDER BY oid',
            [oldRelations],
          )
        ).rows,
        functions: (
          await base.admin.query(
            'SELECT oid::int,proowner::regrole::text,proacl::text,prosecdef,proconfig FROM pg_proc WHERE oid=ANY($1::oid[]) ORDER BY oid',
            [oldFunctions],
          )
        ).rows,
      };
    }
    const beforePermissions = await permissions(),
      beforeHistory = (
        await base.admin.query(
          'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position',
        )
      ).rows;
    const installPhotoImport = () => migrateApplication(base.target, photoImportSources().sources);
    const appliedPhotoImport = await installPhotoImport(),
      after = await snapshot(),
      afterPermissions = await permissions();
    async function photoImportConnect(role: PhotoImportRole) {
      const url = new URL(base.connectionUrl('tt_app_migrator'));
      url.username = role;
      url.password = passwords.get(role)!;
      const client = new pg.Client({
        connectionString: url.toString(),
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        lock_timeout: 3000,
      });
      await client.connect();
      clients.push(client);
      return client;
    }
    return {
      ...base,
      cleanup,
      photoImportConnect,
      installPhotoImport,
      appliedPhotoImport,
      photoImportBefore: before,
      photoImportAfter: after,
      photoImportBeforePermissions: beforePermissions,
      photoImportAfterPermissions: afterPermissions,
      photoImportBeforeHistory: beforeHistory,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
