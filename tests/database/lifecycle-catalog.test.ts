import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { catalogFixture } from '../fixtures/lifecycle-catalog/database.ts';
import { disposableTargets } from '../fixtures/foundation/target.ts';
import { databaseRoles } from '../../packages/config/src/database-roles.ts';
import { lifecycleDatabases } from '../fixtures/lifecycle-validation/reader.ts';

type Fixture = Awaited<ReturnType<typeof catalogFixture>>;
type Target = 'app' | 'cms';
const targets = ['app', 'cms'] as const;
const grantors = ['catalog_probe_grantor_a', 'catalog_probe_grantor_b'] as const;
const flags = [
  ['SUPERUSER', 'NOSUPERUSER', 'rolsuper', true],
  ['CREATEDB', 'NOCREATEDB', 'rolcreatedb', true],
  ['CREATEROLE', 'NOCREATEROLE', 'rolcreaterole', true],
  ['REPLICATION', 'NOREPLICATION', 'rolreplication', true],
  ['BYPASSRLS', 'NOBYPASSRLS', 'rolbypassrls', true],
  ['INHERIT', 'NOINHERIT', 'rolinherit', true],
  ['NOLOGIN', 'LOGIN', 'rolcanlogin', false],
] as const;

it.each([...grantors, 'catalog_probe_owner_sink'])(
  'refuses a pre-existing %s without adopting or deleting it',
  async (role) => {
    const target = disposableTargets(process.env);
    const root = new pg.Client({ connectionString: target.app, connectionTimeoutMillis: 1500 });
    let created = false;
    try {
      await root.connect();
      expect((await root.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount).toBe(
        0,
      );
      await root.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
      created = true;
      const before = (
        await root.query(
          'SELECT rolname,rolcanlogin,rolinherit,rolsuper FROM pg_roles WHERE rolname=$1',
          [role],
        )
      ).rows;
      await expect(catalogFixture('foundation')).rejects.toThrow(
        'refuses pre-existing probe grantors',
      );
      expect(
        (
          await root.query(
            'SELECT rolname,rolcanlogin,rolinherit,rolsuper FROM pg_roles WHERE rolname=$1',
            [role],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await root.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [
            Object.values(databaseRoles).flat(),
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await root.query('SELECT 1 FROM pg_database WHERE datname=ANY($1)', [
            Object.values(lifecycleDatabases),
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      try {
        if (created) await root.query(`DROP ROLE ${role}`);
      } finally {
        await root.end();
      }
    }
  },
  30000,
);

describe.each(['foundation', 'migrated', 'quarantined-recovery'] as const)(
  '%s catalog adverse controls',
  (phase) => {
    let f: Fixture;
    let clean: Awaited<ReturnType<Fixture['snapshot']>>;
    let baseline: string;
    let passed = 0;
    const refusals: Record<string, number> = {};
    const databaseOwnerRefusals: Partial<Record<Target, string>> = {};
    beforeAll(async () => {
      f = await catalogFixture(phase);
      clean = await f.snapshot();
      baseline = JSON.stringify(f.baseline);
    }, 60000);
    afterAll(async () => {
      if (!f) return;
      try {
        expect(await f.snapshot()).toEqual(clean);
        expect(JSON.stringify(f.baseline)).toBe(baseline);
        expect(await f.activeInspections()).toBe(0);
        if (phase === 'quarantined-recovery') await f.assertRuntimeDenied();
        console.log(
          'CATALOG_ADVERSE_EVIDENCE',
          JSON.stringify({
            scope: 'disposable-local-catalog-faults',
            phase,
            completedCases: passed,
            inspectorRefusals: refusals,
            databaseOwnerRefusals,
            scopedRoles: 19,
            scopedMemberships: 0,
            unscopedSyntheticGrantors: 2,
            unscopedSyntheticOwner: 1,
            frozenPreFaultBaseline: true,
            inspectionReadOnly: true,
            readerChanged: false,
            runtimeAdmission: false,
            hostedAccepted: false,
            productActivation: false,
            productionPolicyChanged: false,
            actualProviderTest: false,
            actualRecipientNotifications: 0,
          }),
        );
      } finally {
        await f.cleanup();
      }
    });

    async function positive() {
      for (const target of targets)
        expect(await f.inspect(target)).toMatchObject({
          status: 'compatible',
          compatible: true,
          hostedAccepted: false,
          productActivation: false,
          checks: { readOnly: true, tls: true, scopedRoles: 19, memberships: 0 },
        });
      expect(await f.activeInspections()).toBe(0);
    }

    async function fault(
      target: Target,
      change: () => Promise<unknown>,
      undo: () => Promise<unknown>,
      finding: string,
      observe: () => Promise<void>,
      mayLoseOwnerConnection = false,
    ) {
      expect(await f.snapshot()).toEqual(clean);
      await positive();
      try {
        await change();
        await observe();
        const defective = await f.snapshot();
        expect(defective).not.toEqual(clean);
        const report = await f.inspect(target);
        refusals[report.status] = (refusals[report.status] ?? 0) + 1;
        if (finding === 'database_owner') databaseOwnerRefusals[target] = report.status;
        expect(report.compatible).toBe(false);
        expect(report.hostedAccepted).toBe(false);
        expect(report.productActivation).toBe(false);
        if (mayLoseOwnerConnection && report.status === 'unavailable') {
          expect(report.findings).toEqual([]);
        } else {
          expect(report.status).toBe('incompatible');
          expect(report.findings).toContain(finding);
        }
        expect(JSON.stringify(report)).not.toContain('postgresql:');
        expect(JSON.stringify(report)).not.toContain(new URL(f.input(target).url).password);
        expect(await f.snapshot()).toEqual(defective);
        expect(JSON.stringify(f.baseline)).toBe(baseline);
        expect(await f.activeInspections()).toBe(0);
      } finally {
        await undo();
      }
      expect(await f.snapshot()).toEqual(clean);
      await positive();
      passed++;
    }

    it('keeps fixed probe setup separate from application history and freezes both pre-fault baselines', async () => {
      expect(Object.isFrozen(f.baseline)).toBe(true);
      expect(Object.isFrozen(f.baseline.foundation)).toBe(true);
      if (f.baseline.migrated) expect(Object.isFrozen(f.baseline.migrated)).toBe(true);
      for (const target of targets) {
        const row = await f.withRoot(
          target,
          async (c) =>
            (await c.query('SELECT count(*)::int AS n,min(v) AS v FROM public.catalog_probe'))
              .rows[0],
        );
        expect(row).toEqual({ n: 2, v: 7 });
        const state = await f.withRoot(
          target,
          async (c) =>
            (await c.query("SELECT to_regclass('migration_meta.applied') IS NOT NULL AS history"))
              .rows[0],
        );
        expect(state.history).toBe(phase !== 'foundation');
      }
      await positive();
      passed++;
    });

    it.each(flags)(
      'T07 refuses actual %s on a peer scoped role',
      async (set, reset, flag, value) => {
        await fault(
          'app',
          () => f.root.query(`ALTER ROLE tt_cms_runtime ${set}`),
          () => f.root.query(`ALTER ROLE tt_cms_runtime ${reset}`),
          'role_capabilities',
          async () => {
            const row = (
              await f.root.query('SELECT * FROM pg_roles WHERE rolname=$1', ['tt_cms_runtime'])
            ).rows[0];
            expect(row[flag]).toBe(value);
            expect((await f.inspect('cms')).findings).toContain('role_capabilities');
          },
        );
      },
    );

    describe.each(targets)('%s exact owner', (target) => {
      const owner = databaseRoles[target][0];
      const runtime = databaseRoles[target][1];
      const database = lifecycleDatabases[target];
      const peerDatabase = lifecycleDatabases[target === 'app' ? 'cms' : 'app'];
      const root = (sql: string) => f.withRoot(target, (c) => c.query(sql));
      const own = (sql: string) => f.withOwner(target, (c) => c.query(sql));
      const query = async (sql: string, values: unknown[] = []) =>
        f.withRoot(target, async (c) => (await c.query(sql, values)).rows);
      const acl = () =>
        query(
          "SELECT pg_get_userbyid(a.grantee) AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.catalog_probe'::regclass ORDER BY grantee,grantor,privilege_type,is_grantable",
        );

      it.each([
        ['SET-only incoming', runtime, grantors[0], 'SET TRUE, INHERIT FALSE, ADMIN FALSE'],
        ['SET-only outgoing', grantors[0], runtime, 'SET TRUE, INHERIT FALSE, ADMIN FALSE'],
        [
          'predefined-role incoming ADMIN-only',
          runtime,
          'pg_monitor',
          'ADMIN TRUE, SET FALSE, INHERIT FALSE',
        ],
        [
          'predefined-role outgoing ADMIN-only',
          'pg_monitor',
          runtime,
          'ADMIN TRUE, SET FALSE, INHERIT FALSE',
        ],
      ] as const)('T07 refuses %s membership', async (_label, role, member, options) => {
        await fault(
          target,
          () => f.root.query(`GRANT ${role} TO ${member} WITH ${options}`),
          () => f.root.query(`REVOKE ${role} FROM ${member} GRANTED BY local_harness`),
          'role_memberships',
          async () => {
            const rows = (
              await f.root.query(
                'SELECT m.admin_option,m.set_option,m.inherit_option FROM pg_auth_members m WHERE m.roleid=$1::regrole AND m.member=$2::regrole',
                [role, member],
              )
            ).rows;
            expect(rows).toEqual([
              {
                admin_option: options.startsWith('ADMIN'),
                set_option: options.startsWith('SET'),
                inherit_option: false,
              },
            ]);
          },
        );
      });

      it('T08 refuses an added table privilege without repairing the ACL', async () => {
        await fault(
          target,
          () => own(`GRANT UPDATE ON public.catalog_probe TO ${runtime}`),
          () => own(`REVOKE UPDATE ON public.catalog_probe FROM ${runtime}`),
          'schema_inventory',
          async () => {
            expect(
              (await acl()).some((r) => r.grantee === runtime && r.privilege_type === 'UPDATE'),
            ).toBe(true);
          },
        );
      });

      it('T08 refuses grantability-only drift with unchanged grantees, grantors and privileges', async () => {
        const before = await acl();
        await fault(
          target,
          () =>
            root(
              `SET ROLE ${grantors[0]}; GRANT SELECT ON public.catalog_probe TO ${runtime} WITH GRANT OPTION`,
            ),
          () =>
            root(
              `SET ROLE ${grantors[0]}; REVOKE GRANT OPTION FOR SELECT ON public.catalog_probe FROM ${runtime}`,
            ),
          'schema_inventory',
          async () => {
            const after = await acl();
            expect(after.filter((r) => r.grantee === runtime)).toEqual([
              {
                grantee: runtime,
                grantor: grantors[0],
                privilege_type: 'SELECT',
                is_grantable: true,
              },
            ]);
            expect(after.map((row) => ({ ...row, is_grantable: false }))).toEqual(
              before.map((row) => ({ ...row, is_grantable: false })),
            );
          },
        );
      });

      it('T08 refuses grantor-only drift with unchanged grantability, grantees and privileges', async () => {
        const before = await acl();
        await fault(
          target,
          async () => {
            await root(
              `SET ROLE ${grantors[0]}; REVOKE SELECT ON public.catalog_probe FROM ${runtime}`,
            );
            await root(
              `SET ROLE ${grantors[1]}; GRANT SELECT ON public.catalog_probe TO ${runtime}`,
            );
          },
          async () => {
            await root(
              `SET ROLE ${grantors[1]}; REVOKE SELECT ON public.catalog_probe FROM ${runtime}`,
            );
            await root(
              `SET ROLE ${grantors[0]}; GRANT SELECT ON public.catalog_probe TO ${runtime}`,
            );
          },
          'schema_inventory',
          async () => {
            const after = await acl();
            expect(after.filter((r) => r.grantee === runtime)).toEqual([
              {
                grantee: runtime,
                grantor: grantors[1],
                privilege_type: 'SELECT',
                is_grantable: false,
              },
            ]);
            expect(after.map((row) => ({ ...row, grantor: 'normalized' }))).toEqual(
              before.map((row) => ({ ...row, grantor: 'normalized' })),
            );
          },
        );
      });

      it('T08 refuses a column-only ACL grant without a table-level UPDATE grant', async () => {
        await fault(
          target,
          () => own(`GRANT UPDATE(v) ON public.catalog_probe TO ${runtime}`),
          () => own(`REVOKE UPDATE(v) ON public.catalog_probe FROM ${runtime}`),
          'schema_inventory',
          async () => {
            expect(
              await query(
                "SELECT has_column_privilege($1,'public.catalog_probe','v','UPDATE') AS col,has_table_privilege($1,'public.catalog_probe','UPDATE') AS tab",
                [runtime],
              ),
            ).toEqual([{ col: true, tab: false }]);
          },
        );
      });

      it.each([
        ['FUNCTIONS', 'EXECUTE', 'f'],
        ['TYPES', 'USAGE', 'T'],
      ] as const)(
        'T08 preserves and refuses an actual empty %s default ACL row',
        async (kind, privilege, code) => {
          await fault(
            target,
            () => own(`ALTER DEFAULT PRIVILEGES REVOKE ${privilege} ON ${kind} FROM ${owner}`),
            () => own(`ALTER DEFAULT PRIVILEGES GRANT ${privilege} ON ${kind} TO ${owner}`),
            'schema_inventory',
            async () => {
              expect(
                await query(
                  'SELECT cardinality(defaclacl) AS n FROM pg_default_acl WHERE defaclrole=$1::regrole AND defaclnamespace=0 AND defaclobjtype=$2',
                  [owner, code],
                ),
              ).toEqual([{ n: 0 }]);
            },
          );
        },
      );

      it.each([
        [
          'global same-value',
          `ALTER ROLE ${runtime} SET statement_timeout='15s'`,
          `ALTER ROLE ${runtime} RESET statement_timeout`,
          '*',
        ],
        [
          'own-DB changed value',
          `ALTER ROLE ${runtime} IN DATABASE ${database} SET statement_timeout='27s'`,
          `ALTER ROLE ${runtime} IN DATABASE ${database} SET statement_timeout='15s'`,
          database,
        ],
        [
          'peer-DB extra row',
          `ALTER ROLE ${runtime} IN DATABASE ${peerDatabase} SET statement_timeout='15s'`,
          `ALTER ROLE ${runtime} IN DATABASE ${peerDatabase} RESET statement_timeout`,
          peerDatabase,
        ],
      ] as const)('T08 refuses %s role setting drift', async (_label, set, reset, db) => {
        await fault(
          target,
          () => f.root.query(set),
          () => f.root.query(reset),
          'role_settings',
          async () => {
            const rows = (
              await f.root.query(
                "SELECT COALESCE(d.datname,'*') AS db,s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE s.setrole=$1::regrole",
                [runtime],
              )
            ).rows;
            expect(
              rows.some(
                (r) =>
                  r.db === db &&
                  r.setconfig.includes(
                    _label === 'own-DB changed value'
                      ? 'statement_timeout=27s'
                      : 'statement_timeout=15s',
                  ),
              ),
            ).toBe(true);
          },
        );
      });

      it.each([
        [
          'database',
          `DATABASE ${database}`,
          `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname='${database}'`,
        ],
        [
          'schema',
          'SCHEMA catalog_probe',
          "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='catalog_probe'",
        ],
        [
          'table',
          'TABLE public.catalog_probe',
          "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.catalog_probe'::regclass",
        ],
        [
          'sequence',
          'SEQUENCE public.catalog_probe_seq',
          "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.catalog_probe_seq'::regclass",
        ],
        [
          'routine',
          'FUNCTION public.catalog_probe_fn()',
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.catalog_probe_fn()'::regprocedure",
        ],
        [
          'type',
          'TYPE public.catalog_probe_type',
          "SELECT pg_get_userbyid(typowner) AS owner FROM pg_type WHERE oid='public.catalog_probe_type'::regtype",
        ],
      ] as const)('T09 refuses an actual %s owner change', async (kind, object, observe) => {
        await fault(
          target,
          () => root(`ALTER ${object} OWNER TO catalog_probe_owner_sink`),
          () => root(`ALTER ${object} OWNER TO ${owner}`),
          kind === 'database' ? 'database_owner' : 'schema_inventory',
          async () => {
            expect(await query(observe)).toEqual([{ owner: 'catalog_probe_owner_sink' }]);
          },
          kind === 'database',
        );
      });

      it.each([
        [
          'schema',
          'CREATE SCHEMA catalog_probe_extra',
          'DROP SCHEMA catalog_probe_extra',
          "SELECT to_regnamespace('catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'table',
          'CREATE TABLE public.catalog_probe_extra(id int)',
          'DROP TABLE public.catalog_probe_extra',
          "SELECT to_regclass('public.catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'sequence',
          'CREATE SEQUENCE public.catalog_probe_extra',
          'DROP SEQUENCE public.catalog_probe_extra',
          "SELECT to_regclass('public.catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'routine',
          "CREATE FUNCTION public.catalog_probe_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'",
          'DROP FUNCTION public.catalog_probe_extra()',
          "SELECT to_regprocedure('public.catalog_probe_extra()') IS NOT NULL AS present",
        ],
        [
          'type',
          "CREATE TYPE public.catalog_probe_extra AS ENUM ('synthetic')",
          'DROP TYPE public.catalog_probe_extra',
          "SELECT to_regtype('public.catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'view',
          'CREATE VIEW public.catalog_probe_extra AS SELECT 1 AS id',
          'DROP VIEW public.catalog_probe_extra',
          "SELECT to_regclass('public.catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'materialized view',
          'CREATE MATERIALIZED VIEW public.catalog_probe_extra AS SELECT 1 AS id',
          'DROP MATERIALIZED VIEW public.catalog_probe_extra',
          "SELECT to_regclass('public.catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'index',
          'CREATE INDEX catalog_probe_extra ON public.catalog_probe(id)',
          'DROP INDEX public.catalog_probe_extra',
          "SELECT to_regclass('public.catalog_probe_extra') IS NOT NULL AS present",
        ],
        [
          'trigger',
          'CREATE TRIGGER catalog_probe_extra BEFORE UPDATE ON public.catalog_probe FOR EACH ROW EXECUTE FUNCTION public.catalog_probe_trigger()',
          'DROP TRIGGER catalog_probe_extra ON public.catalog_probe',
          "SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.catalog_probe'::regclass AND tgname='catalog_probe_extra') AS present",
        ],
      ] as const)(
        'T09 refuses an unexpected %s without dropping it',
        async (_kind, create, drop, observe) => {
          await fault(
            target,
            () => own(create),
            () => own(drop),
            'schema_inventory',
            async () => {
              expect(await query(observe)).toEqual([{ present: true }]);
            },
          );
        },
      );

      it('T09 refuses SECURITY DEFINER drift while preserving owner and function identity', async () => {
        await fault(
          target,
          () => own('ALTER FUNCTION public.catalog_probe_fn() SECURITY DEFINER'),
          () => own('ALTER FUNCTION public.catalog_probe_fn() SECURITY INVOKER'),
          'schema_inventory',
          async () => {
            expect(
              await query(
                "SELECT prosecdef,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.catalog_probe_fn()'::regprocedure",
              ),
            ).toEqual([{ prosecdef: true, owner }]);
          },
        );
      });

      it('T09 refuses function search_path drift without executing the function', async () => {
        await fault(
          target,
          () => own('ALTER FUNCTION public.catalog_probe_fn() SET search_path=public,pg_catalog'),
          () => own('ALTER FUNCTION public.catalog_probe_fn() SET search_path=pg_catalog'),
          'schema_inventory',
          async () => {
            expect(
              await query(
                "SELECT proconfig FROM pg_proc WHERE oid='public.catalog_probe_fn()'::regprocedure",
              ),
            ).toEqual([{ proconfig: ['search_path=public, pg_catalog'] }]);
          },
        );
      });

      it('T09 refuses an RLS predicate change without relying on table RLS flag changes', async () => {
        await fault(
          target,
          () => own('ALTER POLICY catalog_probe_read ON public.catalog_probe USING (false)'),
          () => own('ALTER POLICY catalog_probe_read ON public.catalog_probe USING (id > 0)'),
          'schema_inventory',
          async () => {
            expect(
              await query(
                "SELECT c.relrowsecurity,pg_get_expr(p.polqual,p.polrelid) AS predicate FROM pg_class c JOIN pg_policy p ON p.polrelid=c.oid WHERE c.oid='public.catalog_probe'::regclass AND p.polname='catalog_probe_read'",
              ),
            ).toEqual([{ relrowsecurity: true, predicate: 'false' }]);
          },
        );
      });

      it('T09 refuses a NOT VALID replacement of the same named constraint', async () => {
        await fault(
          target,
          () =>
            own(
              'ALTER TABLE public.catalog_probe DROP CONSTRAINT catalog_probe_nonnegative; ALTER TABLE public.catalog_probe ADD CONSTRAINT catalog_probe_nonnegative CHECK(v >= 0) NOT VALID',
            ),
          () =>
            own('ALTER TABLE public.catalog_probe VALIDATE CONSTRAINT catalog_probe_nonnegative'),
          'object_state',
          async () => {
            expect(
              await query(
                "SELECT convalidated FROM pg_constraint WHERE conrelid='public.catalog_probe'::regclass AND conname='catalog_probe_nonnegative'",
              ),
            ).toEqual([{ convalidated: false }]);
          },
        );
      });

      it('T09 refuses a real invalid index left by failed concurrent unique-index creation', async () => {
        await fault(
          target,
          async () => {
            await expect(
              own(
                'CREATE UNIQUE INDEX CONCURRENTLY catalog_probe_invalid ON public.catalog_probe(v)',
              ),
            ).rejects.toMatchObject({ code: '23505' });
          },
          () => own('DROP INDEX IF EXISTS public.catalog_probe_invalid'),
          'object_state',
          async () => {
            const rows = await query(
              "SELECT i.indisvalid,i.indisready FROM pg_index i WHERE i.indexrelid='public.catalog_probe_invalid'::regclass",
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.indisvalid).toBe(false);
            expect(
              await query(
                'SELECT count(*)::int AS n,count(DISTINCT v)::int AS values FROM public.catalog_probe',
              ),
            ).toEqual([{ n: 2, values: 1 }]);
          },
        );
      });

      it('T08 accepts a real ACL array reorder with unchanged semantic grants', async () => {
        const before = await acl();
        const raw = (
          await query(
            "SELECT relacl::text AS acl FROM pg_class WHERE oid='public.catalog_probe'::regclass",
          )
        )[0]?.acl;
        await own(
          `REVOKE SELECT ON public.catalog_probe FROM ${grantors[1]}; GRANT SELECT ON public.catalog_probe TO ${grantors[1]} WITH GRANT OPTION`,
        );
        expect(
          (
            await query(
              "SELECT relacl::text AS acl FROM pg_class WHERE oid='public.catalog_probe'::regclass",
            )
          )[0]?.acl,
        ).not.toBe(raw);
        expect(await acl()).toEqual(before);
        expect(await f.snapshot()).toEqual(clean);
        await positive();
        passed++;
      });
    });
  },
);
