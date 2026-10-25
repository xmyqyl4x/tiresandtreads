import { beforeAll, afterAll, it, expect } from 'vitest';
import { privateFixture, uid, time, key, success, result } from '../fixtures/private/database.ts';
import {
  createContentPublicationRepository,
  createPublicReadRepository,
} from '../../packages/db/src/repositories/content.ts';
import { createAnalyticsRepository } from '../../packages/db/src/repositories/analytics.ts';
import { createLimiterRepository } from '../../packages/db/src/repositories/limiter.ts';
import { createOperationsRepository } from '../../packages/db/src/repositories/operations.ts';
import { rev } from '../../packages/db/src/repositories/private-values.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
import type {
  AnalyticsEvent,
  AnalyticsBuild,
} from '../../packages/application/src/ports/analytics.ts';
import type { ContentPublication } from '../../packages/application/src/ports/publication.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
let writer: ReturnType<typeof f.adapter>,
  reader: typeof writer,
  analytics: typeof writer,
  limiter: typeof writer,
  dashboard: typeof writer;
let content: ReturnType<typeof createContentPublicationRepository>,
  publicRead: ReturnType<typeof createPublicReadRepository>,
  events: ReturnType<typeof createAnalyticsRepository>,
  quotas: ReturnType<typeof createLimiterRepository>,
  operations: ReturnType<typeof createOperationsRepository>;
beforeAll(async () => {
  f = await privateFixture();
  writer = f.adapter('tt_content_runtime');
  reader = f.adapter('tt_public_runtime');
  analytics = f.adapter('tt_analytics_runtime');
  limiter = f.adapter('tt_limiter_runtime');
  dashboard = f.adapter('tt_operations_runtime');
  content = createContentPublicationRepository(writer);
  publicRead = createPublicReadRepository(reader);
  events = createAnalyticsRepository(analytics);
  quotas = createLimiterRepository(limiter, ['old']);
  operations = createOperationsRepository(dashboard);
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
const conflict = { ok: false, error: { code: 'conflict' } };
function publication(generation = 1n): ContentPublication {
  return {
    key: uid('content_key'),
    locale: 'en-US',
    market: 'US',
    generation,
    cmsRevision: String(generation),
    publishedAt: time(-1000),
    expiresAt: time(3600000),
    content: {
      title: 'Tire care',
      summary: 'Reviewed facts',
      paragraphs: ['Synthetic public text.'],
    },
  };
}
it('publishes idempotently and prevents expired, withdrawn and out-of-order revisions resurrecting content', async () => {
  const a = publication();
  await success(writer.unitOfWork, (tx) => content.publish(tx, a));
  await success(writer.unitOfWork, (tx) => content.publish(tx, a));
  expect(await success(reader.unitOfWork, (tx) => publicRead.content(tx, a))).toEqual(a.content);
  expect(
    await result(writer.unitOfWork, (tx) =>
      content.publish(tx, { ...a, content: { ...a.content!, title: 'Changed' } }),
    ),
  ).toMatchObject(conflict);
  const withdrawn = { ...a, generation: 3n, cmsRevision: '3', content: null };
  await success(writer.unitOfWork, (tx) => content.publish(tx, withdrawn));
  await success(writer.unitOfWork, (tx) =>
    content.publish(tx, { ...a, generation: 2n, cmsRevision: '2' }),
  );
  expect(await success(reader.unitOfWork, (tx) => publicRead.content(tx, a))).toBeNull();
  await success(writer.unitOfWork, (tx) =>
    content.publish(tx, {
      ...a,
      generation: 4n,
      cmsRevision: '4',
      publishedAt: time(-10000),
      expiresAt: time(-1000),
    }),
  );
  expect(await success(reader.unitOfWork, (tx) => publicRead.content(tx, a))).toBeNull();
  expect(
    await result(writer.unitOfWork, (tx) =>
      content.publish(tx, {
        ...a,
        generation: 5n,
        cmsRevision: '5',
        content: { ...a.content!, secret: 'private' } as ContentPublication['content'],
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('publishes allowlisted public configuration with an immutable checksum and no expiry fallback', async () => {
  const c = {
    schemaVersion: 1 as const,
    revision: 1,
    issuedAt: time(-2000),
    expiresAt: time(3600000),
    analytics: false,
    advertising: false,
  };
  const snapshot = await success(writer.unitOfWork, (tx) => content.configure(tx, c, f.staff));
  expect(await success(reader.unitOfWork, (tx) => publicRead.configuration(tx))).toEqual(snapshot);
  expect(await success(writer.unitOfWork, (tx) => content.configure(tx, c, f.staff))).toEqual(
    snapshot,
  );
  expect(
    await result(writer.unitOfWork, (tx) =>
      content.configure(tx, { ...c, advertising: true }, f.staff),
    ),
  ).toMatchObject(conflict);
  await success(writer.unitOfWork, (tx) =>
    content.configure(tx, { ...c, revision: 2, expiresAt: time(-1000) }, f.staff),
  );
  expect(await success(reader.unitOfWork, (tx) => publicRead.configuration(tx))).toBeNull();
});
async function authorized() {
  const owner = await f.owner();
  const notice = await f.notice('analytics');
  const permission = await success(f.scope.unitOfWork, (tx) =>
    f.privacy.consent(tx, {
      subjectId: owner.identity.subjectId,
      expectedRevision: rev('1'),
      id: uid('consent_event'),
      purpose: 'analytics',
      action: 'confirm',
      scope: 'analytics',
      policyVersion: 'test-v1',
      method: 'synthetic',
      noticeId: notice,
      expiresAt: null,
    }),
  );
  return {
    subjectId: owner.identity.subjectId,
    permission: permission.revision,
    scope: 'analytics',
    policy: 'test-v1',
  };
}
function event(): AnalyticsEvent {
  return {
    id: uid('event'),
    name: 'public_page_view',
    occurredAt: time(),
    sessionId: uid('analytics_session'),
    market: 'US',
    locale: 'en-US',
    route: '/',
    channel: 'web',
    props: { outcome: 'success' },
    bot: 'not_flagged',
  };
}
async function build() {
  const candidates = await Promise.all(
    [1, 2].map(() => success(analytics.unitOfWork, (tx) => events.capture(tx, 60))),
  );
  const builds = candidates.filter((b) => b !== null);
  expect(builds).toHaveLength(1);
  return builds[0]!;
}
it('receipts parallel replay once, rejects changed bodies and stale permission, and dirties each batch day once', async () => {
  const c = await authorized(),
    e = event();
  const outcomes = await Promise.all(
    [1, 2].map(() => success(analytics.unitOfWork, (tx) => events.receive(tx, c, [e]))),
  );
  expect(outcomes.map((o) => o.inserted).sort()).toEqual([0, 1]);
  expect(
    await result(analytics.unitOfWork, (tx) => events.receive(tx, c, [{ ...e, route: '/assess' }])),
  ).toMatchObject(conflict);
  expect(
    await result(analytics.unitOfWork, (tx) =>
      events.receive(tx, { ...c, permission: rev('1') }, [event()]),
    ),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  const before = await f.admin.query('SELECT requested_revision FROM analytics.dirty_days');
  await success(analytics.unitOfWork, (tx) => events.receive(tx, c, [event(), event()]));
  const after = await f.admin.query('SELECT requested_revision FROM analytics.dirty_days');
  expect(BigInt(after.rows[0].requested_revision) - BigInt(before.rows[0].requested_revision)).toBe(
    1n,
  );
  expect(
    await result(analytics.unitOfWork, (tx) =>
      events.receive(tx, c, Array.from({ length: 51 }, event)),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('publishes a complete fenced generation while new intake remains pending, then replaces it exactly', async () => {
  const c = await authorized();
  await success(analytics.unitOfWork, (tx) => events.receive(tx, c, [event()]));
  const b = await build();
  await success(analytics.unitOfWork, (tx) => events.receive(tx, c, [event()]));
  await success(analytics.unitOfWork, (tx) => events.publish(tx, b));
  const m = await success(dashboard.unitOfWork, (tx) =>
    operations.metric(tx, b.day, 'events', 'US', 'all'),
  );
  expect(m).toMatchObject({
    generation: b.generation,
    pending: true,
    value: b.metrics.find((m) => m.metric === 'events' && m.dimension === 'all')!.value,
  });
  expect(await result(analytics.unitOfWork, (tx) => events.publish(tx, b))).toMatchObject(conflict);
  const next = await build();
  await success(analytics.unitOfWork, (tx) => events.publish(tx, next));
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.metric(tx, b.day, 'events', 'US', 'all'),
    ),
  ).toMatchObject({ pending: false });
  expect(await success(analytics.unitOfWork, (tx) => events.capture(tx, 60))).toBeNull();
});
it('hides generations immediately on subject restriction and fences a captured pre-erasure build', async () => {
  const c = await authorized();
  await success(analytics.unitOfWork, (tx) => events.receive(tx, c, [event(), event()]));
  const b = await build();
  await f.admin.query(
    "UPDATE app.subjects SET status='restricted',permission_revision=permission_revision+1 WHERE id=$1",
    [c.subjectId],
  );
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.metric(tx, b.day, 'events', 'US', 'all'),
    ),
  ).toBeNull();
  expect(await result(analytics.unitOfWork, (tx) => events.publish(tx, b))).toMatchObject(conflict);
  expect(
    await result(analytics.unitOfWork, (tx) => events.receive(tx, c, [event()])),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  await success(analytics.unitOfWork, (tx) => events.retry(tx, b));
  await f.admin.query('UPDATE analytics.dirty_days SET next_attempt_at=now()');
  const next = await build();
  await success(analytics.unitOfWork, (tx) => events.publish(tx, next));
  expect(await success(analytics.unitOfWork, (tx) => events.purgeSubject(tx, c.subjectId, 1))).toBe(
    1,
  );
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.metric(tx, b.day, 'events', 'US', 'all'),
    ),
  ).toBeNull();
  expect(
    await success(analytics.unitOfWork, (tx) => events.purgeSubject(tx, c.subjectId, 10)),
  ).toBe(1);
  const active = await authorized();
  expect(
    await result(analytics.unitOfWork, (tx) => events.purgeSubject(tx, active.subjectId, 10)),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
});
it('prevents snapshot drift when receipt commits after capture starts but before its row lock', async () => {
  const c = await authorized();
  await success(analytics.unitOfWork, (tx) =>
    events.receive(tx, c, [{ ...event(), channel: 'app' }]),
  );
  // A statement-level fixture barrier deterministically exposes READ COMMITTED row rechecks.
  await f.admin.query(
    `CREATE FUNCTION analytics.fixture_capture_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('tt.fixture_capture',true)='yes' THEN PERFORM pg_advisory_xact_lock(19012,1); END IF; RETURN NULL; END $$`,
  );
  await f.admin.query(
    'CREATE TRIGGER fixture_capture_barrier BEFORE UPDATE ON analytics.dirty_days FOR EACH STATEMENT EXECUTE FUNCTION analytics.fixture_capture_barrier()',
  );
  await f.admin.query('SELECT pg_advisory_lock(19012,1)');
  const pending = result(analytics.unitOfWork, async (tx) => {
    await analytics.query(tx, "SELECT set_config('tt.fixture_capture','yes',true)");
    return events.capture(tx, 60);
  });
  try {
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      blocked =
        (
          await f.admin.query(
            'SELECT 1 FROM pg_locks WHERE locktype=$$advisory$$ AND classid=19012 AND objid=1 AND NOT granted',
          )
        ).rowCount! > 0;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(blocked).toBe(true);
    await success(analytics.unitOfWork, (tx) =>
      events.receive(tx, c, [{ ...event(), channel: 'app' }]),
    );
  } finally {
    await f.admin.query('SELECT pg_advisory_unlock(19012,1)');
  }
  const captured = await pending;
  await f.admin.query('DROP TRIGGER fixture_capture_barrier ON analytics.dirty_days');
  await f.admin.query('DROP FUNCTION analytics.fixture_capture_barrier()');
  if (!captured.ok || !captured.value) throw Error('Capture fixture failed');
  await success(analytics.unitOfWork, (tx) => events.publish(tx, captured.value!));
  expect(
    captured.value.metrics.find((m) => m.metric === 'events' && m.dimension === 'app')!.value,
  ).toBe(2n);
});
it('expires worker fences, rolls back partial metric replacement, and cleans expired receipts in bounded batches', async () => {
  const c = await authorized();
  await success(analytics.unitOfWork, (tx) => events.receive(tx, c, [event()]));
  const b = await build();
  const forged = {
    ...b,
    metrics: [
      { metric: 'events', market: 'US', dimension: 'all', value: 1n },
      { metric: 'events', market: 'US', dimension: 'all', value: 2n },
    ],
  } as AnalyticsBuild;
  expect(await result(analytics.unitOfWork, (tx) => events.publish(tx, forged))).toMatchObject({
    ok: false,
  });
  await f.admin.query(
    "UPDATE analytics.dirty_days SET lease_until=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()-interval '2 seconds',created_at=clock_timestamp()-interval '3 seconds' WHERE day=$1",
    [b.day],
  );
  expect(await result(analytics.unitOfWork, (tx) => events.publish(tx, b))).toMatchObject(conflict);
  const next = await build();
  expect(next.token).not.toBe(b.token);
  await success(analytics.unitOfWork, (tx) => events.publish(tx, next));
  expect(await success(analytics.unitOfWork, (tx) => events.cleanup(tx, 10))).toBe(0);
});
async function policy(limit = 1) {
  const name = uid('quota');
  await f.admin.query(
    "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES($1,'1',3600,$2,true),($1,'1',86400,$2,true)",
    [name, limit],
  );
  return { policy: name, version: '1', keys: [key('old')] };
}
it('caps concurrent last-slot claims across every window and denies disabled or missing policies', async () => {
  const p = await policy();
  const outcomes = await Promise.all(
    [1, 2, 3].map(() => success(limiter.unitOfWork, (tx) => quotas.consume(tx, [p]))),
  );
  expect(outcomes.filter((x) => x.allowed)).toHaveLength(1);
  expect(
    outcomes.filter((x) => !x.allowed).every((x) => !x.allowed && x.retryAfterSeconds > 0),
  ).toBe(true);
  expect(
    (
      await f.admin.query('SELECT used FROM app.rate_limit_buckets WHERE policy_key=$1', [p.policy])
    ).rows.map((x) => x.used),
  ).toEqual([1, 1]);
  expect(
    await result(limiter.unitOfWork, (tx) =>
      quotas.consume(tx, [{ ...p, policy: 'report_email' }]),
    ),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(
    await result(limiter.unitOfWork, (tx) => quotas.consume(tx, [{ ...p, policy: 'missing' }])),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
});
it('rolls back all keys on a blocked window and carries existing usage through overlapping HMAC rotation', async () => {
  const p = await policy(2),
    other = await policy(1);
  await success(limiter.unitOfWork, (tx) => quotas.consume(tx, [other]));
  expect(await success(limiter.unitOfWork, (tx) => quotas.consume(tx, [p, other]))).toMatchObject({
    allowed: false,
  });
  expect(
    (await f.admin.query('SELECT * FROM app.rate_limit_buckets WHERE policy_key=$1', [p.policy]))
      .rowCount,
  ).toBe(0);
  await success(limiter.unitOfWork, (tx) => quotas.consume(tx, [p]));
  const rotated = createLimiterRepository(limiter, ['old', 'new']),
    rotatedPrincipal = { ...p, keys: [...p.keys, key('new')] };
  expect(
    await success(limiter.unitOfWork, (tx) => rotated.consume(tx, [rotatedPrincipal])),
  ).toEqual({ allowed: true });
  expect(await success(limiter.unitOfWork, (tx) => quotas.consume(tx, [p]))).toMatchObject({
    allowed: false,
  });
  expect(await result(limiter.unitOfWork, (tx) => rotated.consume(tx, [p]))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(await success(limiter.unitOfWork, (tx) => quotas.cleanup(tx, 10))).toBe(0);
});
it('restricts public and dashboard roles to projections, excluding contacts, raw events and credentials', async () => {
  for (const s of [reader, dashboard])
    for (const table of [
      'privacy.contacts',
      'analytics.events',
      'admin.configuration_versions',
      'admin.staff_identities',
      'app.rate_limit_buckets',
      'app.object_assets',
    ])
      expect(
        await result(s.unitOfWork, (tx) => s.query(tx, `SELECT * FROM ${table} LIMIT 1`)),
      ).toMatchObject({ ok: false });
  expect(await success(dashboard.unitOfWork, (tx) => operations.staff(tx, f.staff))).toEqual({
    active: true,
    roles: [],
  });
  expect(
    await success(dashboard.unitOfWork, (tx) => operations.staff(tx, uid('staff'))),
  ).toBeNull();
  expect(
    await success(dashboard.unitOfWork, (tx) => operations.configuration(tx, 'public_runtime')),
  ).toEqual({ version: 2, status: 'published' });
  const p = pageRequest(10, null);
  if (!p.ok) throw Error('fixture');
  expect(await success(dashboard.unitOfWork, (tx) => operations.pages(tx, p.value))).toEqual({
    items: [],
    next: null,
  });
  expect(
    await success(dashboard.unitOfWork, (tx) => operations.affiliate(tx, 'missing', 'US')),
  ).toBeNull();
  expect(await success(dashboard.unitOfWork, (tx) => operations.slots(tx, 'education'))).toEqual(
    [],
  );
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.search(tx, uid('seo_page'), '2026-10-01', 'search_console'),
    ),
  ).toBeNull();
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.ads(tx, uid('ad_account'), '2026-10-01', 'all', 'USD', 'finalized'),
    ),
  ).toBeNull();
});
it('preserves zero and missing search/ad values and excludes superseded complete report snapshots', async () => {
  const page = uid('seo_page'),
    account = uid('ad_account');
  await f.admin.query(
    "INSERT INTO admin.seo_page_registry(id,public_path,locale,market,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,'/learn/fixture','en-US','US','education',$2,now(),'eligible','/learn/fixture')",
    [page, f.staff],
  );
  await f.admin.query(
    "INSERT INTO admin.search_daily_metrics(page_id,day,source,clicks,impressions,position_sum,source_revision,fetched_at) VALUES($1,'2026-10-01','search_console',0,0,NULL,'1',now())",
    [page],
  );
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.search(tx, page, '2026-10-01', 'search_console'),
    ),
  ).toEqual({ clicks: 0n, impressions: 0n, positionSum: null });
  await f.admin.query('UPDATE admin.search_daily_metrics SET position_sum=0 WHERE page_id=$1', [
    page,
  ]);
  expect(
    (await success(dashboard.unitOfWork, (tx) =>
      operations.search(tx, page, '2026-10-01', 'search_console'),
    ))!.positionSum,
  ).toBe('0');
  await f.admin.query(
    "INSERT INTO admin.ad_network_accounts(id,network,external_account_id,status,configuration_id) SELECT $1,'synthetic','synthetic','pending',id FROM admin.configuration_versions WHERE key='public_runtime' AND version=1",
    [account],
  );
  async function report(generation: number, rows: boolean) {
    const id = uid('ad_import');
    await f.admin.query(
      "INSERT INTO admin.ad_report_imports(id,account_id,period_start,period_end,source_revision,source_generation,checksum,state,fetched_at) VALUES($1,$2,'2026-10-01','2026-10-02',$3,$4,$5,'validated',now())",
      [id, account, String(generation), generation, 'a'.repeat(64)],
    );
    if (rows)
      await f.admin.query(
        "INSERT INTO admin.ad_daily_metrics(import_id,day,dimension_key,currency,impressions,eligible_requests,revenue_minor,revenue_status) VALUES($1,'2026-10-01','all','USD',0,NULL,-123,'finalized')",
        [id],
      );
    await f.admin.query("UPDATE admin.ad_report_imports SET state='approved' WHERE id=$1", [id]);
  }
  await report(1, true);
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.ads(tx, account, '2026-10-01', 'all', 'USD', 'finalized'),
    ),
  ).toEqual({ impressions: 0n, eligibleRequests: null, revenueMinor: -123n, sourceRevision: '1' });
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.ads(tx, account, '2026-10-01', 'all', 'USD', 'estimated'),
    ),
  ).toBeNull();
  await report(2, false);
  expect(
    await success(dashboard.unitOfWork, (tx) =>
      operations.ads(tx, account, '2026-10-01', 'all', 'USD', 'finalized'),
    ),
  ).toBeNull();
});
it('projects reviewed commercial data without credentials and stops exposing expired link checks', async () => {
  const retailer = uid('retailer'),
    link = uid('affiliate');
  await f.admin.query(
    "INSERT INTO app.retailers(id,code,name,market,approved_origin,status) VALUES($1,'fixture','Synthetic retailer','US','https://example.invalid','active')",
    [retailer],
  );
  const config = (
    await f.admin.query(
      "SELECT id FROM admin.configuration_versions WHERE key='public_runtime' AND version=1",
    )
  ).rows[0].id;
  await f.admin.query(
    "INSERT INTO admin.affiliate_links(id,retailer_id,link_key,destination,market,status) VALUES($1,$2,'fixture','https://example.invalid/tires','US','active')",
    [link, retailer],
  );
  await f.admin.query(
    "INSERT INTO admin.affiliate_link_checks(link_id,checked_at,result,expires_at) VALUES($1,now()-interval '1 hour','valid',now()+interval '1 hour')",
    [link],
  );
  expect(
    await success(dashboard.unitOfWork, (tx) => operations.affiliate(tx, 'fixture', 'US')),
  ).toMatchObject({ destination: 'https://example.invalid/tires' });
  await f.admin.query(
    "INSERT INTO admin.affiliate_link_checks(link_id,checked_at,result,expires_at) VALUES($1,now()-interval '5 minutes','valid',now()-interval '1 minute')",
    [link],
  );
  expect(
    await success(dashboard.unitOfWork, (tx) => operations.affiliate(tx, 'fixture', 'US')),
  ).toBeNull();
  await f.admin.query(
    "INSERT INTO admin.ad_slots(slot_key,route_class,configuration_id,status) VALUES('fixture','education',$1,'active')",
    [config],
  );
  expect(await success(dashboard.unitOfWork, (tx) => operations.slots(tx, 'education'))).toEqual([
    { key: 'fixture', active: true },
  ]);
  expect(
    await result(dashboard.unitOfWork, (tx) => operations.slots(tx, '/reports/:report')),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('serializes withdrawal against receipt and excludes bots and missing sessions from the relevant metric', async () => {
  const c = await authorized();
  await success(analytics.unitOfWork, (tx) =>
    events.receive(tx, c, [
      { ...event(), channel: 'mcp', bot: 'internal' },
      { ...event(), channel: 'mcp', sessionId: null },
    ]),
  );
  const b = await build();
  expect(b.metrics.filter((m) => m.dimension === 'mcp')).toEqual(
    expect.arrayContaining([
      { metric: 'events', market: 'US', dimension: 'mcp', value: 1n },
      { metric: 'sessions', market: 'US', dimension: 'mcp', value: 0n },
    ]),
  );
  await success(analytics.unitOfWork, (tx) => events.publish(tx, b));
  const notice = await f.notice('analytics');
  const withdrawal = success(f.scope.unitOfWork, (tx) =>
    f.privacy.consent(tx, {
      subjectId: c.subjectId,
      expectedRevision: c.permission,
      id: uid('consent_event'),
      purpose: 'analytics',
      action: 'withdraw',
      scope: 'analytics',
      policyVersion: c.policy,
      method: 'synthetic',
      noticeId: notice,
      expiresAt: null,
    }),
  );
  const receipt = result(analytics.unitOfWork, (tx) => events.receive(tx, c, [event()]));
  await withdrawal;
  const raced = await receipt;
  if (!raced.ok) expect(raced.error.code).toBe('forbidden');
  expect(
    await result(analytics.unitOfWork, (tx) => events.receive(tx, c, [event()])),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
});
it('purges expired event rows and quota buckets with bounded cleanup and privacy invalidation', async () => {
  const c = await authorized(),
    old = uid('event');
  await f.admin.query(
    "INSERT INTO analytics.events(id,subject_id,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at) VALUES($1,$2,'public_page_view',1,now()-interval '2 days',now()-interval '2 days','US','en-US','/','web',2,'test-v1','{}',decode($3,'hex'),'not_flagged',now()-interval '1 day')",
    [old, c.subjectId, key().digest],
  );
  expect(await success(analytics.unitOfWork, (tx) => events.cleanup(tx, 1))).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT privacy_blocked FROM analytics.dirty_days WHERE day=(now() AT TIME ZONE 'UTC')::date-2",
      )
    ).rows[0].privacy_blocked,
  ).toBe(true);
  const p = await policy();
  await f.admin.query(
    "INSERT INTO app.rate_limit_buckets(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds,limit_value,used,expires_at) VALUES($1,'1','old',decode($2,'hex'),date_trunc('hour',now()-interval '3 days'),3600,1,1,date_trunc('hour',now()-interval '3 days')+interval '2 hours')",
    [p.policy, p.keys[0]!.digest],
  );
  expect(await success(limiter.unitOfWork, (tx) => quotas.consume(tx, [p]))).toEqual({
    allowed: true,
  });
  expect(await success(limiter.unitOfWork, (tx) => quotas.cleanup(tx, 1))).toBe(1);
});
it('bounds repository inputs and poisons caught publication failures instead of committing partial writes', async () => {
  const a = publication();
  expect(
    await result(writer.unitOfWork, async (tx) => {
      await content.publish(tx, a);
      try {
        await content.publish(tx, { ...a, content: { title: '', summary: 'x', paragraphs: [] } });
      } catch {
        /* caller cannot unpoison */
      }
    }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(await success(reader.unitOfWork, (tx) => publicRead.content(tx, a))).toBeNull();
  expect(
    await result(writer.unitOfWork, (tx) =>
      content.configure(
        tx,
        {
          schemaVersion: 1,
          revision: 3,
          issuedAt: time(-1000),
          expiresAt: time(1000),
          analytics: false,
          advertising: false,
        },
        uid('staff'),
      ),
    ),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  for (const limit of [0, 1001])
    expect(await result(analytics.unitOfWork, (tx) => events.cleanup(tx, limit))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  expect(await result(analytics.unitOfWork, (tx) => events.capture(tx, 301))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(
    await result(dashboard.unitOfWork, (tx) =>
      operations.search(tx, uid('seo_page'), '2026-02-30', 'search_console'),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(
    await result(dashboard.unitOfWork, (tx) =>
      operations.ads(tx, uid('ad_account'), '2026-10-01', 'private:report', 'USD', 'finalized'),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(
    await result(dashboard.unitOfWork, (tx) =>
      operations.metric(tx, '2026-10-01', 'events', 'US', 'individual'),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('uses bounded indexed SEO pages at representative cardinality', async () => {
  await f.admin.query(
    "INSERT INTO admin.seo_page_registry(public_path,locale,market,page_class,owner_staff_id,review_due_at,index_status,canonical_path) SELECT '/learn/page-'||n,'en-US','US','education',$1,now(),'eligible','/learn/page-'||n FROM generate_series(1,10000) n",
    [f.staff],
  );
  await f.admin.query('ANALYZE admin.seo_page_registry');
  const p = pageRequest(100);
  if (!p.ok) throw Error('page');
  const first = await success(dashboard.unitOfWork, (tx) => operations.pages(tx, p.value));
  expect(first.items).toHaveLength(100);
  expect(first.next).not.toBeNull();
  const next = pageRequest(100, first.next);
  if (!next.ok) throw Error('page');
  const second = await success(dashboard.unitOfWork, (tx) => operations.pages(tx, next.value));
  expect(second.items).toHaveLength(100);
  expect(second.items[0]!.id > first.items.at(-1)!.id).toBe(true);
  const plan = await success(dashboard.unitOfWork, (tx) =>
    dashboard.query(
      tx,
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM admin.seo_projection WHERE id>$1 ORDER BY id LIMIT 101',
      [first.items.at(-1)!.id],
    ),
  );
  const serialized = JSON.stringify(plan.rows);
  expect(serialized).toContain('seo_page_registry_pk');
  expect(serialized).toContain('Index');
  const root = (
    plan.rows[0]!['QUERY PLAN'] as { Plan: Record<string, unknown>; 'Execution Time': number }[]
  )[0]!;
  expect(root.Plan['Actual Rows']).toBe(101);
  expect(root['Execution Time']).toBeLessThan(1000);
  console.log(
    'OPERATIONS_QUERY_EVIDENCE',
    JSON.stringify({
      syntheticPages: 10000,
      returned: root.Plan['Actual Rows'],
      executionMs: root['Execution Time'],
      indexed: true,
    }),
  );
});
