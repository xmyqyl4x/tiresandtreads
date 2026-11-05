import { setTimeout as delay } from 'node:timers/promises';
import { createLimiterRepository } from '../../packages/db/src/repositories/limiter.ts';
import { createQuotaCrypto } from '../../packages/integrations/src/analytics-crypto.ts';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { callbackApiFixture } from '../fixtures/http/callback-api.ts';
import { fixtureReportServices } from '../fixtures/http/report-services.ts';
import { publicOwnerRoutes } from '../../packages/integrations/src/http/public-owner.ts';
import { createReferenceQuery } from '../../packages/application/src/queries/reference.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import { uid, time } from '../fixtures/private/database.ts';
let f: Awaited<ReturnType<typeof callbackApiFixture>>;
beforeAll(async () => {
  f = await callbackApiFixture(async ({ db, services }) => {
    const { reports, crypto } = fixtureReportServices(db, { current: true });
    services.reports = reports;
    return publicOwnerRoutes({
      reports,
      shareKeys: (t) => crypto.lookup('share', t),
      lookup: createReferenceQuery(db.readScope.unitOfWork, db.catalog),
      content: async () => ok({ coverage: 'unavailable' }),
      download: async () => fail(failure('not_found')),
    });
  });
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
it('runs bounded report, consented analytics, registered import, SQL limiter and denied-ad work together and checks durable outcomes', async () => {
  const who = await f.session(),
    staff = await f.staff('data_operator'),
    before = (await (await f.call('/consent/browser?cmpAvailable=true', who)).json()).data;
  expect(
    (
      await f.call(
        '/consent/browser',
        who,
        {
          expectedRevision: before.revision,
          allowed: ['analytics'],
          gpc: false,
          notices: {
            necessary: f.notices.necessary,
            analytics: f.notices.analytics,
            ads: f.notices.ads,
            targeted_ads: f.notices.targeted_ads,
          },
        },
        uid('command'),
      )
    ).status,
  ).toBe(200);
  const grant = (
    await (
      await f.call('/analytics/grants', who, { channel: 'web', cmpAvailable: true }, uid('command'))
    ).json()
  ).data;
  expect(grant.status).toBe('issued');
  const artifact = await f.artifact(),
    reportIds: string[] = [],
    eventIds: string[] = [],
    importIds: string[] = [],
    measurements: { lane: string; ms: number }[] = [];
  const tasks: { lane: string; run: () => Promise<void> }[] = [];
  for (let i = 0; i < 4; i++) {
    tasks.push({
      lane: 'report',
      run: async () => {
        const r = await f.call('/reports', who, engineFixture().request, uid('command'));
        expect(r.status, await r.clone().text()).toBe(200);
        reportIds.push((await r.json()).data.report_id);
      },
    });
    tasks.push({
      lane: 'analytics',
      run: async () => {
        const id = uid('event');
        eventIds.push(id);
        const r = await fetch(f.server.origin + '/api/v1/collect', {
          method: 'POST',
          headers: {
            origin: f.server.origin,
            authorization: 'Bearer ' + grant.token,
            'content-type': 'application/json',
            'x-tt-cmp-available': 'true',
          },
          body: JSON.stringify({
            events: [{ id, name: 'public_page_view', occurredAt: time(), route: '/', props: {} }],
          }),
        });
        expect(r.status).toBe(202);
      },
    });
    if (i < 2)
      tasks.push({
        lane: 'import',
        run: async () => {
          const r = await f.call(
            '/staff/imports/prepare',
            staff,
            { artifactId: artifact },
            uid('command'),
          );
          expect(r.status, await r.clone().text()).toBe(200);
          importIds.push((await r.json()).data.id);
        },
      });
    tasks.push({
      lane: 'limiter',
      run: async () => {
        expect(
          (await f.analytics.admission.admit('analytics', { ip: '192.0.2.' + (100 + i) })).ok,
        ).toBe(true);
      },
    });
    tasks.push({
      lane: 'ads',
      run: async () => {
        const r = await f.commercial.adsTxt();
        expect(r).toMatchObject({ ok: true, value: { status: 'not_connected', body: '' } });
      },
    });
  }
  const started = performance.now();
  let active = 0,
    peak = 0;
  for (let at = 0; at < tasks.length; at += 4) {
    const results = await Promise.allSettled(
      tasks.slice(at, at + 4).map(async (task) => {
        active++;
        peak = Math.max(peak, active);
        const begin = performance.now();
        try {
          await task.run();
        } finally {
          active--;
          measurements.push({ lane: task.lane, ms: performance.now() - begin });
        }
      }),
    );
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  expect(active).toBe(0);
  expect(peak).toBe(4);
  expect(reportIds).toHaveLength(4);
  const saved = await f.db.admin.query(
    'SELECT count(*)::int AS n FROM app.report_versions WHERE report_id=ANY($1::uuid[])',
    [reportIds],
  );
  expect(saved.rows[0].n).toBe(4);
  const events = await f.db.admin.query(
    'SELECT count(*)::int AS n FROM analytics.events WHERE id=ANY($1::uuid[])',
    [eventIds],
  );
  expect(events.rows[0].n).toBe(4);
  for (const id of importIds)
    expect((await f.call('/staff/imports/' + id, staff)).status).toBe(200);
  const sorted = measurements.map((x) => x.ms).sort((a, b) => a - b),
    elapsedMs = performance.now() - started;
  console.log(
    'LOCAL_PRODUCT_MIXED_LOAD ' +
      JSON.stringify({
        operations: tasks.length,
        lanes: Object.fromEntries(
          ['report', 'analytics', 'import', 'limiter', 'ads'].map((k) => [
            k,
            measurements.filter((x) => x.lane === k).length,
          ]),
        ),
        peakConcurrency: peak,
        elapsedMs,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        p99Ms: sorted.at(-1),
        rssBytes: process.memoryUsage().rss,
        approvedProductionSLA: false,
        actualRecipientNotifications: 0,
        productionActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
  expect(f.providerCalls()).toBe(0);
}, 45000);
it('rejects cross-owner, forged CSRF, staff impersonation and arbitrary import paths without exposing tokens or raw errors', async () => {
  const who = await f.session(),
    other = await f.session(),
    created = await f.call('/reports', who, engineFixture().request, uid('command'));
  expect(created.status).toBe(200);
  const id = (await created.json()).data.report_id,
    rawOwnerToken = who.cookie.slice('tt_owner='.length);
  expect(rawOwnerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await f.call('/reports/' + id, { csrf: '', bearer: rawOwnerToken })).status).toBe(200);
  const checks = [
    await f.call('/reports/' + id, other),
    await f.call('/reports', { ...who, csrf: 'forged' }, engineFixture().request, uid('command')),
    await f.call('/staff/queues/imports', who),
    await f.call('/staff/imports/prepare', await f.staff('data_operator'), {
      path: 'C:/private/must-not-open',
    }),
  ];
  for (const r of checks) {
    expect(r.status).toBeGreaterThanOrEqual(400);
    const body = await r.text();
    for (const secret of [
      who.cookie,
      rawOwnerToken,
      who.csrf,
      id,
      'C:/private',
      'postgres://',
      'stack',
      'fixture-secret',
    ])
      expect(body).not.toContain(secret);
  }
  expect(f.observationsTruncated).toBe(false);
  const logs = JSON.stringify(f.observations);
  for (const secret of [who.cookie, rawOwnerToken, who.csrf, id])
    expect(logs).not.toContain(secret);
});
it('enforces a real SQL quota under concurrent pressure and leaves unrelated reads usable', async () => {
  const scope = f.db.adapter('tt_limiter_runtime'),
    limiter = createLimiterRepository(scope, ['http-v1']),
    crypto = createQuotaCrypto({ 'http-v1': new Uint8Array(32).fill(99) });
  // Insert one independent fixture policy; never edit or disable an immutable existing policy.
  await f.db.admin.query(
    "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES('local_product_overload','1',60,2,true)",
  );
  async function sqlClock() {
    const seconds = Number(
      (await f.db.admin.query('SELECT extract(epoch FROM clock_timestamp()) AS seconds')).rows[0]
        .seconds,
    );
    expect(Number.isFinite(seconds)).toBe(true);
    return { window: Math.floor(seconds / 60), remainingMs: (60 - (seconds % 60)) * 1000 };
  }
  let completed = false;
  // Never retry service failures or a wrong quota result. Retry only a measured SQL window crossing.
  for (let attempt = 0; attempt < 3; attempt++) {
    let before = await sqlClock();
    if (before.remainingMs <= 10000) {
      await delay(Math.ceil(before.remainingMs) + 50);
      before = await sqlClock();
    }
    if (before.remainingMs <= 10000) continue;
    const keys = crypto.keys('ip', '198.51.100.' + (42 + attempt)),
      outcomes = await Promise.all(
        Array.from({ length: 8 }, () =>
          scope.unitOfWork.run(async (tx) =>
            ok(
              await limiter.consume(tx, [{ policy: 'local_product_overload', version: '1', keys }]),
            ),
          ),
        ),
      ),
      after = await sqlClock();
    expect(outcomes.every((r) => r.ok)).toBe(true);
    if (before.window !== after.window) {
      console.log(
        'LOCAL_QUOTA_WINDOW_RETRY ' +
          JSON.stringify({ attempt: attempt + 1, measuredSqlWindowCrossing: true }),
      );
      continue;
    }
    const buckets = await f.db.admin.query(
      "SELECT floor(extract(epoch FROM window_start)/60)::bigint::text AS window,used FROM app.rate_limit_buckets WHERE policy_key='local_product_overload' AND policy_version='1' AND key_version='http-v1' AND principal_hmac=decode($1,'hex')",
      [keys[0]!.digest],
    );
    expect(buckets.rows).toEqual([{ window: String(before.window), used: 2 }]);
    expect(outcomes.filter((r) => r.ok && r.value.allowed)).toHaveLength(2);
    expect(outcomes.filter((r) => r.ok && !r.value.allowed)).toHaveLength(6);
    console.log(
      'LOCAL_QUOTA_WINDOW_EVIDENCE ' +
        JSON.stringify({
          attempts: attempt + 1,
          maximumAttempts: 3,
          sqlWindowStable: true,
          allowed: 2,
          denied: 6,
          independentFixturePolicy: true,
          actualRecipientNotifications: 0,
          productionActivation: false,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
    completed = true;
    break;
  }
  expect(completed, 'No stable SQL-window proof completed within the bounded attempts').toBe(true);
  expect((await f.call('/reference?kind=domainEntityVersions')).status).toBe(200);
  expect(f.providerCalls()).toBe(0);
}, 45000);
