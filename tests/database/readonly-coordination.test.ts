import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { lifecycleFixture } from '../fixtures/lifecycle-validation/database.ts';
import {
  openParticipant,
  coordinationDiagnostics,
} from '../fixtures/readonly-coordination/proof.ts';

let f: Awaited<ReturnType<typeof lifecycleFixture>>;
const owned: Awaited<ReturnType<typeof openParticipant>>[] = [];
const measured = {
  commonRefusals: 0,
  separateDatabaseGrants: 0,
  innerTimeouts: 0,
  lostWorkCompletions: 0,
};
const plan = (origin: 'app' | 'cms', mode = 'common') => ({
  version: 1,
  scope: 'disposable-readonly-coordination',
  project: process.env.ISOLATED_TEST_PROJECT,
  origin,
  mode,
  inputs: { app: f.input('app'), cms: f.input('cms') },
});
async function open(origin: 'app' | 'cms', mode = 'common') {
  const p = await openParticipant(plan(origin, mode));
  owned.push(p);
  return p;
}
beforeAll(async () => {
  f = await lifecycleFixture('foundation');
  const baseline = await f.snapshot();
  expect(baseline.roleState).toHaveLength(19);
  expect(baseline.memberships).toEqual([]);
  for (const role of baseline.roleState)
    expect(role).toMatchObject({
      rolcanlogin: true,
      rolinherit: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    });
}, 60000);
afterAll(async () => f?.cleanup(), 60000);
afterEach(async () => {
  for (const p of owned.splice(0)) {
    const facts = p.facts();
    await p.close();
    expect(
      (
        await f.root.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1)', [
          [facts.coordinator.pid, facts.work.pid],
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.root.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND pid=ANY($1)",
          [[facts.coordinator.pid, facts.work.pid]],
        )
      ).rows[0].n,
    ).toBe(0);
  }
});
async function waitForSleep(p: Awaited<ReturnType<typeof openParticipant>>) {
  for (let n = 0; n < 80; n++) {
    if (
      (
        await f.root.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active' AND wait_event='PgSleep'",
          [p.facts().work.pid],
        )
      ).rowCount
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('Owned fixed read did not reach PostgreSQL');
}

it.each(['app', 'cms'] as const)(
  'PJ08 makes a competing %s work origin use the same app-DB coordination endpoint',
  async (origin) => {
    const before = await f.snapshot();
    const first = await open(origin),
      second = await open(origin === 'app' ? 'cms' : 'app');
    expect(first.facts().coordinator.database).toBe('tt_app_lifecycle_probe');
    expect(second.facts().coordinator.database).toBe('tt_app_lifecycle_probe');
    expect(first.facts().work.database).toBe(`tt_${origin}_lifecycle_probe`);
    for (const p of [first, second])
      for (const facts of [p.facts().coordinator, p.facts().work])
        expect(facts).toMatchObject({ readOnly: true, tls: true });
    expect((await first.acquire()).status).toBe('held');
    expect((await second.acquire()).status).toBe('busy');
    expect(await second.read()).toMatchObject({ status: 'refused', workCompleted: false });
    expect(second.facts().workQueries).toBe(0);
    measured.commonRefusals++;
    await first.close();
    const fresh = await open(origin === 'app' ? 'cms' : 'app');
    expect((await fresh.acquire()).status).toBe('held');
    expect(await fresh.read()).toMatchObject({
      status: 'observed',
      workCompleted: true,
      runtimeAdmission: false,
    });
    await second.close();
    await fresh.close();
    expect(await f.snapshot()).toEqual(before);
  },
);

it('PJ08 separate-per-database control grants the same numeric key in both databases and proves no common exclusion', async () => {
  const before = await f.snapshot();
  const app = await open('app', 'per-database-control'),
    cms = await open('cms', 'per-database-control');
  expect(app.facts().coordinator.database).not.toBe(cms.facts().coordinator.database);
  expect((await app.acquire()).status).toBe('held');
  expect((await cms.acquire()).status).toBe('held');
  measured.separateDatabaseGrants += 2;
  expect((await app.read()).status).toBe('observed');
  expect((await cms.read()).status).toBe('observed');
  expect(await cms.innerLock()).toMatchObject({
    status: 'refused',
    reason: 'control-mode',
    workCompleted: false,
  });
  await app.close();
  await cms.close();
  expect(await f.snapshot()).toEqual(before);
});

it.each(['app', 'cms'] as const)(
  'PJ09 bounds an inner app migration-key wait after common allocation for %s without running migrations',
  async (origin) => {
    const before = await f.snapshot();
    const p = await open(origin);
    expect((await p.acquire()).status).toBe('held');
    await f.withOwner('app', async (blocker) => {
      await blocker.query('SELECT pg_advisory_lock(7724004,1)');
      const started = performance.now();
      expect(await p.innerLock()).toMatchObject({
        status: 'refused',
        reason: 'lock-timeout',
        workCompleted: false,
      });
      expect(performance.now() - started).toBeLessThan(2500);
      expect(p.facts().workQueries).toBe(0);
      measured.innerTimeouts++;
    });
    await p.close();
    const fresh = await open(origin);
    expect((await fresh.acquire()).status).toBe('held');
    expect((await fresh.innerLock()).status).toBe('observed');
    expect((await fresh.read()).status).toBe('observed');
    await fresh.close();
    expect(await f.snapshot()).toEqual(before);
  },
);

it('PJ09 observes uncontended common and inner locks with read-only identities and no schema/history creation', async () => {
  const before = await f.snapshot();
  const p = await open('cms');
  expect((await p.acquire()).status).toBe('held');
  expect((await p.innerLock()).status).toBe('observed');
  expect((await p.read()).status).toBe('observed');
  expect(p.facts().workQueries).toBe(1);
  await p.close();
  expect(await f.snapshot()).toEqual(before);
  expect(before.databases.every((d) => d.history.length === 0)).toBe(true);
});

it.each(['app', 'cms'] as const)(
  'PJ10 loses the actual coordinator while an independent %s read completes, but refuses that result and new work',
  async (origin) => {
    const before = await f.snapshot();
    const p = await open(origin);
    expect((await p.acquire()).status).toBe('held');
    const work = p.slowRead();
    await waitForSleep(p);
    const identity = p.facts().coordinator;
    const actual = (
      await f.root.query(
        "SELECT datname,usename,application_name FROM pg_stat_activity WHERE pid=$1 AND backend_type='client backend'",
        [identity.pid],
      )
    ).rows[0];
    expect(actual).toEqual({
      datname: identity.database,
      usename: identity.role,
      application_name: identity.application,
    });
    expect(identity.application).toMatch(/^tt-coordination-proof:[a-f0-9]{16}:coord$/);
    expect(
      (
        await f.root.query(
          "SELECT pg_terminate_backend(pid) AS stopped FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3 AND application_name=$4 AND backend_type='client backend'",
          [identity.pid, identity.database, identity.role, identity.application],
        )
      ).rows[0].stopped,
    ).toBe(true);
    expect(
      (
        await f.root.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active' AND wait_event='PgSleep'",
          [p.facts().work.pid],
        )
      ).rowCount,
    ).toBe(1);
    expect(await work).toMatchObject({
      status: 'refused',
      reason: 'coordination-lost',
      workCompleted: true,
      targetFencing: false,
    });
    measured.lostWorkCompletions++;
    const count = p.facts().workQueries;
    expect(await p.read()).toMatchObject({ status: 'refused', workCompleted: false });
    expect(p.facts().workQueries).toBe(count);
    await p.close();
    const fresh = await open(origin);
    expect((await fresh.acquire()).status).toBe('held');
    expect((await fresh.read()).status).toBe('observed');
    await fresh.close();
    expect(await f.snapshot()).toEqual(before);
  },
);

it('refuses reuse after normal closure and closes actual sessions rather than retaining an admission receipt', async () => {
  const before = await f.snapshot();
  const p = await open('app');
  await p.acquire();
  await p.close();
  expect((await p.acquire()).status).toBe('refused');
  expect(await p.read()).toMatchObject({ status: 'refused', workCompleted: false });
  expect(p.facts().workQueries).toBe(0);
  expect(await f.snapshot()).toEqual(before);
});

it('refuses expanded or redirected input before creating any new PostgreSQL session', async () => {
  const before = await f.snapshot();
  for (const patch of [{ sql: 'SELECT private' }, { pid: 123 }, { mode: 'hosted' }])
    await expect(openParticipant({ ...plan('app'), ...patch })).rejects.toThrow(
      /^Read-only coordination proof refused$/,
    );
  expect(
    (
      await f.root.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'tt-coordination-proof:%'",
      )
    ).rows[0].n,
  ).toBe(0);
  expect(await f.snapshot()).toEqual(before);
});

it('cleanup waits for an owned in-flight read and discards its result without pretending to cancel it', async () => {
  const before = await f.snapshot();
  const p = await open('cms');
  await p.acquire();
  const work = p.slowRead();
  await waitForSleep(p);
  const closing = p.close();
  expect(await work).toMatchObject({ status: 'refused', workCompleted: true });
  await closing;
  expect(await f.snapshot()).toEqual(before);
});

it('refuses an environment change after allocation before sending another fixed work query', async () => {
  const before = await f.snapshot();
  const p = await open('app');
  expect((await p.acquire()).status).toBe('held');
  const original = process.env.APP_ENV;
  try {
    process.env.APP_ENV = 'stage-local';
    expect(await p.read()).toMatchObject({ status: 'refused', workCompleted: false });
    expect(p.facts().workQueries).toBe(0);
  } finally {
    process.env.APP_ENV = original;
    await p.close();
  }
  expect(await f.snapshot()).toEqual(before);
});

it('closes the already connected coordinator when the second channel refuses its invalid TLS authority', async () => {
  const before = await f.snapshot();
  const p = plan('cms');
  await expect(
    openParticipant({
      ...p,
      inputs: { app: p.inputs.app, cms: { ...p.inputs.cms, ca: 'invalid-fixture-ca' } },
    }),
  ).rejects.toThrow(/^Read-only coordination proof refused$/);
  expect(
    (
      await f.root.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'tt-coordination-proof:%'",
      )
    ).rows[0].n,
  ).toBe(0);
  expect(await f.snapshot()).toEqual(before);
});

it('invalidates an allocation acknowledgement if the environment changes while its SQL request is pending', async () => {
  const before = await f.snapshot();
  const p = await open('cms');
  const original = process.env.APP_ENV;
  try {
    const pending = p.acquire();
    process.env.APP_ENV = 'stage-local';
    expect((await pending).status).toBe('refused');
    expect(p.facts().workQueries).toBe(0);
  } finally {
    process.env.APP_ENV = original;
    await p.close();
  }
  expect(await f.snapshot()).toEqual(before);
});

it('bounds competing reads locally and emits technical evidence without lifecycle or provider effects', async () => {
  const before = await f.snapshot();
  const p = await open('app');
  await p.acquire();
  const work = p.slowRead();
  await waitForSleep(p);
  expect(await p.read()).toMatchObject({ status: 'refused', reason: 'busy', workCompleted: false });
  expect((await work).status).toBe('observed');
  expect(p.facts().workQueries).toBe(1);
  await p.close();
  expect(await f.snapshot()).toEqual(before);
  expect(measured).toEqual({
    commonRefusals: 2,
    separateDatabaseGrants: 2,
    innerTimeouts: 2,
    lostWorkCompletions: 2,
  });
  const sessions = coordinationDiagnostics();
  expect(sessions).toEqual({ opened: 45, ended: 45 });
  console.log(
    'READONLY_COORDINATION_EVIDENCE ' +
      JSON.stringify({
        scope: 'disposable-readonly-coordination',
        measured,
        sessions,
        probeTransactionsReadOnly: true,
        readOnlyWorkQueries: true,
        existingDisposableSetup: true,
        sqlExecuted: true,
        actualCoordinatorSessionLoss: true,
        lifecycleMutationDispatches: 0,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        productionPolicyChanged: false,
        independentDurability: false,
        authenticated: false,
        targetFencing: false,
        runtimeAdmission: false,
        hostedAccepted: false,
        productActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
