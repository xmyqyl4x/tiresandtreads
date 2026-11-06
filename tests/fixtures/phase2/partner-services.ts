import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { analysisRepositoryFixture, analysisRepositorySources } from './analysis-repositories.ts';
import { disposableTargets } from '../foundation/target.ts';
import { identifier } from '../../../scripts/database/bootstrap.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
export const partnerServiceRoles = ['tt_p2_partner_service', 'tt_p2_coupon_worker'] as const;
export async function partnerServiceFixture() {
  const base = await analysisRepositoryFixture(),
    root = new pg.Client({
      connectionString: disposableTargets(process.env).app,
      connectionTimeoutMillis: 3000,
    }),
    pools: pg.Pool[] = [],
    passwords = new Map<string, string>(),
    created = new Set<string>();
  let connected = false;
  async function cleanup() {
    try {
      await Promise.all(pools.map((p) => p.end()));
    } finally {
      try {
        await base.cleanup();
      } finally {
        if (connected) {
          try {
            for (const role of created) await root.query('DROP ROLE ' + identifier(role));
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
    for (const role of partnerServiceRoles) {
      if ((await root.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
        throw Error('Owned role must be absent');
      const pw = randomBytes(32).toString('hex');
      await root.query(
        `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      created.add(role);
      passwords.set(role, pw);
      await root.query('GRANT CONNECT ON DATABASE tt_app_catalog TO ' + identifier(role));
    }
    await root.query(
      'GRANT tt_p2_identity_writer,tt_p2_offer_writer TO tt_p2_partner_service WITH INHERIT TRUE',
    );
    const serviceApplied = await migrateApplication(base.target, partnerServiceSources().sources);
    function servicePool(role: (typeof partnerServiceRoles)[number], max = 2) {
      if (!partnerServiceRoles.includes(role) || !Number.isInteger(max) || max < 1 || max > 4)
        throw Error('Fixed actor/bounded pool required');
      const u = new URL(base.target.url);
      u.username = role;
      u.password = passwords.get(role)!;
      const p = new pg.Pool({ connectionString: u.toString(), max, connectionTimeoutMillis: 3000 });
      pools.push(p);
      return p;
    }
    const serviceAdapter = (role: (typeof partnerServiceRoles)[number]) =>
      createTransactions(servicePool(role), {
        transactionMs: 30000,
        statementMs: 15000,
        lockMs: 3000,
      });
    return { ...base, cleanup, servicePool, serviceAdapter, serviceApplied };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
export function partnerServiceSources() {
  const dir = 'infra/database/phase-2-local/reseller-services/',
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
  const prior = analysisRepositorySources(),
    ids = ['0046_reseller_service_support'];
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/analysis-repositories/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)?.id ||
    JSON.stringify(manifest.migrations.map((x) => x.id)) !== JSON.stringify(ids) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((x) => x.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(ids.map((x) => x + '.sql'))
  )
    throw Error('Exact local service source chain required');
  const extra = manifest.migrations.map((x) => ({
    ...x,
    source: readFileSync(dir + x.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { manifest, sources: [...prior.sources, ...extra] };
}
