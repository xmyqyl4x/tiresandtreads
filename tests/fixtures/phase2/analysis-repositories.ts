import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { partnerRepositoryFixture, partnerRepositorySources } from './partner-repositories.ts';
import { disposableTargets } from '../foundation/target.ts';
import { identifier } from '../../../scripts/database/bootstrap.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
export const analysisRoles = [
  'tt_p2_ai_runtime',
  'tt_p2_ai_worker',
  'tt_p2_ai_staff',
  'tt_p2_photo_runtime',
  'tt_p2_photo_worker',
  'tt_p2_csv_staff',
  'tt_p2_csv_worker',
  'tt_p2_photo_assets',
  'tt_p2_photo_processor',
] as const;
export type AnalysisRole = (typeof analysisRoles)[number];
export function analysisRepositorySources() {
  const dir = 'infra/database/phase-2-local/analysis-repositories/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')) as {
    kind: string;
    promoted: boolean;
    baseAppManifestSha256: string;
    priorLocalManifestSha256: string;
    priorLocalHead: string;
    migrations: { id: string; sha256: string }[];
    tables: string[];
  };
  const prior = partnerRepositorySources(),
    ids = ['0045_analysis_repository_support'];
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/repositories/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)?.id ||
    JSON.stringify(manifest.migrations.map((x) => x.id)) !== JSON.stringify(ids) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((x) => x.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(ids.map((x) => x + '.sql'))
  )
    throw Error('Exact local repository source chain required');
  const extra = manifest.migrations.map((x) => ({
    ...x,
    source: readFileSync(dir + x.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { manifest, sources: [...prior.sources, ...extra] };
}
export async function analysisRepositoryFixture() {
  const base = await partnerRepositoryFixture(),
    root = new pg.Client({
      connectionString: disposableTargets(process.env).app,
      connectionTimeoutMillis: 3000,
    }),
    pools: pg.Pool[] = [],
    passwords = new Map<string, string>();
  let connected = false;
  const created = new Set<string>();
  async function cleanup() {
    try {
      await Promise.all(pools.map((p) => p.end()));
    } finally {
      try {
        if (created.has('tt_p2_photo_processor')) {
          await root.query('REVOKE CONNECT ON DATABASE tt_app_catalog FROM tt_p2_photo_processor');
          await root.query('DROP ROLE IF EXISTS tt_p2_photo_processor');
        }
        await base.cleanup();
      } finally {
        if (connected) {
          try {
            if (created.has('tt_p2_photo_assets')) {
              await root.query('DROP ROLE IF EXISTS tt_p2_photo_assets');
            }
          } finally {
            await root.end();
          }
        }
      }
    }
  }
  try {
    await root.connect();
    connected = true;
    // Only roles just created by this disposable fixture; no external identities or persistent cluster.
    for (const role of analysisRoles) {
      const pw = randomBytes(32).toString('hex');
      if (role === 'tt_p2_photo_assets' || role === 'tt_p2_photo_processor') {
        if ((await root.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
          throw Error('Owned role must be absent');
        await root.query(
          `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
        );
        created.add(role);
        await root.query('GRANT CONNECT ON DATABASE tt_app_catalog TO ' + identifier(role));
      } else await root.query(`ALTER ROLE ${identifier(role)} PASSWORD '${pw}'`);
      passwords.set(role, pw);
    }
    await root.query(
      'GRANT tt_p2_ai_worker,tt_p2_photo_worker TO tt_p2_photo_processor WITH INHERIT TRUE',
    );
    const applied = await migrateApplication(base.target, analysisRepositorySources().sources);
    function analysisPool(role: AnalysisRole, max = 2) {
      if (!analysisRoles.includes(role) || !Number.isInteger(max) || max < 1 || max > 4)
        throw Error('Fixed actor/bounded pool required');
      const url = new URL(base.target.url);
      url.username = role;
      url.password = passwords.get(role)!;
      const pool = new pg.Pool({
        connectionString: url.toString(),
        max,
        connectionTimeoutMillis: 3000,
      });
      pools.push(pool);
      return pool;
    }
    function privacyAdapter() {
      const pool = new pg.Pool({
        connectionString: base.connectionUrl('tt_privacy_runtime'),
        max: 2,
        connectionTimeoutMillis: 3000,
      });
      pools.push(pool);
      return createTransactions(pool, { transactionMs: 15000, statementMs: 8000, lockMs: 3000 });
    }
    const analysisAdapter = (role: AnalysisRole, max = 2) =>
      createTransactions(analysisPool(role, max), {
        transactionMs: 15000,
        statementMs: 8000,
        lockMs: 3000,
      });
    return {
      ...base,
      cleanup,
      analysisPool,
      analysisAdapter,
      privacyAdapter,
      analysisApplied: applied,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
