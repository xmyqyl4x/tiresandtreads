import pg from 'pg';
import { readFileSync } from 'node:fs';
import { context, publicPlan, settings } from '../multitarget-coordination/transport.ts';
import { lifecycleCatalog, lifecycleDatabaseAcl } from '../lifecycle-validation/reader.ts';
import { snapshot } from '../tls-admission/snapshot.ts';
import { digest, must } from '../tls-admission/contract.ts';
import { within } from '../io-inspection/budget.ts';
import { databaseRoles } from '../../../packages/config/src/database-roles.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { schemaInventory } from '../../../scripts/database/inventory.ts';
import {
  admitBaseline,
  articleId,
  subjectId,
  versionId,
  compare,
  flags,
  type Observation,
} from './contract.ts';

// Fixed queries only. No URL, SQL, baseline, callback, repair or phase argument.
// This separate populated observer deliberately does not replace snapshot().
export async function capture(
  db: pg.Client,
  slot: number,
  kind: 'app' | 'cms',
): Promise<Observation> {
  const catalog = await lifecycleCatalog(db);
  must(Buffer.byteLength(JSON.stringify(catalog)) <= 2_000_000);
  const relations = (await schemaInventory(db)).relations ?? [];
  const tables = relations.filter((r) => r.kind === 'r' || r.kind === 'p');
  must(tables.length > 0 && tables.length <= 200);
  const rows: Record<string, unknown> = {};
  for (const table of tables) {
    const name = String(table.name);
    must(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name));
    const qualified = name
      .split('.')
      .map((x) => '"' + x + '"')
      .join('.');
    // Trusted generated fixture only. Refuse row/byte overflow, never truncate evidence.
    const data = (await db.query(`SELECT to_jsonb(t) AS row FROM ${qualified} t LIMIT 1001`)).rows;
    must(data.length <= 1000 && Buffer.byteLength(JSON.stringify(data)) <= 1_000_000);
    rows[name] = data.map((r) => JSON.stringify(r.row)).sort();
  }
  must(Buffer.byteLength(JSON.stringify(rows)) <= 2_000_000);
  const history = (
    await db.query(
      'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position LIMIT 101',
    )
  ).rows;
  const expected = loadSources(kind).map(({ id, sha256 }, i) => ({ position: i + 1, id, sha256 }));
  const native =
    kind === 'cms'
      ? (await db.query('SELECT name,batch FROM public.payload_migrations ORDER BY name LIMIT 101'))
          .rows
      : [];
  const historiesValid =
    digest(history) === digest(expected) &&
    (kind !== 'cms' ||
      (digest(native.map((r) => r.name)) === digest(expected.map((r) => r.id)) &&
        native.every((r) => r.batch > 0)));
  const seed =
    kind === 'app'
      ? (await db.query('SELECT id,kind,status FROM app.subjects WHERE id=$1', [subjectId])).rows
      : (await db.query('SELECT id,title FROM public.articles WHERE id=$1', [articleId])).rows;
  const version =
    kind === 'cms'
      ? (
          await db.query('SELECT id,parent_id,version_title FROM public._articles_v WHERE id=$1', [
            versionId,
          ])
        ).rows
      : [];
  const populated =
    seed.length === 1 &&
    (kind === 'app'
      ? seed[0].kind === 'guest' && seed[0].status === 'restricted'
      : seed[0].title === 'Synthetic preserved article' &&
        version.length === 1 &&
        version[0].parent_id === articleId &&
        version[0].version_title === 'Synthetic prior revision');
  const roles = Object.values(databaseRoles).flat();
  const security = {
    acl: await lifecycleDatabaseAcl(db),
    roles: (
      await db.query(
        `SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolcanlogin,
      has_database_privilege(oid,current_database(),'CONNECT') AS connect FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname`,
        [roles],
      )
    ).rows,
    memberships: (
      await db.query(
        'SELECT m.roleid::regrole::text AS role,m.member::regrole::text AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m WHERE m.roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1)) OR m.member IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1)) ORDER BY role,member',
        [roles],
      )
    ).rows,
    settings: (
      await db.query(
        'SELECT r.rolname,d.datname,s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE r.rolname=ANY($1) ORDER BY r.rolname,d.datname',
        [roles],
      )
    ).rows,
  };
  const owner = `tt_${kind}_migrator`;
  const quarantined =
    security.roles.length === 19 &&
    security.memberships.length === 0 &&
    security.roles.every(
      (r) =>
        !r.rolsuper &&
        !r.rolcreatedb &&
        !r.rolcreaterole &&
        !r.rolreplication &&
        !r.rolbypassrls &&
        !r.rolinherit &&
        r.rolcanlogin &&
        r.connect === (r.rolname === owner),
    );
  const sequences = (
    await db.query(
      "SELECT schemaname,sequencename,sequenceowner,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema' ORDER BY schemaname,sequencename LIMIT 201",
    )
  ).rows;
  must(sequences.length <= 200);
  return {
    slot,
    kind,
    catalog: digest(catalog),
    rows: digest(rows),
    sequences: digest(sequences),
    security: digest(security),
    history: digest({ history, native }),
    populated,
    historiesValid,
    quarantined,
    tables: tables.length,
  };
}

async function inspectEndpoint(
  slot: number,
  kind: 'app' | 'cms',
  mode: 'capture' | 'foundation' | 'write-denial',
) {
  const c = context(publicPlan());
  const db = new pg.Client(settings(c, slot, kind, 'tt-populated-readonly'));
  db.on('error', () => {});
  let endObserved = false;
  db.once('end', () => {
    endObserved = true;
  });
  const start = performance.now();
  try {
    await db.connect();
    await db.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL transaction_timeout='5s'",
    );
    const facts = (
      await db.query(
        "SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    must(
      facts.actor === `tt_${kind}_migrator` &&
        facts.session_actor === facts.actor &&
        facts.owner === facts.actor &&
        facts.database === `tt_${kind}_recovery` &&
        facts.version === 180006 &&
        facts.readonly === 'on' &&
        facts.isolation === 'repeatable read' &&
        facts.tls === true,
    );
    if (mode === 'foundation') {
      // Real old reader must still refuse this new phase. A throw is checked by the test.
      return await snapshot(db, facts.actor);
    }
    if (mode === 'write-denial') {
      // A permanent-table UPDATE is used: TEMP DDL is permitted by PostgreSQL READ ONLY.
      await db.query(
        kind === 'app'
          ? "UPDATE app.subjects SET status='active' WHERE false"
          : "UPDATE public.articles SET title='forbidden' WHERE false",
      );
      return 'unexpected-write-success';
    }
    const result = await capture(db, slot, kind);
    await db.query('ROLLBACK');
    must(performance.now() - start < 6000);
    return result;
  } finally {
    // A failed observation never returns a successful receipt; end is a separate fact.
    await within(db.end(), 750);
    must(endObserved);
  }
}
export async function observe() {
  const c = context(publicPlan());
  const baseline = admitBaseline(
    readFileSync('/populated/baseline.json', 'utf8'),
    c.project,
    c.generation,
  );
  const observations: Observation[] = [];
  for (const e of c.endpoints)
    observations.push((await inspectEndpoint(e.slot, e.kind, 'capture')) as Observation);
  const findings = compare(baseline, observations);
  return { compatible: findings.length === 0, findings, observations, ...flags };
}
export async function audit() {
  const c = context(publicPlan());
  const expected = JSON.parse(readFileSync('/populated/pre-observation.json', 'utf8'));
  const observations: Observation[] = [];
  for (const e of c.endpoints)
    observations.push((await inspectEndpoint(e.slot, e.kind, 'capture')) as Observation);
  must(digest(expected) === digest(observations));
  return { fourEndpointParity: true, readOnly: true, ...flags };
}
export const foundationRefusal = (slot: number, kind: 'app' | 'cms') =>
  inspectEndpoint(slot, kind, 'foundation');
export const writeDenial = (slot: number, kind: 'app' | 'cms') =>
  inspectEndpoint(slot, kind, 'write-denial');
