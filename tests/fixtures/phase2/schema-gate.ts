import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { photoImportSources, photoImportRoles } from './photo-import.ts';
import { privateFixture } from '../private/database.ts';
import { partnerSources, partnerRoles } from './partners.ts';
import { aiSources, aiRoles } from './ai.ts';
import { disposableTargets } from '../foundation/target.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';

export function schemaGateSources() {
  const directory = 'infra/database/phase-2-local/gate/';
  const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8')) as {
    kind: string;
    promoted: boolean;
    baseAppManifestSha256: string;
    priorLocalManifestSha256: string;
    priorLocalHead: string;
    migrations: { id: string; sha256: string }[];
    tables: string[];
  };
  const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const prior = photoImportSources(),
    ids = ['0043_schema_integrity'];
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha(readFileSync('infra/database/app/manifest.json')) ||
    manifest.priorLocalManifestSha256 !==
      sha(readFileSync('infra/database/phase-2-local/photo-import/manifest.json')) ||
    prior.sources.at(-1)?.id !== manifest.priorLocalHead ||
    JSON.stringify(manifest.migrations.map((m) => m.id)) !== JSON.stringify(ids) ||
    JSON.stringify(
      readdirSync(directory)
        .filter((f) => f.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(ids.map((id) => id + '.sql')) ||
    manifest.tables.length !== 0
  )
    throw Error('Local gate track requires exact prior sources');
  const extension = manifest.migrations.map((m) => ({
    ...m,
    source: readFileSync(directory + m.id + '.sql', 'utf8'),
  }));
  validateSources(extension);
  return { manifest, sources: [...prior.sources, ...extension] };
}

export const gateDatabases = {
  source: 'tt_app_catalog',
  fresh: 'tt_app_p2_gate_empty',
  restored: 'tt_app_p2_gate_restore',
  rollback: 'tt_app_p2_gate_rollback',
  replay: 'tt_app_p2_gate_replay',
} as const;
export type GateDatabase = keyof typeof gateDatabases;

export async function gateCatalog(c: pg.Client) {
  await c.query('SET search_path=pg_catalog');
  const schemas = ['app', 'partners', 'admin', 'privacy', 'email', 'analytics', 'migration_meta'];
  const relations = (
    await c.query(
      `SELECT n.nspname AS schema,c.relname,c.relkind,c.relowner::regrole::text AS owner,c.relrowsecurity,c.relforcerowsecurity,
 coalesce((SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee),'[]') AS acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('r','v','S') ORDER BY n.nspname,c.relname`,
      [schemas],
    )
  ).rows;
  const columns = (
    await c.query(
      `SELECT n.nspname,c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value,a.attacl::text
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname=ANY($1) AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`,
      [schemas],
    )
  ).rows;
  const constraints = (
    await c.query(
      `SELECT n.nspname,c.relname,CASE WHEN k.contype='n' THEN 'not_null_'||k.conkey::text ELSE k.conname END AS conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) AS definition
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) ORDER BY n.nspname,c.relname,conname`,
      [schemas],
    )
  ).rows;
  const indexes = (
    await c.query(
      `SELECT n.nspname,c.relname,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition
 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) ORDER BY n.nspname,c.relname,definition`,
      [schemas],
    )
  ).rows;
  const policies = (
    await c.query(
      `SELECT n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,ARRAY(SELECT r.rolname FROM pg_roles r WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname) AS roles,
 pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) ORDER BY n.nspname,c.relname,p.polname`,
      [schemas],
    )
  ).rows;
  const functions = (
    await c.query(
      `SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,p.proowner::regrole::text AS owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text,p.prosrc
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) ORDER BY n.nspname,p.proname,args`,
      [schemas],
    )
  ).rows;
  const triggers = (
    await c.query(
      `SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname`,
      [schemas],
    )
  ).rows;
  return { relations, columns, constraints, indexes, policies, functions, triggers };
}

const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function gateTables() {
  const p1 = JSON.parse(readFileSync('infra/database/s1-contract.json', 'utf8')) as {
    app: { tables: string[] };
  };
  return [
    ...p1.app.tables,
    ...partnerSources().manifest.tables,
    ...aiSources().manifest.tables,
    ...photoImportSources().manifest.tables,
  ].sort();
}
export async function schemaGateFixture() {
  const targets = disposableTargets(process.env),
    base = await privateFixture();
  const root = new pg.Client({
    connectionString: targets.app,
    connectionTimeoutMillis: 3000,
    statement_timeout: 15000,
  });
  const clients: pg.Client[] = [],
    created: Exclude<GateDatabase, 'source'>[] = [];
  const roles = [...partnerRoles, ...aiRoles, ...photoImportRoles],
    createdRoles: string[] = [],
    passwords = new Map<string, string>();
  let connected = false;
  const url = (database: GateDatabase, role = 'local_harness') => {
    if (!Object.hasOwn(gateDatabases, database)) throw Error('Unknown fixed gate target');
    if (
      role !== 'local_harness' &&
      !roles.includes(role as (typeof roles)[number]) &&
      !databaseRoles.app.includes(role as (typeof databaseRoles.app)[number])
    )
      throw Error('Unknown fixed gate actor');
    const u = new URL(
      role === 'local_harness' || passwords.has(role)
        ? targets.app
        : base.connectionUrl(role as (typeof databaseRoles.app)[number]),
    );
    if (passwords.has(role)) {
      u.username = role;
      u.password = passwords.get(role)!;
    }
    u.pathname = '/' + gateDatabases[database];
    return u.toString();
  };
  async function client(database: GateDatabase, role = 'local_harness') {
    const c = new pg.Client({
      connectionString: url(database, role),
      connectionTimeoutMillis: 3000,
      statement_timeout: 15000,
      lock_timeout: 3000,
    });
    await c.connect();
    clients.push(c);
    return c;
  }
  async function snapshot(c: pg.Client, prefix?: number) {
    const result = [];
    for (const table of gateTables()) {
      const [schema, name] = table.split('.') as [string, string];
      const exists = (await c.query('SELECT to_regclass($1) IS NOT NULL AS exists', [table]))
        .rows[0]!.exists;
      if (!exists) continue;
      const records = (
        await c.query(
          `SELECT to_jsonb(t) AS row FROM ${identifier(schema)}.${identifier(name)} t${table === 'migration_meta.applied' && prefix ? ' WHERE position<=' + prefix : ''} ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
      result.push({ table, count: records.length, digest: hash(records) });
    }
    return result;
  }
  async function cleanup() {
    try {
      await Promise.all(clients.map((c) => c.end()));
    } finally {
      try {
        if (connected)
          for (const database of [...created].reverse())
            await root.query('DROP DATABASE ' + identifier(gateDatabases[database]));
      } finally {
        try {
          await base.cleanup();
        } finally {
          try {
            if (connected)
              for (const role of createdRoles) await root.query('DROP ROLE ' + identifier(role));
          } finally {
            if (connected) await root.end();
          }
        }
      }
    }
  }
  try {
    await root.connect();
    connected = true;
    if (
      !(await root.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0]
        ?.rolsuper
    )
      throw Error('Owned disposable maintenance identity required');
    const bootstrapPasswords = Object.fromEntries(
      Object.values(databaseRoles)
        .flat()
        .map((role) => [role, randomBytes(32).toString('hex')]),
    ) as RolePasswords;
    for (const name of ['fresh', 'restored', 'rollback', 'replay'] as const) {
      if (
        (await root.query('SELECT 1 FROM pg_database WHERE datname=$1', [gateDatabases[name]]))
          .rowCount
      )
        throw Error('Gate requires absent fixed disposable targets');
      await root.query('CREATE DATABASE ' + identifier(gateDatabases[name]));
      created.push(name);
      await bootstrapDatabase(url(name), 'app', gateDatabases[name], bootstrapPasswords);
      for (const role of databaseRoles.app.slice(1))
        await root.query(
          `REVOKE CONNECT ON DATABASE ${identifier(gateDatabases[name])} FROM ${identifier(role)}`,
        );
    }
    if ((await root.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [roles])).rowCount)
      throw Error('Gate requires absent local P2 identities');
    for (const role of roles) {
      const password = randomBytes(32).toString('hex');
      await root.query(
        `CREATE ROLE ${identifier(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      passwords.set(role, password);
      createdRoles.push(role);
      await root.query(`GRANT CONNECT ON DATABASE tt_app_catalog TO ${identifier(role)}`);
    }
    const retainedOwner = await base.owner(),
      retainedReport = await base.report(retainedOwner.identity);
    const observer = await client('source');
    await observer.query('SET default_transaction_read_only=on');
    const p1Before = await snapshot(observer, 33);
    const registryBefore = (
      await observer.query(
        'SELECT to_jsonb(t) AS row FROM app.code_values t ORDER BY set_code,code',
      )
    ).rows;
    const archiveCommands = {
      p1: 'pg_dump --username=local_harness --format=custom --no-tablespaces --file=/tmp/tt_p2_gate_p1.dump tt_app_catalog',
      full: 'pg_dump --username=local_harness --format=custom --no-tablespaces --file=/tmp/tt_p2_gate_full.dump tt_app_catalog',
    } as const;
    // Fixed commands execute only as the owned disposable maintenance identity. No input URL,
    // credential, path or production executor is accepted. The container owns these temporary files.
    async function archive(kind: keyof typeof archiveCommands) {
      if (!Object.hasOwn(archiveCommands, kind)) throw Error('Unknown fixed gate archive');
      await root.query("COPY (SELECT 1 WHERE false) TO PROGRAM '" + archiveCommands[kind] + "'");
      return (
        await root.query('SELECT (pg_stat_file($1)).size::text AS bytes', [
          '/tmp/tt_p2_gate_' + kind + '.dump',
        ])
      ).rows[0]!.bytes as string;
    }
    async function restore(kind: 'p1' | 'full', replay = false) {
      if (
        (kind !== 'p1' && kind !== 'full') ||
        typeof replay !== 'boolean' ||
        (replay && kind !== 'full')
      )
        throw Error('Unknown fixed gate restore');
      const target = replay ? 'replay' : kind === 'p1' ? 'rollback' : 'restored';
      const c = await client(target);
      if (
        (
          await c.query(
            "SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')",
          )
        ).rowCount
      )
        throw Error('Gate restore requires its empty owned target');
      const command =
        'pg_restore --username=local_harness --no-tablespaces --exit-on-error --single-transaction --dbname=' +
        gateDatabases[target] +
        ' /tmp/tt_p2_gate_' +
        kind +
        '.dump';
      await root.query("COPY (SELECT 1 WHERE false) TO PROGRAM '" + command + "'");
      return c;
    }
    const p1ArchiveBytes = await archive('p1');
    const sourceTarget = {
      url: url('source', 'tt_app_migrator'),
      database: gateDatabases.source,
      kind: 'app' as const,
    };
    const appliedPartner = await migrateApplication(sourceTarget, partnerSources().sources);
    const organization = (
      await base.admin.query(
        "INSERT INTO partners.organizations(legal_name,market) VALUES('Gate retained partner','US') RETURNING id",
      )
    ).rows[0]!.id as string;
    await base.admin.query(
      "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,'gate-retained-actor','owner','active')",
      [organization],
    );
    const appliedAi = await migrateApplication(sourceTarget, aiSources().sources);
    await base.admin.query(
      "INSERT INTO app.ai_policy_versions(task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash) VALUES('photo_extraction','gate-synthetic','gate-v1','p1','s1','v1','local-jsonb-v1',$1)",
      [randomBytes(32).toString('hex')],
    );
    const appliedPhoto = await migrateApplication(sourceTarget, photoImportSources().sources);
    const appliedGate = await migrateApplication(sourceTarget, schemaGateSources().sources);
    const p1After = (await snapshot(observer, 33)).filter((r) =>
      p1Before.some((before) => before.table === r.table),
    );
    const registryAfter = (
      await observer.query(
        "SELECT to_jsonb(t) AS row FROM app.code_values t WHERE NOT(set_code='asset_purpose' AND code IN ('tire_photo_original','tire_photo_sanitized')) ORDER BY set_code,code",
      )
    ).rows;

    const fresh = await client('fresh', 'tt_app_migrator');
    const freshApplied = await migrateApplication(
      { url: url('fresh', 'tt_app_migrator'), database: gateDatabases.fresh, kind: 'app' },
      schemaGateSources().sources,
    );
    return {
      ...base,
      cleanup,
      gateRoot: root,
      gateClient: client,
      gateUrl: url,
      gateSnapshot: snapshot,
      observer,
      fresh,
      retainedOwner,
      retainedReport,
      organization,
      p1Before,
      p1After,
      registryBefore,
      registryAfter,
      p1ArchiveBytes,
      archive,
      restore,
      appliedPartner,
      appliedAi,
      appliedPhoto,
      appliedGate,
      freshApplied,
      grantGateConnect: async (database: Exclude<GateDatabase, 'source'>, role: string) => {
        if (!Object.hasOwn(gateDatabases, database) || database === ('source' as string))
          throw Error('Unknown fixed gate admission target');
        if (
          !roles.includes(role as (typeof roles)[number]) &&
          !databaseRoles.app.includes(role as (typeof databaseRoles.app)[number])
        )
          throw Error('Unknown fixed gate identity');
        await root.query(
          `GRANT CONNECT ON DATABASE ${identifier(gateDatabases[database])} TO ${identifier(role)}`,
        );
      },
      installFresh: () =>
        migrateApplication(
          { url: url('fresh', 'tt_app_migrator'), database: gateDatabases.fresh, kind: 'app' },
          schemaGateSources().sources,
        ),
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
