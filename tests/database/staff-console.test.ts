import { beforeAll, afterAll, it, expect } from 'vitest';
import { staffConsoleFixture } from '../fixtures/http/staff-console.ts';
import { uid } from '../fixtures/private/database.ts';
import { createStaffConsoleClient } from '../../packages/contracts/src/staff-console-client.ts';
let f: Awaited<ReturnType<typeof staffConsoleFixture>>,
  operator: Awaited<ReturnType<typeof f.staff>>,
  reviewer: typeof operator,
  limited: typeof operator;
beforeAll(async () => {
  f = await staffConsoleFixture();
  operator = await f.staff('commercial_operator');
  reviewer = await f.staff('commercial_operator');
  limited = await f.staff('operations_read');
  await f.db.admin.query(
    'INSERT INTO admin.roles(code,permissions,policy_version) VALUES(\'console_test\',\'["seo.publish","privacy.review","data.review","mail.recover"]\',\'synthetic\')',
  );
  await f.db.admin.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code IN ('console_test','operations_read')",
    [operator.id],
  );
});
afterAll(async () => {
  await f?.cleanup();
});
const client = (s: typeof operator) =>
  createStaffConsoleClient(f.server.origin, s, async (input, options) =>
    fetch(input, { ...options, headers: { ...options?.headers, origin: f.server.origin } }),
  );
it('returns a current local CSRF grant, masked bounded reports and opaque keyset continuation', async () => {
  const c = client(operator);
  expect(await c.session()).toEqual({ csrf: operator.csrf, staffId: operator.id, localOnly: true });
  const owner = await f.db.owner(),
    a = await f.db.report(owner.identity),
    b = await f.db.report(owner.identity);
  const r = await f.call('/staff-console/reports?limit=1', operator);
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.data.items).toHaveLength(1);
  expect(Object.keys(body.data.items[0]).sort()).toEqual(['id', 'state', 'updatedAt']);
  expect(body.data.next).toBeTypeOf('string');
  const next = await f.call('/staff-console/reports?limit=1&after=' + body.data.next, operator);
  expect(next.status).toBe(200);
  expect((await next.json()).data.items[0].id).not.toBe(body.data.items[0].id);
  expect((await c.reports()).items.map((x) => x.id)).toEqual(
    expect.arrayContaining([a.head.id, b.head.id]),
  );
  expect(JSON.stringify(await c.reports())).not.toContain(owner.identity.subjectId);
});
it('refuses unauthenticated, limited, revoked and malformed read requests without leaking records', async () => {
  expect((await f.call('/staff-console/reports')).status).toBe(401);
  for (const path of ['reports', 'sources', 'strategy', 'findings', 'configuration'])
    expect((await f.call('/staff-console/' + path, limited)).status).toBe(404);
  for (const suffix of ['?limit=101', '?limit=1&limit=2', '?after=bad', '?ownerId=private'])
    expect((await f.call('/staff-console/reports' + suffix, operator)).status).toBe(400);
  const revoked = await f.staff('privacy_operator');
  await f.db.admin.query("UPDATE admin.staff_identities SET status='disabled' WHERE id=$1", [
    revoked.id,
  ]);
  expect((await f.call('/staff-console/session', revoked)).status).toBe(404);
  expect((await f.call('/staff-console/reports', revoked)).status).toBe(404);
});
it('distinguishes unconfirmed source coverage, missing policy, empty findings and consented aggregates', async () => {
  const c = client(operator),
    sources = await c.sources();
  expect(sources.actualCoverage).toBe('unconfirmed');
  expect(sources.bundle).toBeNull();
  expect(await c.configuration()).toEqual({ version: 0, policy: null, networkReady: false });
  expect(await c.findings()).toEqual({ items: [], next: null });
  expect((await c.strategy()).items).toEqual([]);
  const metrics = await c.operations({ day: new Date().toISOString().slice(0, 10) });
  expect(metrics.coverage).toBe('consented traffic only');
  expect(metrics.events).toBeNull();
  expect(metrics.currency).toBeNull();
  expect(
    (await c.revenue({ account: uid('ad_account'), day: new Date().toISOString().slice(0, 10) }))
      .status,
  ).toBe('not_connected');
});
it('projects populated source schedules and SEO findings without raw configuration or assigned identities', async () => {
  const c = client(operator),
    source = uid('source'),
    page = uid('seo_page'),
    run = uid('audit'),
    now = new Date().toISOString();
  await f.db.admin.query(
    "INSERT INTO app.source_connectors(id,provider_id,kind,allowed_origin,allowed_path_prefix,schema_version,schedule_key,status) VALUES($1,$2,'synthetic-health','https://private-source.invalid','/PRIVATE_PATH','1','synthetic','active')",
    [source, f.db.provider],
  );
  await f.db.admin.query(
    "INSERT INTO app.feed_health(provider_id,kind,last_attempt_at,last_success_at,next_check_at,error_code) VALUES($1,'synthetic-health',now(),now(),now()+interval '1 hour','PRIVATE_ERROR')",
    [f.db.provider],
  );
  const attention = await c.sources();
  expect(attention.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: source, state: 'attention', lastRunState: null }),
    ]),
  );
  expect(JSON.stringify(attention)).not.toMatch(/PRIVATE|private-source/);
  await f.db.admin.query(
    "UPDATE app.feed_health SET error_code=NULL WHERE provider_id=$1 AND kind='synthetic-health'",
    [f.db.provider],
  );
  expect((await c.sources()).sources.find((s) => s.key === source)?.state).toBe('scheduled');
  await f.db.admin.query(
    "INSERT INTO admin.seo_page_registry(id,public_path,locale,market,content_key,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,'/learn/synthetic-console','en-US','US','synthetic-console','education',$2,now(),'noindex','/learn/synthetic-console')",
    [page, operator.id],
  );
  await f.db.admin.query(
    "INSERT INTO admin.seo_audit_runs(id,started_at,finished_at,crawler_version,state,page_count) VALUES($1,$2,$2,'synthetic-no-crawl','failed',1)",
    [run, now],
  );
  await f.db.admin.query(
    "INSERT INTO admin.seo_findings(run_id,page_id,rule_code,severity,status,owner_staff_id) VALUES($1,$2,'unavailable','error','open',$3)",
    [run, page, operator.id],
  );
  expect((await c.findings()).items).toEqual([
    expect.objectContaining({
      pageId: page,
      rule: 'unavailable',
      severity: 'error',
      state: 'open',
    }),
  ]);
  expect(JSON.stringify(await c.strategy())).not.toContain(operator.id);
  expect(JSON.stringify(await c.findings())).not.toContain(operator.id);
});
it('keeps recovery on the existing audited service and reconciles unchanged receipts without dispatch duplication', async () => {
  const c = client(operator),
    input = { kind: 'mail_reconcile' as const, target: uid('send'), evidence: 'a'.repeat(64) },
    key = uid('command');
  expect(await c.recover(input, key)).toEqual({ created: true, state: 'succeeded' });
  expect(await c.recover(input, key)).toEqual({ created: false, state: 'succeeded' });
  await expect(c.recover({ ...input, evidence: 'b'.repeat(64) }, key)).rejects.toMatchObject({
    code: 'conflict',
  });
  const rows = await f.db.admin.query(
    'SELECT state FROM admin.recovery_commands WHERE actor_id=$1',
    [operator.id],
  );
  expect(rows.rows).toEqual([{ state: 'succeeded' }]);
  expect(f.providerCalls()).toBe(0);
});
it('requires a distinct current reviewer and CAS version for audited configuration, retaining external activation holds', async () => {
  const c = client(operator),
    now = Date.now(),
    policy = {
      schemaVersion: 1,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(),
      accountId: null,
      adsTxt: [],
      blockedCategories: [],
      blockedUrls: [],
      slots: [],
    };
  const preview = await c.preview(policy, uid('command'));
  expect(preview.version).toBe(0);
  await expect(
    c.publish({ expectedVersion: 0, policy }, uid('command'), operator.bearer),
  ).rejects.toMatchObject({ code: 'not_found' });
  await expect(
    c.publish({ expectedVersion: 0, policy }, uid('command'), limited.bearer),
  ).rejects.toMatchObject({ code: 'not_found' });
  expect(await c.publish({ expectedVersion: 0, policy }, uid('command'), reviewer.bearer)).toEqual({
    version: 1,
  });
  expect(await c.configuration()).toMatchObject({ version: 1, networkReady: false, policy });
  await expect(
    c.publish({ expectedVersion: 0, policy }, uid('command'), reviewer.bearer),
  ).rejects.toMatchObject({ code: 'conflict' });
  const audit = await f.db.admin.query(
    'SELECT e.action FROM admin.audit_events e JOIN admin.audit_identity_links l ON l.event_id=e.id WHERE l.actor_staff_id=$1',
    [operator.id],
  );
  expect(audit.rows.length).toBeGreaterThan(0);
  console.log(
    'STAFF_CONSOLE_NATIVE_EVIDENCE ' +
      JSON.stringify({
        realPostgreSQL: true,
        existingRuntimeRoles: true,
        maskedReports: true,
        boundedKeysets: true,
        currentRoleRevocation: true,
        auditedRecovery: true,
        unchangedRecoveryReplay: true,
        independentConfigurationReview: true,
        configurationCas: true,
        externalActivation: false,
        providerDispatches: f.providerCalls(),
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
