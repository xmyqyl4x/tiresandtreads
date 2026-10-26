import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { privateFixture, uid, time, key, success } from '../fixtures/private/database.ts';
import { createAnalyticsRuntime } from '../../packages/integrations/src/analytics-runtime.ts';
import {
  createCollectionCrypto,
  createQuotaCrypto,
} from '../../packages/integrations/src/analytics-crypto.ts';
import { createAnalyticsRepository } from '../../packages/db/src/repositories/analytics.ts';
import { createWorkloadPools } from '../../packages/integrations/src/workload-pools.ts';
import { workloadRoles, type Workload } from '../../packages/config/src/workloads.ts';
import { ok, type Result } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof privateFixture>>,
  counter = 0;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
beforeEach(async () => {
  await f.admin.query(
    'TRUNCATE analytics.events,analytics.daily_metrics,analytics.dirty_days,analytics.processing_restrictions,analytics.replay_barriers',
  );
  await f.admin.query('DELETE FROM app.rate_limit_buckets');
  await f.admin.query('UPDATE app.rate_limit_policies SET enabled=true');
});
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
const crypto = createCollectionCrypto(
  'c1',
  { c1: new Uint8Array(32).fill(8) },
  new Uint8Array(32).fill(9),
);
const quotaCrypto = createQuotaCrypto({ old: new Uint8Array(32).fill(7) });
async function setup() {
  const owner = await f.owner(),
    noticeId = await f.notice('analytics');
  const scopes = {
    report: f.scope,
    collector: f.adapter('tt_analytics_runtime'),
    aggregate: f.adapter('tt_analytics_runtime'),
    limiter: f.adapter('tt_limiter_runtime'),
    operations: f.adapter('tt_operations_runtime'),
  };
  const options = {
    scopes,
    crypto,
    quotaCrypto,
    enabled: true,
    policy: 'synthetic',
    noticeId,
    now: () => time(),
  };
  const runtime = await createAnalyticsRuntime(options),
    signals = {
      gpc: false,
      cmpAvailable: true,
      bot: 'not_flagged' as const,
      ip: '192.0.2.' + ++counter,
    };
  async function consent(action: 'confirm' | 'withdraw' = 'confirm', expiresAt = time(3600000)) {
    return success(f.scope.unitOfWork, async (tx) => {
      const p = await f.privacy.permission(tx, owner.identity.subjectId, 'analytics', 'site');
      return f.privacy.consent(tx, {
        id: uid('consent_event'),
        subjectId: owner.identity.subjectId,
        purpose: 'analytics',
        scope: 'site',
        expectedRevision: p.revision,
        action,
        noticeId,
        policyVersion: 'synthetic',
        method: 'fixture',
        expiresAt: action === 'withdraw' ? null : expiresAt,
      });
    });
  }
  await consent();
  const token = value(await runtime.analytics.issue([owner.token], signals));
  if (token.status !== 'issued') throw Error('No token');
  const event = () => ({
    id: uid('event'),
    name: 'public_page_view',
    occurredAt: time(),
    route: '/',
    props: {},
  });
  const raw = (events = [event()]) => JSON.stringify({ events });
  const repo = createAnalyticsRepository(scopes.aggregate);
  return {
    ...runtime,
    owner,
    noticeId,
    scopes,
    options,
    signals,
    consent,
    token: token.token,
    event,
    raw,
    repo,
  };
}
it('UC08 accepts one committed batch, deduplicates replay across context refresh and hides all private fields', async () => {
  const s = await setup(),
    raw = s.raw();
  const results = await Promise.all([
    s.analytics.collect(s.token, raw, s.signals),
    s.analytics.collect(s.token, raw, s.signals),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(
    results
      .map((r) => value(r))
      .map((x) => ('inserted' in x ? x.inserted : 0))
      .sort(),
  ).toEqual([0, 1]);
  const refreshed = value(await s.analytics.issue([s.owner.token], s.signals));
  if (refreshed.status !== 'issued') throw Error('No token');
  expect(value(await s.analytics.collect(refreshed.token, raw, s.signals))).toMatchObject({
    status: 'accepted',
    inserted: 0,
  });
  const rows = await f.admin.query('SELECT * FROM analytics.events');
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].subject_id).toBe(s.owner.identity.subjectId);
  expect(JSON.stringify(rows.rows)).not.toContain(s.signals.ip);
});
it('refuses revoked/forged context, GPC and unavailable CMP without behavioral storage', async () => {
  const s = await setup();
  for (const signals of [
    { ...s.signals, gpc: true },
    { ...s.signals, cmpAvailable: false },
  ]) {
    expect(value(await s.analytics.issue([s.owner.token], signals)).status).toBe('refused');
    expect(value(await s.analytics.collect(s.token, s.raw(), signals)).status).toBe('refused');
  }
  expect(value(await s.analytics.issue([key()], s.signals)).status).toBe('refused');
  expect(value(await s.analytics.collect('forged', s.raw(), s.signals)).status).toBe('refused');
  await s.consent('withdraw');
  expect(value(await s.analytics.collect(s.token, s.raw(), s.signals)).status).toBe('refused');
  expect((await f.admin.query('SELECT * FROM analytics.events')).rows).toHaveLength(0);
});
it('disabled collection and changed policy fail closed before receipt', async () => {
  const s = await setup(),
    off = await createAnalyticsRuntime({ ...s.options, enabled: false }),
    changed = await createAnalyticsRuntime({ ...s.options, policy: 'next' });
  expect(value(await off.analytics.issue([s.owner.token], s.signals)).status).toBe('refused');
  expect(value(await off.analytics.collect(s.token, s.raw(), s.signals)).status).toBe('refused');
  expect(value(await changed.analytics.collect(s.token, s.raw(), s.signals)).status).toBe(
    'refused',
  );
});
it('rejects client bot/PII fields and digest conflicts, while accepted admission survives receipt failure', async () => {
  const s = await setup(),
    event = s.event(),
    raw = s.raw([event]);
  value(await s.analytics.collect(s.token, raw, s.signals));
  expect(
    (
      await s.analytics.collect(
        s.token,
        JSON.stringify({ events: [{ ...event, bot: 'not_flagged' }] }),
        s.signals,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await s.analytics.collect(
        s.token,
        s.raw([{ ...event, props: { outcome: 'success' } as never }]),
        s.signals,
      )
    ).ok,
  ).toBe(false);
  expect(
    (await f.admin.query("SELECT used FROM app.rate_limit_buckets WHERE policy_key='analytics_ip'"))
      .rows[0].used,
  ).toBe(2);
});
it('withdrawal hides published metrics, fences old work, purges in batches and prevents old replay after regrant', async () => {
  const s = await setup(),
    raw = s.raw([s.event(), s.event()]);
  value(await s.analytics.collect(s.token, raw, s.signals));
  value(await s.analytics.rebuildOne());
  const old = await success(s.scopes.aggregate.unitOfWork, async (tx) => {
    await s.scopes.aggregate.query(
      tx,
      'SELECT analytics.invalidate_days(ARRAY[current_date],false)',
    );
    return s.repo.capture(tx, 60);
  });
  if (!old) throw Error('No build');
  await s.consent('withdraw');
  expect((await f.admin.query('SELECT * FROM analytics.visible_daily_metrics')).rows).toHaveLength(
    0,
  );
  expect(
    (
      await s.scopes.aggregate.unitOfWork.run(async (tx) => {
        await s.repo.publish(tx, old);
        return ok(null);
      })
    ).ok,
  ).toBe(false);
  expect(value(await s.analytics.maintenance(1)).withdrawn).toBe(1);
  await s.consent();
  expect(value(await s.analytics.issue([s.owner.token], s.signals)).status).toBe('refused');
  expect(value(await s.analytics.maintenance(1)).withdrawn).toBe(1);
  const token = value(await s.analytics.issue([s.owner.token], s.signals));
  if (token.status !== 'issued') throw Error('No token');
  expect(value(await s.analytics.collect(token.token, raw, s.signals)).status).toBe('refused');
  const redated = JSON.parse(raw);
  for (const e of redated.events) e.occurredAt = time();
  expect(
    value(await s.analytics.collect(token.token, JSON.stringify(redated), s.signals)).status,
  ).toBe('refused');
  value(await s.analytics.rebuildOne());
  expect((await f.admin.query('SELECT * FROM analytics.events')).rows).toHaveLength(0);
  expect((await f.admin.query('SELECT * FROM analytics.visible_daily_metrics')).rows).toHaveLength(
    0,
  );
});
it('denies suppression even when added before first collection', async () => {
  const s = await setup();
  await success(f.scope.unitOfWork, (tx) =>
    f.privacy.suppress(tx, {
      subjectId: s.owner.identity.subjectId,
      scope: 'analytics',
      reason: 'withdrawn',
      expiresAt: null,
    }),
  );
  expect(value(await s.analytics.collect(s.token, s.raw(), s.signals)).status).toBe('refused');
});
it('published validity never outlives the consent deadline and maintenance rebuild excludes expired rows', async () => {
  const s = await setup();
  const deadline = time(3600000);
  await s.consent('confirm', deadline);
  const t = value(await s.analytics.issue([s.owner.token], s.signals));
  if (t.status !== 'issued') throw Error('No token');
  value(await s.analytics.collect(t.token, s.raw(), s.signals));
  value(await s.analytics.rebuildOne());
  expect(
    (await f.admin.query('SELECT * FROM analytics.visible_daily_metrics')).rows.length,
  ).toBeGreaterThan(0);
  expect(
    (
      await f.admin.query('SELECT valid_until FROM analytics.daily_metrics LIMIT 1')
    ).rows[0].valid_until.toISOString(),
  ).toBe(deadline);
  // Migration-owner clock fixture; real runtime time/deadline constraints remain enabled.
  await f.admin.query(
    "UPDATE analytics.daily_metrics SET valid_until=clock_timestamp()-interval '1 second'",
  );
  expect((await f.admin.query('SELECT * FROM analytics.visible_daily_metrics')).rows).toHaveLength(
    0,
  );
  expect(value(await s.analytics.maintenance()).invalidatedDays).toBe(1);
  await f.admin.query(
    "UPDATE privacy.consent_state SET effective_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE subject_id=$1 AND purpose='analytics' AND scope_key='site'",
    [s.owner.identity.subjectId],
  );
  value(await s.analytics.rebuildOne());
  expect((await f.admin.query('SELECT * FROM analytics.daily_metrics')).rows).toHaveLength(0);
});
it('shortening a confirmed consent deadline invalidates a captured generation', async () => {
  const s = await setup();
  value(await s.analytics.collect(s.token, s.raw(), s.signals));
  const captured = await success(s.scopes.aggregate.unitOfWork, (tx) => s.repo.capture(tx, 60));
  if (!captured) throw Error('No build');
  await s.consent('confirm', time(10000));
  expect(
    (
      await s.scopes.aggregate.unitOfWork.run(async (tx) => {
        await s.repo.publish(tx, captured);
        return ok(null);
      })
    ).ok,
  ).toBe(false);
});
it('quota races across email/hour/day/IP/burst admit only the bounded common last slots', async () => {
  const s = await setup();
  const started = performance.now();
  const result = await Promise.all(
    Array.from({ length: 24 }, () =>
      s.admission.admit('report_delivery', {
        ip: s.signals.ip,
        email: 'fixture@example.invalid',
      }),
    ),
  );
  expect(result.every((r) => r.ok)).toBe(true);
  const accepted = result.filter((r) => r.ok && r.value.allowed).length;
  const hours = (
    await f.admin.query(
      "SELECT used,limit_value FROM app.rate_limit_buckets WHERE policy_key='report_email' AND window_seconds=3600",
    )
  ).rows;
  expect(accepted).toBe(hours.reduce((sum, r) => sum + Number(r.used), 0));
  expect(accepted).toBeGreaterThanOrEqual(3);
  expect(accepted).toBeLessThan(24);
  expect(hours.every((r) => r.used <= r.limit_value && r.limit_value === 3)).toBe(true);
  console.log(
    'QUOTA_LOAD_EVIDENCE',
    JSON.stringify({ concurrentAttempts: 24, accepted, elapsedMs: performance.now() - started }),
  );
});
it('bucket capacity exhaustion rolls back every window and leaves the row budget exact', async () => {
  const s = await setup();
  await f.admin.query('UPDATE app.rate_limit_capacity SET max_rows=1');
  try {
    expect(
      (
        await s.admission.admit('report_delivery', {
          ip: s.signals.ip,
          email: 'fixture@example.invalid',
        })
      ).ok,
    ).toBe(false);
    expect(
      (await f.admin.query('SELECT used_rows FROM app.rate_limit_capacity')).rows[0].used_rows,
    ).toBe(0);
  } finally {
    await f.admin.query('UPDATE app.rate_limit_capacity SET max_rows=100000');
  }
});
it('rotation aliases preserve existing counts and an unsafe key retirement is rejected', async () => {
  const s = await setup();
  for (let i = 0; i < 3; i++)
    value(
      await s.admission.admit('report_delivery', {
        ip: s.signals.ip,
        email: 'driver@example.invalid',
      }),
    );
  const nextQuota = createQuotaCrypto({
    old: new Uint8Array(32).fill(7),
    next: new Uint8Array(32).fill(6),
  });
  const overlap = await createAnalyticsRuntime({ ...s.options, quotaCrypto: nextQuota });
  expect(
    value(
      await overlap.admission.admit('report_delivery', {
        ip: s.signals.ip,
        email: 'DRIVER@example.invalid',
      }),
    ).allowed,
  ).toBe(false);
  await expect(
    createAnalyticsRuntime({
      ...s.options,
      quotaCrypto: createQuotaCrypto({ next: new Uint8Array(32).fill(6) }),
    }),
  ).rejects.toThrow('Invalid quota rotation coverage');
});
it('cleanup is bounded and quota reads use current windows even before old rows are swept', async () => {
  const s = await setup();
  value(
    await s.admission.admit('report_delivery', {
      ip: s.signals.ip,
      email: 'driver@example.invalid',
    }),
  );
  await f.admin.query(
    "UPDATE app.rate_limit_buckets SET window_start=window_start-interval '2 days',expires_at=expires_at-interval '2 days'",
  );
  expect(
    value(
      await s.admission.admit('report_delivery', {
        ip: s.signals.ip,
        email: 'driver@example.invalid',
      }),
    ).allowed,
  ).toBe(true);
  expect(value(await s.admission.cleanup(1))).toBe(1);
  expect(
    (await f.admin.query('SELECT used_rows FROM app.rate_limit_capacity')).rows[0].used_rows,
  ).toBe(
    (await f.admin.query('SELECT count(*)::integer AS n FROM app.rate_limit_buckets')).rows[0].n,
  );
  expect((await s.admission.cleanup(1001)).ok).toBe(false);
});
it('collector exhaustion returns a bounded retry time and does not create a false accepted receipt', async () => {
  const s = await setup();
  for (let n = 0; n < 60; n++) value(await s.admission.admit('analytics', { ip: s.signals.ip }));
  expect(value(await s.analytics.collect(s.token, s.raw(), s.signals))).toMatchObject({
    status: 'limited',
    retryAfterSeconds: expect.any(Number),
  });
  expect((await f.admin.query('SELECT * FROM analytics.events')).rows).toHaveLength(0);
});
it('dashboard authorizes staff, exposes daily grain/freshness and uses only bounded operational counts', async () => {
  const s = await setup();
  value(await s.analytics.collect(s.token, s.raw(), s.signals));
  value(await s.analytics.rebuildOne());
  expect((await s.operations.dashboard(f.staff, time().slice(0, 10))).ok).toBe(false);
  await f.admin.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='operations_read'",
    [f.staff],
  );
  const dto = value(await s.operations.dashboard(f.staff, time().slice(0, 10)));
  expect(dto).toMatchObject({
    events: { value: '1', pending: false },
    dailyDistinctSessions: { value: '1' },
    coverage: 'consented traffic only',
    health: { capped: false },
  });
  expect(JSON.stringify(dto)).not.toContain(s.owner.identity.subjectId);
  expect((await s.operations.dashboard(f.staff, 'bad')).ok).toBe(false);
});
it('real workload pools isolate aggregate connection saturation from the report lane and enforce total capacity', async () => {
  const names = Object.keys(workloadRoles) as Workload[];
  const plan = {
    urls: Object.fromEntries(names.map((n) => [n, f.connectionUrl(workloadRoles[n])])) as Record<
      Workload,
      string
    >,
    max: Object.fromEntries(names.map((n) => [n, 1])) as Record<Workload, number>,
    replicas: 1,
    otherConnections: 0,
    reserve: 10,
  };
  const runtime = await createWorkloadPools(plan);
  try {
    let opened!: () => void;
    const ready = new Promise<void>((r) => {
      opened = r;
    });
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const busy = runtime.scopes.aggregate.unitOfWork.run(async (tx) => {
      await runtime.scopes.aggregate.query(tx, 'SELECT 1');
      opened();
      await hold;
      return ok(null);
    });
    await ready;
    const started = performance.now();
    expect(
      await runtime.scopes.report.unitOfWork.run(async (tx) =>
        ok((await runtime.scopes.report.query(tx, 'SELECT 1 AS n')).rows[0]!.n),
      ),
    ).toMatchObject({ ok: true, value: 1 });
    release();
    await busy;
    console.log(
      'WORKLOAD_ISOLATION_EVIDENCE',
      JSON.stringify({
        requiredConnections: runtime.requiredConnections,
        reportElapsedMs: performance.now() - started,
        heldAggregateConnections: 1,
      }),
    );
  } finally {
    await runtime.shutdown();
  }
  await expect(createWorkloadPools({ ...plan, otherConnections: 10000 })).rejects.toThrow(
    'Workload runtime unavailable',
  );
});
it('public roles cannot read raw analytics, restrictions, operational health or quota identities', async () => {
  const scope = f.adapter('tt_app_runtime');
  for (const table of [
    'analytics.events',
    'analytics.processing_restrictions',
    'analytics.current_permissions',
    'admin.runtime_health',
    'app.rate_limit_capacity',
  ])
    expect(
      (
        await scope.unitOfWork.run(async (tx) =>
          ok((await scope.query(tx, 'SELECT * FROM ' + table)).rows),
        )
      ).ok,
    ).toBe(false);
});
