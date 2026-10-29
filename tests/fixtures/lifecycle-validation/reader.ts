import pg from 'pg';
import { X509Certificate } from 'node:crypto';
import { databaseRoles } from '../../../packages/config/src/database-roles.ts';
import { schemaInventory, digest } from '../../../scripts/database/inventory.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import versions from '../../../infra/local/versions.json' with { type: 'json' };

// Disposable test support only. No production entry point imports this prototype.
export const lifecyclePhases = ['foundation', 'migrated', 'quarantined-recovery'] as const;
export type LifecyclePhase = (typeof lifecyclePhases)[number];
export type LifecycleTarget = 'app' | 'cms';
export const lifecycleDatabases = {
  app: 'tt_app_lifecycle_probe',
  cms: 'tt_cms_lifecycle_probe',
} as const;
const scopedRoles = Object.values(databaseRoles).flat();
const namespaces = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";

export function readLifecycleRequest(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
) {
  try {
    if (
      env.APP_ENV !== 'test-local' ||
      env.PROVIDER_MODE !== 'fixtures' ||
      !/^tt-test-[a-f0-9]{16}$/.test(env.ISOLATED_TEST_PROJECT ?? '')
    )
      throw Error();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error();
    const r = input as Record<string, unknown>;
    if (
      Object.keys(r).length !== 5 ||
      Object.keys(r).some((k) => !['mode', 'phase', 'target', 'url', 'ca'].includes(k))
    )
      throw Error();
    // Five fields are accepted; no caller-provided SQL, expected catalog, history or repair mode.
    if (
      r.mode !== 'local-lifecycle-proof' ||
      !lifecyclePhases.includes(r.phase as LifecyclePhase) ||
      !['app', 'cms'].includes(r.target as string) ||
      typeof r.url !== 'string' ||
      r.url.length > 4096 ||
      typeof r.ca !== 'string' ||
      r.ca.length < 1 ||
      r.ca.length > 65536
    )
      throw Error();
    const target = r.target as LifecycleTarget,
      phase = r.phase as LifecyclePhase,
      u = new URL(r.url);
    if (
      u.protocol !== 'postgresql:' ||
      !['postgres.preflight.test', 'postgres.mismatch.preflight.test'].includes(u.hostname) ||
      u.port !== '5432' ||
      decodeURIComponent(u.username) !== databaseRoles[target][0] ||
      !/^[a-f0-9]{64}$/.test(decodeURIComponent(u.password)) ||
      u.pathname !== '/' + lifecycleDatabases[target] ||
      u.search ||
      u.hash
    )
      throw Error();
    return {
      target,
      phase,
      project: env.ISOLATED_TEST_PROJECT!,
      database: lifecycleDatabases[target],
      url: u.toString(),
      connection: {
        host: u.hostname,
        port: 5432,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: lifecycleDatabases[target],
        ssl: { ca: r.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
        statement_timeout: 1000,
        lock_timeout: 250,
        idle_in_transaction_session_timeout: 1000,
        application_name: 'tt-lifecycle-proof:' + target,
        options: '-c search_path=pg_catalog -c default_transaction_read_only=on',
      },
    };
  } catch {
    throw Error('Invalid disposable lifecycle request');
  }
}
type Settings = ReturnType<typeof readLifecycleRequest>;

// The inspector below supplies only fixed catalog queries. The exported wrapper also lets
// tests demonstrate real PostgreSQL write refusal and timeout cleanup, without input SQL.
export async function withReadOnlyLifecycle<T>(
  s: Settings,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  // Re-admit at the connection boundary; typed test settings are not authority.
  const admitted = readLifecycleRequest(
    {
      mode: 'local-lifecycle-proof',
      phase: s.phase,
      target: s.target,
      url: s.url,
      ca: s.connection.ssl.ca,
    },
    process.env,
  );
  if (admitted.project !== s.project) throw Error('Disposable lifecycle project changed');
  const ca = new X509Certificate(admitted.connection.ssl.ca);
  if (!ca.ca || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) <= Date.now())
    throw Error('Invalid disposable TLS authority');
  const client = new pg.Client(admitted.connection);
  client.on('error', () => {});
  let begun = false;
  try {
    await client.connect();
    await client.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='1s'; SET LOCAL lock_timeout='250ms'; SET LOCAL idle_in_transaction_session_timeout='1s'; SET LOCAL transaction_timeout='5s'",
    );
    begun = true;
    return await work(client);
  } finally {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

export function lifecycleSourceDigest() {
  return digest(
    ['app', 'cms'].map((t) =>
      loadSources(t as LifecycleTarget).map(({ id, sha256 }) => ({ id, sha256 })),
    ),
  );
}

export async function lifecycleCatalog(client: pg.Client) {
  const raw = await schemaInventory(client);
  // ACL array display order is not permission state. Compare expanded semantic entries below.
  const inventory = Object.fromEntries(
    Object.entries(raw)
      .filter(([key]) => key !== 'defaults')
      .map(([key, rows]) => [
        key,
        rows.map((row) =>
          Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'acl')),
        ),
      ]),
  );
  const schemaNames = (
    await client.query(
      `SELECT n.nspname AS name,pg_get_userbyid(n.nspowner) AS owner FROM pg_namespace n WHERE ${namespaces} ORDER BY name`,
    )
  ).rows;
  const acls = (
    await client.query(`WITH objects AS (
    SELECT 'schema' AS kind,n.nspname AS name,COALESCE(n.nspacl,acldefault('n',n.nspowner)) AS acl FROM pg_namespace n WHERE ${namespaces}
    UNION ALL SELECT 'relation',n.nspname||'.'||c.relname,COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${namespaces} AND c.relkind IN ('r','p','v','m','S','f')
    UNION ALL SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${namespaces} AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
    UNION ALL SELECT 'routine',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',COALESCE(p.proacl,acldefault('f',p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${namespaces}
    UNION ALL SELECT 'type',n.nspname||'.'||t.typname,COALESCE(t.typacl,acldefault('T',t.typowner)) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${namespaces})
    SELECT o.kind,o.name,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable FROM objects o LEFT JOIN LATERAL aclexplode(o.acl) a ON true ORDER BY o.kind,o.name,grantee,grantor,a.privilege_type,a.is_grantable`)
  ).rows;
  const defaults = (
    await client.query(
      `SELECT pg_get_userbyid(d.defaclrole) AS owner,COALESCE(n.nspname,'*') AS schema,d.defaclobjtype AS kind,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace LEFT JOIN LATERAL aclexplode(d.defaclacl) a ON true ORDER BY owner,schema,kind,grantee,grantor,a.privilege_type,a.is_grantable`,
    )
  ).rows;
  const policies = (
    await client.query(
      `SELECT n.nspname||'.'||c.relname AS relation,p.polname,p.polcmd,p.polpermissive,ARRAY(SELECT CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END FROM unnest(p.polroles) x ORDER BY 1) AS roles,pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${namespaces} ORDER BY relation,p.polname`,
    )
  ).rows;
  const types = (
    await client.query(
      `SELECT n.nspname||'.'||t.typname AS name,pg_get_userbyid(t.typowner) AS owner,t.typtype,t.typcategory FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${namespaces} ORDER BY name`,
    )
  ).rows;
  return { inventory, schemaNames, acls, defaults, policies, types };
}
export async function lifecycleDatabaseAcl(client: pg.Client) {
  return (
    await client.query(
      "SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() ORDER BY grantee,grantor,a.privilege_type,a.is_grantable",
    )
  ).rows;
}
export interface LifecycleBaseline {
  readonly project: string;
  readonly sourceDigest: string;
  readonly foundation: Readonly<Record<LifecycleTarget, string>>;
  readonly migrated?: Readonly<Record<LifecycleTarget, string>>;
  readonly databaseAcls: Readonly<
    Record<LifecycleTarget, Readonly<Record<LifecyclePhase, string>>>
  >;
}
type Finding =
  | 'identity'
  | 'tls'
  | 'version'
  | 'database_owner'
  | 'role_capabilities'
  | 'role_memberships'
  | 'role_settings'
  | 'database_acl'
  | 'schema_inventory'
  | 'default_privileges'
  | 'runtime_admission'
  | 'migrations'
  | 'cms_history'
  | 'phase_state'
  | 'object_state';
interface Report {
  scope: 'disposable-local-lifecycle';
  status: 'configuration' | 'unavailable' | 'compatible' | 'incompatible';
  compatible: boolean;
  findings: Finding[];
  hostedAccepted: false;
  productActivation: false;
  phase?: LifecyclePhase;
  target?: LifecycleTarget;
  checks?: {
    readOnly: boolean;
    tls: boolean;
    serverVersion: number;
    scopedRoles: number;
    memberships: number;
    migrations: number;
  };
}

export async function inspectLifecycle(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
  baseline: LifecycleBaseline,
): Promise<Report> {
  const failed = (status: 'configuration' | 'unavailable'): Report => ({
    scope: 'disposable-local-lifecycle',
    status,
    compatible: false,
    findings: [],
    hostedAccepted: false,
    productActivation: false,
  });
  let s: Settings;
  try {
    s = readLifecycleRequest(input, env);
    if (baseline.project !== s.project || baseline.sourceDigest !== lifecycleSourceDigest())
      throw Error();
  } catch {
    return failed('configuration');
  }
  try {
    return await withReadOnlyLifecycle(s, async (client) => {
      const owner = databaseRoles[s.target][0];
      const state = (
        await client.query(
          "SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()",
        )
      ).rows[0];
      const roles = (
        await client.query(
          `SELECT r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit,r.rolcanlogin,
        has_database_privilege(r.oid,CASE WHEN r.rolname=ANY($2) THEN $3 ELSE $4 END,'CONNECT') AS connect,
        has_database_privilege(r.oid,CASE WHEN r.rolname=ANY($2) THEN $3 ELSE $4 END,'CREATE') AS create_db,
        has_database_privilege(r.oid,CASE WHEN r.rolname=ANY($2) THEN $3 ELSE $4 END,'TEMP') AS temp,
        has_database_privilege(r.oid,CASE WHEN r.rolname=ANY($2) THEN $4 ELSE $3 END,'CONNECT') AS peer_connect
        FROM pg_roles r WHERE r.rolname=ANY($1) ORDER BY r.rolname`,
          [scopedRoles, databaseRoles.app, lifecycleDatabases.app, lifecycleDatabases.cms],
        )
      ).rows;
      const memberships = (
        await client.query(
          'SELECT m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname=ANY($1) OR u.rolname=ANY($1)',
          [scopedRoles],
        )
      ).rows;
      const settings = (
        await client.query(
          'SELECT r.rolname AS role,d.datname AS database,ARRAY(SELECT x FROM unnest(s.setconfig) x ORDER BY x COLLATE "C") AS config FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE r.rolname=ANY($1) ORDER BY r.rolname COLLATE "C",d.datname COLLATE "C"',
          [scopedRoles],
        )
      ).rows;
      const expectedSettings = scopedRoles
        .slice()
        .sort()
        .map((role) => {
          const target: LifecycleTarget = (databaseRoles.app as readonly string[]).includes(role)
            ? 'app'
            : 'cms';
          return {
            role,
            database: lifecycleDatabases[target],
            config: [
              'idle_in_transaction_session_timeout=10s',
              'lock_timeout=3s',
              'search_path=' +
                (role === databaseRoles[target][0] ? 'public, pg_catalog' : 'pg_catalog, public'),
              'statement_timeout=15s',
            ].sort(),
          };
        });
      const catalog = await lifecycleCatalog(client),
        dbAcl = await lifecycleDatabaseAcl(client);
      const exists = (
        await client.query(
          "SELECT to_regclass('migration_meta.applied') IS NOT NULL AS history,to_regclass('public.payload_migrations') IS NOT NULL AS cms",
        )
      ).rows[0];
      const history = exists.history
        ? (
            await client.query(
              'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position LIMIT 1001',
            )
          ).rows
        : [];
      const native =
        s.target === 'cms' && exists.cms
          ? (
              await client.query(
                'SELECT name,batch FROM public.payload_migrations ORDER BY name LIMIT 1001',
              )
            ).rows
          : [];
      const defaults = (
        await client.query(
          `SELECT count(*)::int AS public_grants FROM (VALUES ('f'::"char"),('T'::"char")) k(kind) CROSS JOIN LATERAL aclexplode(COALESCE((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname=$1) AND defaclnamespace=0 AND defaclobjtype=k.kind),acldefault(k.kind,(SELECT oid FROM pg_roles WHERE rolname=$1)))) a WHERE a.grantee=0`,
          [owner],
        )
      ).rows[0];
      const findings: Finding[] = [];
      const add = (bad: boolean, finding: Finding) => {
        if (bad) findings.push(finding);
      };
      const [major, minor] = versions.postgres.split('.').map(Number);
      add(
        state.actor !== owner ||
          state.session_actor !== owner ||
          state.database !== s.database ||
          state.readonly !== 'on' ||
          state.isolation !== 'repeatable read',
        'identity',
      );
      add(state.tls !== true, 'tls');
      add(state.version !== major! * 10000 + minor!, 'version');
      add(state.owner !== owner, 'database_owner');
      add(
        roles.length !== 19 ||
          roles.some(
            (r) =>
              r.rolsuper ||
              r.rolcreatedb ||
              r.rolcreaterole ||
              r.rolreplication ||
              r.rolbypassrls ||
              r.rolinherit ||
              !r.rolcanlogin,
          ),
        'role_capabilities',
      );
      add(memberships.length !== 0, 'role_memberships');
      add(digest(settings) !== digest(expectedSettings), 'role_settings');
      add(digest(dbAcl) !== baseline.databaseAcls[s.target][s.phase], 'database_acl');
      const expectedCatalog =
        s.phase === 'foundation' ? baseline.foundation[s.target] : baseline.migrated?.[s.target];
      add(!expectedCatalog || digest(catalog) !== expectedCatalog, 'schema_inventory');
      add(defaults.public_grants !== 0, 'default_privileges');
      add(
        roles.some((r) => {
          const isOwner = ['tt_app_migrator', 'tt_cms_migrator'].includes(r.rolname);
          return (
            r.connect !== (isOwner || s.phase !== 'quarantined-recovery') ||
            r.create_db !== isOwner ||
            r.temp !== isOwner ||
            r.peer_connect !== false
          );
        }),
        'runtime_admission',
      );
      const expectedHistory = s.phase === 'foundation' ? [] : loadSources(s.target);
      add(
        history.length !== expectedHistory.length ||
          history.some(
            (r, i) =>
              r.position !== i + 1 ||
              r.id !== expectedHistory[i]?.id ||
              r.sha256 !== expectedHistory[i]?.sha256,
          ),
        'migrations',
      );
      add(
        s.phase === 'foundation'
          ? exists.history || exists.cms
          : !exists.history || (s.target === 'cms' && !exists.cms),
        'phase_state',
      );
      add(
        s.target === 'cms' &&
          (native.length !== expectedHistory.length ||
            native.some((r, i) => r.name !== expectedHistory[i]?.id || r.batch < 0)),
        'cms_history',
      );
      add(
        (catalog.inventory.constraints ?? []).some((r) => !r.validated) ||
          (catalog.inventory.indexes ?? []).some((r) => !r.valid || !r.ready) ||
          (catalog.inventory.triggers ?? []).some((r) => r.enabled !== 'O'),
        'object_state',
      );
      return {
        scope: 'disposable-local-lifecycle',
        status: findings.length ? 'incompatible' : 'compatible',
        compatible: !findings.length,
        findings,
        hostedAccepted: false,
        productActivation: false,
        phase: s.phase,
        target: s.target,
        checks: {
          readOnly: state.readonly === 'on',
          tls: state.tls === true,
          serverVersion: state.version,
          scopedRoles: roles.length,
          memberships: memberships.length,
          migrations: history.length,
        },
      };
    });
  } catch {
    return failed('unavailable');
  }
}
