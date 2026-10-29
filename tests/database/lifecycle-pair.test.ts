import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createPairedLifecycle } from '../fixtures/lifecycle-pair/pair.ts';
import { lifecycleFixture } from '../fixtures/lifecycle-validation/database.ts';
import {
  lifecyclePhases,
  lifecycleDatabases,
  inspectLifecycle,
  lifecycleSourceDigest,
} from '../fixtures/lifecycle-validation/reader.ts';
import { identifier } from '../../scripts/database/bootstrap.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { loadSources } from '../../scripts/database/manifest.ts';

const identity = () => ({
  operationId: randomBytes(16).toString('hex'),
  releaseDigest: lifecycleSourceDigest(),
  credentialGeneration: randomBytes(16).toString('hex'),
});

describe.each(lifecyclePhases)('paired local %s handoff', (phase) => {
  let f: Awaited<ReturnType<typeof lifecycleFixture>>;
  beforeAll(async () => {
    f = await lifecycleFixture(phase);
  }, 60000);
  afterAll(async () => {
    await f?.cleanup();
  });
  const coordinator = () =>
    createPairedLifecycle({ app: f.input('app'), cms: f.input('cms') }, f.baseline, identity());

  it('re-reads both databases under a cooperative lock at handoff, preserves durable state, and grants no authority', async () => {
    const before = await f.snapshot(),
      pair = coordinator();
    try {
      const validation = await pair.validate();
      expect(validation.status).toBe('validated');
      expect(validation.receipt).toMatchObject({
        project: process.env.ISOLATED_TEST_PROJECT,
        sourceDigest: lifecycleSourceDigest(),
        phase,
      });
      const handoff = await pair.handoff(validation.receipt);
      expect(handoff).toMatchObject({
        status: 'observed',
        hostedAccepted: false,
        productActivation: false,
        runtimeAdmission: false,
      });
      expect(handoff.observations?.map((r) => r.target)).toEqual(['app', 'cms']);
      expect((await pair.handoff(validation.receipt)).reason).toBe('receipt');
      expect(await f.snapshot()).toEqual(before);
      expect(await f.activeInspections()).toBe(0);
      if (phase === 'quarantined-recovery') await f.assertRuntimeDenied();
    } finally {
      pair.close();
    }
  });

  it.each(['app', 'cms'] as const)(
    'invalidates evidence after %s ACL drift and requires a new pair after repair',
    async (target) => {
      const pair = coordinator();
      try {
        const initial = await pair.validate();
        expect(initial.status).toBe('validated');
        await f.withOwner(target, (c) => c.query('GRANT CREATE ON SCHEMA public TO PUBLIC'));
        try {
          const defective = await f.snapshot();
          const handoff = await pair.handoff(initial.receipt);
          expect(handoff.status).toBe('refused');
          expect(handoff.observations?.find((r) => r.target === target)?.status).toBe(
            'incompatible',
          );
          expect(await f.snapshot()).toEqual(defective);
        } finally {
          await f.withOwner(target, (c) => c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC'));
        }
        expect((await pair.handoff(initial.receipt)).reason).toBe('receipt');
        const renewed = await pair.validate();
        expect(renewed.status).toBe('validated');
        expect((await pair.handoff(renewed.receipt)).status).toBe('observed');
        expect(await f.activeInspections()).toBe(0);
      } finally {
        pair.close();
      }
    },
  );

  it('refuses a competing real advisory lock and releases every session on refusal and success', async () => {
    const pair = coordinator(),
      other = coordinator();
    try {
      const before = await f.snapshot();
      await f.withOwner('app', async (c) => {
        await c.query('SELECT pg_advisory_lock(7724046,1)');
        expect((await pair.validate()).reason).toBe('lock');
        expect((await other.validate()).reason).toBe('lock');
      });
      const results = await Promise.all([pair.validate(), pair.validate()]);
      expect(results.map((r) => r.status).sort()).toEqual(['refused', 'validated']);
      expect(results.find((r) => r.status === 'refused')?.reason).toBe('busy');
      expect((await other.validate()).status).toBe('validated');
      expect(await f.snapshot()).toEqual(before);
      expect(await f.activeInspections()).toBe(0);
    } finally {
      pair.close();
      other.close();
    }
  });

  it('rejects copied receipts, cross-instance replay, declared invalidation and closed coordinators', async () => {
    const pair = coordinator(),
      other = coordinator();
    try {
      const first = await pair.validate();
      expect((await other.handoff(first.receipt)).reason).toBe('receipt');
      expect((await pair.handoff(JSON.parse(JSON.stringify(first.receipt)))).reason).toBe(
        'receipt',
      );
      expect((await pair.handoff(first.receipt)).reason).toBe('receipt');
      const second = await pair.validate();
      pair.invalidate();
      expect((await pair.handoff(second.receipt)).reason).toBe('receipt');
      pair.close();
      expect((await pair.validate()).reason).toBe('configuration');
      expect(await f.activeInspections()).toBe(0);
    } finally {
      pair.close();
      other.close();
    }
  });

  if (phase === 'foundation') {
    it('refuses swapped, mixed-phase, foreign-source and expanded configuration before connecting', async () => {
      const before = await f.snapshot();
      for (const inputs of [
        { app: f.input('cms'), cms: f.input('app') },
        { app: f.input('app'), cms: { ...f.input('cms'), phase: 'migrated' } },
        { app: f.input('app'), cms: f.input('cms'), repair: true },
      ])
        expect(() => createPairedLifecycle(inputs, f.baseline, identity())).toThrow(
          'Invalid disposable paired lifecycle configuration',
        );
      expect(() =>
        createPairedLifecycle(
          { app: f.input('app'), cms: f.input('cms') },
          { ...f.baseline, sourceDigest: '0'.repeat(64) },
          identity(),
        ),
      ).toThrow();
      const inputs = { app: f.input('app'), cms: f.input('cms') },
        pair = createPairedLifecycle(inputs, f.baseline, identity());
      expect(() =>
        createPairedLifecycle(inputs, f.baseline, {
          ...identity(),
          operationId: { toString: () => 'a'.repeat(32), private: 'private-sentinel' },
        }),
      ).toThrow('Invalid disposable paired lifecycle configuration');
      inputs.app.url = 'postgresql://localhost/retained';
      expect((await pair.validate()).status).toBe('validated');
      pair.close();
      expect(await f.snapshot()).toEqual(before);
      expect(await f.activeInspections()).toBe(0);
    });

    it('refuses an environment change while an operation is pending without changing targets', async () => {
      const pair = coordinator(),
        before = await f.snapshot(),
        project = process.env.ISOLATED_TEST_PROJECT;
      try {
        const pending = pair.validate();
        process.env.ISOLATED_TEST_PROJECT = 'tt-test-ffffffffffffffff';
        expect((await pending).status).toBe('refused');
      } finally {
        process.env.ISOLATED_TEST_PROJECT = project;
        pair.close();
      }
      expect(await f.snapshot()).toEqual(before);
      expect(await f.activeInspections()).toBe(0);
    });
  }

  it('refuses invalidation or closure during an in-flight observation without issuing a receipt', async () => {
    const before = await f.snapshot();
    for (const action of ['invalidate', 'close'] as const) {
      const pair = coordinator(),
        pending = pair.validate();
      pair[action]();
      const result = await pending;
      expect(result.status).toBe('refused');
      expect(result.receipt).toBeUndefined();
      pair.close();
    }
    expect(await f.snapshot()).toEqual(before);
    expect(await f.activeInspections()).toBe(0);
  });

  if (phase !== 'foundation') {
    it.each(['app', 'cms'] as const)(
      'refuses a partial %s ledger while retaining the peer committed migrations exactly',
      async (target) => {
        const pair = coordinator();
        const last = await f.withOwner(
          target,
          async (c) =>
            (
              await c.query(
                'SELECT position,id,sha256,applied_at::text AS applied_at FROM migration_meta.applied ORDER BY position DESC LIMIT 1',
              )
            ).rows[0],
        );
        try {
          await f.withOwner(target, (c) =>
            c.query('DELETE FROM migration_meta.applied WHERE position=$1', [last.position]),
          );
          const before = await f.snapshot(),
            result = await pair.validate();
          expect(result.status).toBe('refused');
          expect(result.receipt).toBeUndefined();
          expect(result.observations?.find((r) => r.target === target)?.findings).toContain(
            'migrations',
          );
          expect(result.observations?.find((r) => r.target !== target)?.status).toBe('compatible');
          expect(await f.snapshot()).toEqual(before);
        } finally {
          await f.withOwner(target, (c) =>
            c.query(
              'INSERT INTO migration_meta.applied(position,id,sha256,applied_at) VALUES($1,$2,$3,$4)',
              [last.position, last.id, last.sha256, last.applied_at],
            ),
          );
          pair.close();
        }
      },
    );

    it('consumes prior evidence on a real CMS SQL permission failure, masks details, and closes the lock and inspectors', async () => {
      const pair = coordinator(),
        initial = await pair.validate();
      expect(initial.status).toBe('validated');
      try {
        await f.withRoot('cms', (c) =>
          c.query('ALTER TABLE migration_meta.applied OWNER TO tt_app_migrator'),
        );
        try {
          const before = await f.snapshot(),
            result = await pair.handoff(initial.receipt);
          expect(result.status).toBe('refused');
          expect(result.observations?.[1]?.status).toBe('unavailable');
          expect(JSON.stringify(result)).not.toMatch(
            /postgresql:|permission denied|password|migration_meta/,
          );
          expect(await f.snapshot()).toEqual(before);
        } finally {
          await f.withRoot('cms', (c) =>
            c.query('ALTER TABLE migration_meta.applied OWNER TO tt_cms_migrator'),
          );
        }
        expect((await pair.handoff(initial.receipt)).reason).toBe('receipt');
        const renewed = await pair.validate();
        expect((await pair.handoff(renewed.receipt)).status).toBe('observed');
        expect(await f.activeInspections()).toBe(0);
      } finally {
        pair.close();
      }
    });
  }

  if (phase === 'migrated') {
    it('refuses loss of the actual lock session while inspections are in progress and permits a fresh attempt', async () => {
      const pair = coordinator(),
        before = await f.snapshot();
      try {
        await f.withRoot('app', async (c) => {
          await c.query('BEGIN; LOCK TABLE migration_meta.applied IN ACCESS EXCLUSIVE MODE');
          const pending = pair.validate();
          try {
            let pid: number | undefined;
            for (let n = 0; n < 100 && !pid; n++) {
              pid = (
                await f.root.query(
                  "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=7724046 AND objid=1 AND granted AND database=(SELECT oid FROM pg_database WHERE datname='tt_app_lifecycle_probe')",
                )
              ).rows[0]?.pid;
              if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(pid).toBeTypeOf('number');
            expect(
              (await f.root.query('SELECT pg_terminate_backend($1) AS stopped', [pid])).rows[0]
                .stopped,
            ).toBe(true);
            expect((await pending).reason).toBe('unavailable');
          } finally {
            await c.query('ROLLBACK');
            await pending;
          }
        });
        expect(await f.snapshot()).toEqual(before);
        expect((await pair.validate()).status).toBe('validated');
        expect(await f.activeInspections()).toBe(0);
      } finally {
        pair.close();
      }
    });

    it.each(['app', 'cms'] as const)(
      'detects an actual %s owner password change without publishing credential hashes or changing policy',
      async (target) => {
        const pair = coordinator(),
          initial = await pair.validate();
        expect(initial.status).toBe('validated');
        const original = new URL(f.input(target).url).password,
          replacement = randomBytes(32).toString('hex');
        try {
          await f.root.query(
            `ALTER ROLE ${identifier('tt_' + target + '_migrator')} PASSWORD '${replacement}'`,
          );
          const before = await f.snapshot(),
            result = await pair.handoff(initial.receipt);
          expect(result.status).toBe('refused');
          expect(JSON.stringify(result)).not.toContain(original);
          expect(JSON.stringify(result)).not.toContain(replacement);
          expect(JSON.stringify(initial.receipt)).not.toContain(original);
          expect(await f.snapshot()).toEqual(before);
        } finally {
          await f.root.query(
            `ALTER ROLE ${identifier('tt_' + target + '_migrator')} PASSWORD '${original}'`,
          );
        }
        expect((await pair.handoff(initial.receipt)).reason).toBe('receipt');
        expect((await pair.validate()).status).toBe('validated');
        pair.close();
        expect(await f.activeInspections()).toBe(0);
      },
    );
  }
});

// Actual one-sided migration commits, not a fake rollback or a fabricated success.
describe.each(['app', 'cms'] as const)('one-sided %s release', (migratedTarget) => {
  it('keeps a committed peer release visible, refuses the pair and never mutates or repairs the other database', async () => {
    const f = await lifecycleFixture('foundation');
    try {
      const url = new URL(f.input(migratedTarget).url);
      url.hostname = 'postgres';
      if (migratedTarget === 'app') {
        expect(
          await migrateApplication(
            { kind: 'app', database: lifecycleDatabases.app, url: url.toString() },
            loadSources('app'),
          ),
        ).toBe(33);
      } else {
        const child = spawnSync(
          process.execPath,
          ['--import', 'tsx', 'tests/fixtures/lifecycle-validation/migrate.ts'],
          {
            env: {
              ...process.env,
              TT_LIFECYCLE_CMS_URL: url.toString(),
              TT_LIFECYCLE_CMS_SECRET: randomBytes(32).toString('hex'),
            },
            encoding: 'utf8',
            timeout: 30000,
          },
        );
        expect(child.status, 'actual disposable CMS owner migrations').toBe(0);
      }
      const before = await f.snapshot();
      const peer = migratedTarget === 'app' ? 'cms' : 'app';
      expect((await inspectLifecycle(f.input(peer), process.env, f.baseline)).status).toBe(
        'compatible',
      );
      const pair = createPairedLifecycle(
        { app: f.input('app'), cms: f.input('cms') },
        f.baseline,
        identity(),
      );
      try {
        const result = await pair.validate();
        expect(result.status).toBe('refused');
        expect(result.receipt).toBeUndefined();
        expect(result.observations?.find((r) => r.target === migratedTarget)?.status).toBe(
          'incompatible',
        );
        expect(result.observations?.find((r) => r.target === peer)?.status).toBe('compatible');
        expect(await f.snapshot()).toEqual(before);
        expect(before.databases.find((d) => d.target === migratedTarget)?.history).toHaveLength(
          migratedTarget === 'app' ? 33 : 3,
        );
        expect(before.databases.find((d) => d.target === peer)?.history).toHaveLength(0);
        expect(await f.activeInspections()).toBe(0);
      } finally {
        pair.close();
      }
    } finally {
      await f.cleanup();
    }
  }, 60000);
});
