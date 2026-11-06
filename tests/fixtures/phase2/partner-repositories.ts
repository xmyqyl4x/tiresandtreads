import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { photoImportFixture } from './photo-import.ts';
import { schemaGateSources } from './schema-gate.ts';
import { disposableTargets } from '../foundation/target.ts';
import { identifier } from '../../../scripts/database/bootstrap.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
export const partnerRepositoryRoles = [
  'tt_p2_identity_writer',
  'tt_p2_offer_writer',
  'tt_p2_allocation_runtime',
  'tt_p2_pilot_reader',
] as const;
export type PartnerRepositoryRole = (typeof partnerRepositoryRoles)[number];
export function partnerRepositorySources() {
  const directory = 'infra/database/phase-2-local/repositories/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8')) as {
    kind: string;
    promoted: boolean;
    baseAppManifestSha256: string;
    priorLocalManifestSha256: string;
    priorLocalHead: string;
    migrations: { id: string; sha256: string }[];
    tables: string[];
  };
  const prior = schemaGateSources(),
    ids = ['0044_partner_repository_support'];
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !== sha('infra/database/phase-2-local/gate/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)?.id ||
    JSON.stringify(manifest.migrations.map((x) => x.id)) !== JSON.stringify(ids) ||
    JSON.stringify(
      readdirSync(directory)
        .filter((p) => p.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(ids.map((id) => id + '.sql'))
  )
    throw Error('Local repository support requires exact prior sources');
  const extra = manifest.migrations.map((m) => ({
    ...m,
    source: readFileSync(directory + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { manifest, sources: [...prior.sources, ...extra] };
}
export async function partnerRepositoryFixture() {
  const targets = disposableTargets(process.env),
    base = await photoImportFixture(),
    root = new pg.Client({ connectionString: targets.app, connectionTimeoutMillis: 3000 });
  const passwords = new Map<string, string>(),
    created: string[] = [],
    pools: pg.Pool[] = [];
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
    if (
      (await root.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [partnerRepositoryRoles]))
        .rowCount
    )
      throw Error('Repository fixture requires absent owned roles');
    for (const role of partnerRepositoryRoles) {
      const password = randomBytes(32).toString('hex');
      await root.query(
        `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      created.push(role);
      passwords.set(role, password);
      await root.query('GRANT CONNECT ON DATABASE tt_app_catalog TO ' + identifier(role));
    }
    const applied = await migrateApplication(base.target, partnerRepositorySources().sources);
    function pool(role: PartnerRepositoryRole, max = 2) {
      if (!partnerRepositoryRoles.includes(role) || !Number.isInteger(max) || max < 1 || max > 4)
        throw Error('Unknown fixed repository actor');
      const url = new URL(base.target.url);
      url.username = role;
      url.password = passwords.get(role)!;
      const p = new pg.Pool({
        connectionString: url.toString(),
        max,
        connectionTimeoutMillis: 3000,
      });
      pools.push(p);
      return p;
    }
    const adapter = (role: PartnerRepositoryRole, max = 2) =>
      createTransactions(pool(role, max), {
        transactionMs: 15000,
        statementMs: 8000,
        lockMs: 3000,
      });
    async function waitingAllocators() {
      return (
        (
          await root.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname='tt_app_catalog' AND usename='tt_p2_allocation_runtime' AND wait_event_type='Lock' AND query LIKE 'SELECT id,kind,limit_units%' LIMIT 1",
          )
        ).rowCount === 1
      );
    }
    return { ...base, cleanup, pool, adapter, waitingAllocators, repositoryApplied: applied };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
