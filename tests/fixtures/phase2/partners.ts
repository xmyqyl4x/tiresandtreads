import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { privateFixture } from '../private/database.ts';
import { disposableTargets } from '../foundation/target.ts';
import { identifier } from '../../../scripts/database/bootstrap.ts';
import { loadSources, validateSources } from '../../../scripts/database/manifest.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';

export const partnerRoles = [
  'tt_p2_partner_runtime',
  'tt_p2_staff_runtime',
  'tt_p2_worker_runtime',
] as const;
export type PartnerRole = (typeof partnerRoles)[number];

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function partnerSources() {
  const directory = 'infra/database/phase-2-local/app/';
  const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8')) as {
    kind: string;
    promoted: boolean;
    baseAppManifestSha256: string;
    baseAppHead: string;
    migrations: { id: string; sha256: string }[];
    tables: string[];
  };
  const ids = ['0034_partner_identity', '0035_partner_offers', '0036_partner_history_insights'];
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha(readFileSync('infra/database/app/manifest.json')) ||
    loadSources('app').at(-1)?.id !== manifest.baseAppHead ||
    JSON.stringify(manifest.migrations.map((m) => m.id)) !== JSON.stringify(ids) ||
    JSON.stringify(
      readdirSync(directory)
        .filter((p) => p.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(ids.map((id) => id + '.sql'))
  )
    throw new Error('Local partner track requires its exact reviewed P1 base and sources');
  const extension = manifest.migrations.map((m) => ({
    ...m,
    source: readFileSync(directory + m.id + '.sql', 'utf8'),
  }));
  validateSources(extension);
  return { manifest, sources: [...loadSources('app'), ...extension] };
}

export async function partnerFixture() {
  const targets = disposableTargets(process.env);
  const base = await privateFixture();
  const control = new pg.Client({ connectionString: targets.app, connectionTimeoutMillis: 3000 });
  const clients: pg.Client[] = [];
  const created: PartnerRole[] = [];
  const passwords = new Map<PartnerRole, string>();
  let controlConnected = false;
  async function cleanup() {
    try {
      await Promise.all(clients.map((c) => c.end()));
    } finally {
      try {
        await base.cleanup();
      } finally {
        if (controlConnected) {
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
    controlConnected = true;
    const existing = await control.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)', [
      partnerRoles,
    ]);
    if (existing.rowCount) throw new Error('Local partner fixture requires absent owned roles');
    for (const role of partnerRoles) {
      const password = randomBytes(32).toString('hex');
      await control.query(
        `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      created.push(role);
      passwords.set(role, password);
      await control.query(`GRANT CONNECT ON DATABASE tt_app_catalog TO ${identifier(role)}`);
    }
    const retainedOwner = await base.owner();
    const retainedReport = await base.report(retainedOwner.identity);
    const p1Tables = (
      JSON.parse(readFileSync('infra/database/s1-contract.json', 'utf8')) as {
        app: { tables: string[] };
      }
    ).app.tables;
    async function p1Snapshot() {
      const rows: { name: string; digest: string; count: number }[] = [];
      // Fail instead of silently hashing filtered rows if a future P1 RLS policy applies.
      await base.admin.query('SET row_security=off');
      try {
        for (const name of p1Tables) {
          const pieces = name.split('.');
          if (pieces.length !== 2) throw new Error('Invalid fixed P1 table inventory');
          const values = await base.admin.query(
            `SELECT to_jsonb(t) AS row FROM ${identifier(pieces[0]!)}.${identifier(pieces[1]!)} t${name === 'migration_meta.applied' ? ' WHERE t.position <= $1' : ''} ORDER BY to_jsonb(t)::text`,
            name === 'migration_meta.applied' ? [loadSources('app').length] : [],
          );
          rows.push({
            name,
            digest: sha(JSON.stringify(values.rows)),
            count: values.rowCount ?? 0,
          });
        }
      } finally {
        await base.admin.query('SET row_security=on');
      }
      return rows;
    }
    async function p1Permissions() {
      return (
        await base.admin.query(
          `SELECT n.nspname,c.relname,c.relacl::text,c.relowner::regrole::text FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=ANY($1) AND c.relkind IN ('r','v') ORDER BY n.nspname,c.relname`,
          [['app', 'admin', 'privacy', 'email', 'analytics', 'migration_meta']],
        )
      ).rows;
    }
    const before = await p1Snapshot();
    const beforePermissions = await p1Permissions();
    const beforeHistory = (
      await base.admin.query(
        'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position',
      )
    ).rows;
    const url = base.connectionUrl('tt_app_migrator');
    const target = { url, database: 'tt_app_catalog', kind: 'app' as const };
    const install = () => migrateApplication(target, partnerSources().sources);
    const applied = await install();
    const after = await p1Snapshot();
    const afterPermissions = await p1Permissions();
    async function connect(role: PartnerRole) {
      const u = new URL(url);
      u.username = role;
      u.password = passwords.get(role)!;
      const client = new pg.Client({
        connectionString: u.toString(),
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
      connect,
      install,
      target,
      applied,
      before,
      after,
      beforePermissions,
      afterPermissions,
      beforeHistory,
      retainedReport,
      ownerIdentity: retainedOwner.identity,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
