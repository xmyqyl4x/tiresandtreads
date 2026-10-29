import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { lifecycleFixture } from '../fixtures/lifecycle-validation/database.ts';
import {
  inspectLifecycle,
  lifecyclePhases,
  readLifecycleRequest,
  withReadOnlyLifecycle,
} from '../fixtures/lifecycle-validation/reader.ts';

describe.each(['foundation', 'migrated', 'quarantined-recovery'] as const)(
  '%s lifecycle profile',
  (phase) => {
    let f: Awaited<ReturnType<typeof lifecycleFixture>>;
    beforeAll(async () => {
      f = await lifecycleFixture(phase);
    }, 60000);
    afterAll(async () => {
      await f?.cleanup();
    });

    it('validates both exact owners in a bounded real TLS/read-only session without changing state or creating metadata', async () => {
      const before = await f.snapshot();
      for (const target of ['app', 'cms'] as const) {
        const report = await f.inspect(target);
        expect(report).toMatchObject({
          scope: 'disposable-local-lifecycle',
          status: 'compatible',
          compatible: true,
          phase,
          target,
          findings: [],
          hostedAccepted: false,
          productActivation: false,
          checks: {
            readOnly: true,
            tls: true,
            serverVersion: 180006,
            scopedRoles: 19,
            memberships: 0,
            migrations: phase === 'foundation' ? 0 : target === 'app' ? 33 : 3,
          },
        });
      }
      expect(await f.snapshot()).toEqual(before);
      if (phase === 'foundation') {
        expect(
          await f.withOwner(
            'app',
            async (c) =>
              (await c.query("SELECT to_regclass('migration_meta.applied') AS name")).rows[0].name,
          ),
        ).toBeNull();
      }
    });

    it('refuses the other lifecycle phases against actual catalog state without learning or repairing them', async () => {
      const before = await f.snapshot();
      for (const other of lifecyclePhases.filter((p) => p !== phase)) {
        for (const target of ['app', 'cms'] as const) {
          const report = await f.inspect(target, { phase: other });
          expect(report.status).toBe('incompatible');
          expect(report.compatible).toBe(false);
          expect(report.findings.length).toBeGreaterThan(0);
        }
      }
      expect(await f.snapshot()).toEqual(before);
    });

    it('detects capability drift on a peer-database role without changing it', async () => {
      await f.root.query('ALTER ROLE tt_cms_runtime BYPASSRLS');
      try {
        const before = await f.snapshot();
        expect((await f.inspect('app')).findings).toContain('role_capabilities');
        expect(await f.snapshot()).toEqual(before);
      } finally {
        await f.root.query('ALTER ROLE tt_cms_runtime NOBYPASSRLS');
      }
    });

    it.each(['incoming', 'outgoing'] as const)(
      'refuses an %s project membership, including ADMIN without SET/INHERIT',
      async (direction) => {
        const grant =
          direction === 'incoming'
            ? 'GRANT tt_app_runtime TO local_harness WITH ADMIN TRUE, SET FALSE, INHERIT FALSE'
            : 'GRANT tt_cms_runtime TO tt_app_runtime WITH SET FALSE, INHERIT FALSE';
        const revoke =
          direction === 'incoming'
            ? 'REVOKE tt_app_runtime FROM local_harness GRANTED BY local_harness'
            : 'REVOKE tt_cms_runtime FROM tt_app_runtime GRANTED BY local_harness';
        await f.root.query(grant);
        try {
          const before = await f.snapshot();
          expect((await f.inspect('app')).findings).toContain('role_memberships');
          expect(await f.snapshot()).toEqual(before);
        } finally {
          await f.root.query(revoke);
        }
      },
    );

    it('detects role-specific setting drift and never resets a timeout to make validation pass', async () => {
      await f.root.query(
        "ALTER ROLE tt_app_runtime IN DATABASE tt_app_lifecycle_probe SET statement_timeout='27s'",
      );
      try {
        const before = await f.snapshot();
        expect((await f.inspect('app')).findings).toContain('role_settings');
        expect(await f.snapshot()).toEqual(before);
      } finally {
        await f.root.query(
          "ALTER ROLE tt_app_runtime IN DATABASE tt_app_lifecycle_probe SET statement_timeout='15s'",
        );
      }
    });

    it('preserves PUBLIC database, schema and default-privilege defects while reporting them', async () => {
      await f.withOwner('app', async (c) => {
        await c.query('GRANT CONNECT ON DATABASE tt_app_lifecycle_probe TO PUBLIC');
        await c.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
        await c.query('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC');
      });
      try {
        const before = await f.snapshot();
        expect((await f.inspect('app')).findings).toEqual(
          expect.arrayContaining(['database_acl', 'schema_inventory', 'default_privileges']),
        );
        expect(await f.snapshot()).toEqual(before);
      } finally {
        await f.withOwner('app', async (c) => {
          await c.query('REVOKE CONNECT ON DATABASE tt_app_lifecycle_probe FROM PUBLIC');
          await c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
          await c.query('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
        });
      }
    });

    it('enforces phase-specific runtime CONNECT and peer-database denial without changing grants', async () => {
      const verb = phase === 'quarantined-recovery' ? 'GRANT' : 'REVOKE';
      const inverse = verb === 'GRANT' ? 'REVOKE' : 'GRANT';
      const preposition = verb === 'GRANT' ? 'TO' : 'FROM';
      const opposite = inverse === 'GRANT' ? 'TO' : 'FROM';
      await f.root.query(
        `${verb} CONNECT ON DATABASE tt_app_lifecycle_probe ${preposition} tt_app_runtime`,
      );
      try {
        const before = await f.snapshot();
        expect((await f.inspect('app')).findings).toContain('runtime_admission');
        expect(await f.snapshot()).toEqual(before);
      } finally {
        await f.root.query(
          `${inverse} CONNECT ON DATABASE tt_app_lifecycle_probe ${opposite} tt_app_runtime`,
        );
      }
      await f.root.query('GRANT CONNECT ON DATABASE tt_cms_lifecycle_probe TO tt_app_runtime');
      try {
        const before = await f.snapshot();
        expect((await f.inspect('app')).findings).toContain('runtime_admission');
        expect(await f.snapshot()).toEqual(before);
      } finally {
        await f.root.query('REVOKE CONNECT ON DATABASE tt_cms_lifecycle_probe FROM tt_app_runtime');
      }
    });

    if (phase === 'foundation') {
      it('refuses pre-existing scoped resources without adopting, dropping or modifying them', async () => {
        const before = await f.snapshot();
        await expect(lifecycleFixture('foundation')).rejects.toThrow(
          'refuses pre-existing scoped roles or databases',
        );
        expect(await f.snapshot()).toEqual(before);
      });

      it('detects a missing scoped role without adopting its renamed identity', async () => {
        await f.root.query('ALTER ROLE tt_cms_runtime RENAME TO lifecycle_missing');
        try {
          const before = await f.snapshot();
          expect((await f.inspect('app')).findings).toContain('role_capabilities');
          expect(await f.snapshot()).toEqual(before);
        } finally {
          await f.root.query('ALTER ROLE lifecycle_missing RENAME TO tt_cms_runtime');
        }
      });

      it('ignores an actual ACL array reordering while retaining exact semantic grants', async () => {
        const before = await f.snapshot();
        const rawBefore = (
          await f.root.query(
            "SELECT datacl::text AS acl FROM pg_database WHERE datname='tt_app_lifecycle_probe'",
          )
        ).rows[0].acl;
        await f.withOwner('app', async (c) => {
          await c.query('REVOKE CONNECT ON DATABASE tt_app_lifecycle_probe FROM tt_staff_runtime');
          await c.query('GRANT CONNECT ON DATABASE tt_app_lifecycle_probe TO tt_staff_runtime');
        });
        const rawAfter = (
          await f.root.query(
            "SELECT datacl::text AS acl FROM pg_database WHERE datname='tt_app_lifecycle_probe'",
          )
        ).rows[0].acl;
        expect(rawAfter).not.toBe(rawBefore);
        expect((await f.inspect('app')).compatible).toBe(true);
        expect(await f.snapshot()).toEqual(before);
      });

      it('keeps the read-only transaction effective against actual DDL, role settings and data writes, including rollback on failure', async () => {
        const settings = readLifecycleRequest(f.input('app'), process.env);
        for (const sql of [
          'CREATE TABLE public.lifecycle_forbidden(id int)',
          "ALTER ROLE tt_app_migrator SET lock_timeout='9s'",
        ]) {
          const before = await f.snapshot();
          await expect(withReadOnlyLifecycle(settings, (c) => c.query(sql))).rejects.toMatchObject({
            code: '25006',
          });
          expect(await f.snapshot()).toEqual(before);
        }
        await f.withOwner('app', (c) =>
          c.query(
            "CREATE TABLE public.lifecycle_sentinel(id int PRIMARY KEY, value text); INSERT INTO public.lifecycle_sentinel VALUES(1,'private synthetic value')",
          ),
        );
        try {
          const before = await f.snapshot();
          await expect(
            withReadOnlyLifecycle(settings, (c) =>
              c.query("UPDATE public.lifecycle_sentinel SET value='changed'"),
            ),
          ).rejects.toMatchObject({ code: '25006' });
          expect(await f.snapshot()).toEqual(before);
          expect(
            await f.withOwner(
              'app',
              async (c) =>
                (await c.query('SELECT value FROM public.lifecycle_sentinel')).rows[0].value,
            ),
          ).toBe('private synthetic value');
        } finally {
          await f.withOwner('app', (c) => c.query('DROP TABLE public.lifecycle_sentinel'));
        }
      });

      it('bounds stalled inspection and closes its session without changing role settings or catalogs', async () => {
        const before = await f.snapshot();
        await expect(
          withReadOnlyLifecycle(readLifecycleRequest(f.input('app'), process.env), (c) =>
            c.query('SELECT pg_sleep(5)'),
          ),
        ).rejects.toMatchObject({ code: '57014' });
        expect(await f.snapshot()).toEqual(before);
        expect(await f.activeInspections()).toBe(0);
      });

      it('re-admits connection settings and rejects redirected or foreign-project settings before opening a session', async () => {
        const settings = readLifecycleRequest(f.input('app'), process.env);
        const before = await f.snapshot();
        await expect(
          withReadOnlyLifecycle(
            { ...settings, url: settings.url.replace('postgres.preflight.test', 'localhost') },
            async () => undefined,
          ),
        ).rejects.toThrow('Invalid disposable lifecycle request');
        await expect(
          withReadOnlyLifecycle(
            { ...settings, project: 'tt-test-ffffffffffffffff' },
            async () => undefined,
          ),
        ).rejects.toThrow('Disposable lifecycle project changed');
        expect(await f.snapshot()).toEqual(before);
        expect(await f.activeInspections()).toBe(0);
      });

      it('refuses wrong CA, hostname and untrusted or stale baseline bindings without exposing connection data', async () => {
        for (const patch of [
          { ca: await readFile('/tls/wrong-ca.crt', 'utf8') },
          {
            url: f
              .input('app')
              .url.replace('postgres.preflight.test', 'postgres.mismatch.preflight.test'),
          },
        ]) {
          const report = await f.inspect('app', patch);
          expect(report.status).toBe('unavailable');
          expect(JSON.stringify(report)).not.toContain(new URL(f.input('app').url).password);
          expect(JSON.stringify(report)).not.toContain('postgresql:');
        }
        expect(
          (
            await inspectLifecycle(f.input('app'), process.env, {
              ...f.baseline,
              project: 'tt-test-ffffffffffffffff',
            })
          ).status,
        ).toBe('configuration');
        expect(
          (
            await inspectLifecycle(f.input('app'), process.env, {
              ...f.baseline,
              sourceDigest: '0'.repeat(64),
            })
          ).status,
        ).toBe('configuration');
        expect(await f.activeInspections()).toBe(0);
      });
    } else {
      it('masks a real SQL permission failure after catalog reads, closes the session and leaves the defective target unchanged', async () => {
        await f.withRoot('app', (c) =>
          c.query('ALTER TABLE migration_meta.applied OWNER TO tt_cms_migrator'),
        );
        try {
          const before = await f.snapshot();
          const report = await f.inspect('app');
          expect(report.status).toBe('unavailable');
          expect(report.compatible).toBe(false);
          expect(JSON.stringify(report)).not.toContain('migration_meta');
          expect(JSON.stringify(report)).not.toContain(new URL(f.input('app').url).password);
          expect(await f.snapshot()).toEqual(before);
          expect(await f.activeInspections()).toBe(0);
        } finally {
          await f.withRoot('app', (c) =>
            c.query('ALTER TABLE migration_meta.applied OWNER TO tt_app_migrator'),
          );
        }
      });

      it('detects missing, changed, gapped and extra history without changing any ledger', async () => {
        await f.withOwner('app', async (c) => {
          const original = (
            await c.query(
              'SELECT position,id,sha256,applied_at::text AS applied_at FROM migration_meta.applied WHERE position=1',
            )
          ).rows[0];
          for (const sql of [
            "UPDATE migration_meta.applied SET sha256=repeat('0',64) WHERE position=1",
            'DELETE FROM migration_meta.applied WHERE position=1',
            'UPDATE migration_meta.applied SET position=101 WHERE position=1',
            "INSERT INTO migration_meta.applied(position,id,sha256) VALUES(34,'9999_lifecycle_extra',repeat('1',64))",
          ]) {
            await c.query('BEGIN');
            await c.query(sql);
            await c.query('COMMIT');
            try {
              const before = await f.snapshot();
              expect((await f.inspect('app')).findings).toContain('migrations');
              expect(await f.snapshot()).toEqual(before);
            } finally {
              await c.query('DELETE FROM migration_meta.applied WHERE position IN (1,34,101)');
              await c.query(
                'INSERT INTO migration_meta.applied(position,id,sha256,applied_at) VALUES($1,$2,$3,$4)',
                [original.position, original.id, original.sha256, original.applied_at],
              );
            }
          }
        });
      });

      it('detects CMS native-ledger drift separately from its checksum ledger', async () => {
        const original = await f.withOwner(
          'cms',
          async (c) =>
            (
              await c.query(
                'SELECT name,batch FROM public.payload_migrations ORDER BY name LIMIT 1',
              )
            ).rows[0],
        );
        await f.withOwner('cms', (c) =>
          c.query(
            'UPDATE public.payload_migrations SET batch=-1 WHERE name=(SELECT name FROM public.payload_migrations ORDER BY name LIMIT 1)',
          ),
        );
        try {
          const before = await f.snapshot();
          expect((await f.inspect('cms')).findings).toContain('cms_history');
          expect(await f.snapshot()).toEqual(before);
        } finally {
          await f.withOwner('cms', (c) =>
            c.query('UPDATE public.payload_migrations SET batch=$1 WHERE name=$2', [
              original.batch,
              original.name,
            ]),
          );
        }
      });

      it('detects object ownership, ACL, RLS and unvalidated constraint drift using the frozen pre-fault baseline', async () => {
        const changes = [
          [
            'ALTER TABLE app.subjects OWNER TO tt_cms_migrator',
            'ALTER TABLE app.subjects OWNER TO tt_app_migrator',
          ],
          [
            'GRANT SELECT ON app.subjects TO tt_public_runtime',
            'REVOKE SELECT ON app.subjects FROM tt_public_runtime',
          ],
          [
            'ALTER TABLE app.subjects ENABLE ROW LEVEL SECURITY',
            'ALTER TABLE app.subjects DISABLE ROW LEVEL SECURITY',
          ],
          [
            'ALTER TABLE app.subjects ADD CONSTRAINT lifecycle_pending CHECK(id IS NOT NULL) NOT VALID',
            'ALTER TABLE app.subjects DROP CONSTRAINT lifecycle_pending',
          ],
        ];
        for (const [change, undo] of changes) {
          await f.withRoot('app', (c) => c.query(change!));
          try {
            const before = await f.snapshot();
            expect((await f.inspect('app')).findings).toContain('schema_inventory');
            expect(await f.snapshot()).toEqual(before);
          } finally {
            await f.withRoot('app', (c) => c.query(undo!));
          }
        }
      });
    }

    if (phase === 'quarantined-recovery') {
      it('denies every real runtime connection while preserving owner inspection and never promoting the target', async () => {
        await f.assertRuntimeDenied();
        expect((await f.inspect('app')).compatible).toBe(true);
        expect((await f.inspect('cms')).compatible).toBe(true);
        console.log(
          'LIFECYCLE_VALIDATION_EVIDENCE',
          JSON.stringify({
            scope: 'disposable local phase validation only',
            profiles: lifecyclePhases,
            scopedRoles: 19,
            memberships: 0,
            runtimeConnectDenied: true,
            hostedAccepted: false,
            productActivation: false,
            actualProviderTest: false,
            actualRecipientNotifications: 0,
            productionPolicyChanged: false,
          }),
        );
      });
    }
  },
);
