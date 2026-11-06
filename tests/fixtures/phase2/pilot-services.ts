import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { partnerServiceFixture, partnerServiceSources } from './partner-services.ts';
import { disposableTargets } from '../foundation/target.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
export function pilotSources() {
  const dir = 'infra/database/phase-2-local/pilot-services/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')),
    prior = partnerServiceSources();
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/reseller-services/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(
      readdirSync(dir)
        .filter((x) => x.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0047_pilot_services.sql'])
  )
    throw Error('Exact opt-in pilot chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { ...prior, manifest, sources: [...prior.sources, ...extra] };
}
export async function pilotFixture() {
  const base = await partnerServiceFixture(),
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
            if (created) await root.query('DROP ROLE tt_p2_pilot_service');
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
    const password = randomBytes(32).toString('hex');
    if ((await root.query("SELECT 1 FROM pg_roles WHERE rolname='tt_p2_pilot_service'")).rowCount)
      throw Error('Owned pilot role must be absent');
    await root.query(
      `CREATE ROLE tt_p2_pilot_service LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    );
    created = true;
    await root.query('GRANT CONNECT ON DATABASE tt_app_catalog TO tt_p2_pilot_service');
    await root.query('GRANT tt_p2_allocation_runtime TO tt_p2_pilot_service WITH INHERIT TRUE');
    const applied = await migrateApplication(base.target, pilotSources().sources);
    const u = new URL(base.target.url);
    u.username = 'tt_p2_pilot_service';
    u.password = password;
    function adapter() {
      const pool = new pg.Pool({
        connectionString: u.toString(),
        max: 2,
        connectionTimeoutMillis: 3000,
      });
      pools.push(pool);
      return createTransactions(pool, { transactionMs: 30000, statementMs: 15000, lockMs: 3000 });
    }
    const assetPool = new pg.Pool({
      connectionString: base.connectionUrl('tt_asset_runtime'),
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    pools.push(assetPool);
    return {
      ...base,
      cleanup,
      pilotApplied: applied,
      pilotAdapter: adapter,
      assetAdapter: createTransactions(assetPool),
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
