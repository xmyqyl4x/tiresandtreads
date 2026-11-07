import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { insightsFixture, insightsSources } from './partner-insights.ts';
import { disposableTargets } from '../foundation/target.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
export function analysisServiceSources() {
  const dir = 'infra/database/phase-2-local/report-analysis/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')),
    prior = insightsSources();
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/insights-services/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(manifest.migrations.map((m: { id: string }) => m.id)) !==
      JSON.stringify(['0049_report_analysis']) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((x) => x.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0049_report_analysis.sql'])
  )
    throw Error('Exact opt-in analysis service chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { ...prior, manifest, sources: [...prior.sources, ...extra] };
}
export async function analysisServiceFixture() {
  const base = await insightsFixture(),
    root = new pg.Client({
      connectionString: disposableTargets(process.env).app,
      connectionTimeoutMillis: 3000,
    }),
    pools: pg.Pool[] = [];
  let connected = false,
    created = false;
  async function cleanup() {
    try {
      await Promise.all(pools.map((p) => p.end()));
    } finally {
      try {
        await base.cleanup();
      } finally {
        if (connected) {
          try {
            if (created) await root.query('DROP ROLE tt_p2_analysis_service');
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
    if (
      (await root.query("SELECT 1 FROM pg_roles WHERE rolname='tt_p2_analysis_service'")).rowCount
    )
      throw Error('Owned analysis service role must be absent');
    const pw = randomBytes(32).toString('hex');
    await root.query(
      `CREATE ROLE tt_p2_analysis_service LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    );
    created = true;
    await root.query('GRANT CONNECT ON DATABASE tt_app_catalog TO tt_p2_analysis_service');
    await root.query(
      'GRANT tt_p2_ai_worker,tt_p2_ai_staff,tt_p2_ai_runtime TO tt_p2_analysis_service WITH INHERIT TRUE',
    );
    const analysisServiceApplied = await migrateApplication(
        base.target,
        analysisServiceSources().sources,
      ),
      u = new URL(base.target.url);
    u.username = 'tt_p2_analysis_service';
    u.password = pw;
    function analysisServiceAdapter() {
      const pool = new pg.Pool({
        connectionString: u.toString(),
        max: 2,
        connectionTimeoutMillis: 3000,
      });
      pools.push(pool);
      return createTransactions(pool, { transactionMs: 30000, statementMs: 15000, lockMs: 3000 });
    }
    return { ...base, cleanup, analysisServiceApplied, analysisServiceAdapter };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
