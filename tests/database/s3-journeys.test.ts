import { beforeAll, afterAll, it, expect } from 'vitest';
import { privateFixture, s3Fixture, uid, time, value } from '../fixtures/s3/database.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import { createReportRuntime } from '../../packages/integrations/src/report-runtime.ts';
import { createServiceMaintenanceRuntime } from '../../packages/integrations/src/service-maintenance-runtime.ts';
import { createAnalyticsRuntime } from '../../packages/integrations/src/analytics-runtime.ts';
import {
  createCollectionCrypto,
  createQuotaCrypto,
} from '../../packages/integrations/src/analytics-crypto.ts';
import { createServiceHealth } from '../../packages/application/src/services/service-health.ts';
import { createServiceHealthRepository } from '../../packages/db/src/repositories/service-health.ts';
import { createOperationsRepository } from '../../packages/db/src/repositories/operations.ts';
import { createWorkflows } from '../../packages/integrations/src/workflows.ts';
import { ok, type Id } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof privateFixture>>, s: Awaited<ReturnType<typeof s3Fixture>>;
beforeAll(async () => {
  f = await privateFixture();
  for (const kind of ['delete', 'restrict', 'opt_out', 'access', 'correct', 'export'])
    await f.admin.query(
      "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'s3fixture','s3-fixture',$2,now())",
      ['rights:' + kind, { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 }],
    );
  s = await s3Fixture(f);
  await f.admin.query(
    'INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code=$2',
    [f.staff, 'operations_read'],
  );
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
async function analytics() {
  await f.admin.query(
    "UPDATE app.rate_limit_policies SET enabled=true WHERE policy_key='analytics_ip'",
  );
  return createAnalyticsRuntime({
    scopes: {
      report: f.scope,
      collector: f.adapter('tt_analytics_runtime'),
      aggregate: f.adapter('tt_analytics_runtime'),
      limiter: f.adapter('tt_limiter_runtime'),
      operations: f.adapter('tt_operations_runtime'),
    },
    crypto: createCollectionCrypto(
      'c1',
      { c1: new Uint8Array(32).fill(8) },
      new Uint8Array(32).fill(9),
    ),
    quotaCrypto: createQuotaCrypto({ 'test-hmac-v1': new Uint8Array(32).fill(7) }),
    enabled: true,
    policy: s.contactPolicy.version,
    noticeId: s.contactPolicy.notices.analytics,
    now: () => time(),
  });
}
async function coordinator(
  enabled: Parameters<typeof createServiceMaintenanceRuntime>[0]['enabled'] = [],
) {
  const a = await analytics();
  return createServiceMaintenanceRuntime({
    delivery: s.delivery,
    privacy: s.privacy,
    mail: s.mail,
    analytics: a.analytics,
    admission: a.admission,
    content: { reconcile: async () => ok([]), dispatch: async () => ok(null) },
    sources: { tick: async () => ok([]) },
    jurisdiction: 's3fixture',
    enabled,
  });
}
async function settle(id: Id<'privacy_request'>) {
  await f.admin.query(
    "UPDATE privacy.request_work SET barrier_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE request_id=$1",
    [id],
  );
}
it('UC01/03/05/06/09 traverses technical report, refinement, share, verified contact, cancelled delivery and owner erasure', async () => {
  const owner = await f.owner(),
    request = engineFixture().request,
    created = value(await s.reports.create([owner.token], uid('command'), request)),
    report = created.report_id!;
  const first = value(await s.reports.readOwner([owner.token], report));
  expect(first.output).toMatchObject({ issuanceAuthorized: false });
  const draft = value(
    await s.reports.saveDraft([owner.token], report, uid('command'), {
      baseVersion: 1,
      expectedRevision: null,
      input: { ...request, priorities: ['noise'] },
    }),
  );
  const refined = value(
    await s.reports.refine([owner.token], report, uid('command'), {
      baseVersion: 1,
      draftRevision: draft.result_revision,
      expectedRevision: first.revision,
    }),
  );
  expect(refined.report_version).toBe(2);
  const share = value(
    await s.reports.share([owner.token], report, uid('command'), {
      version: 2,
      comparisonRevision: null,
    }),
  );
  if (!('token' in share)) throw Error('Missing share token');
  const shareKeys = s.reportCrypto.lookup('share', share.token);
  expect(value(await s.reports.readShared(shareKeys)).output).toMatchObject({
    issuanceAuthorized: false,
  });
  const send = value(
    await s.delivery.request([owner.token], uid('command'), {
      email: 's3-' + uid('address') + '@example.invalid',
      report: { id: report, version: 2 },
      offers: false,
      notices: { report: s.contactPolicy.notices.report },
    }),
  );
  const challenge = (
    await f.admin.query(
      'SELECT i.challenge_id FROM privacy.contact_intents i JOIN privacy.verification_challenges v ON v.id=i.challenge_id WHERE i.owner_subject_id=$1 AND v.purpose=$2 ORDER BY i.created_at DESC LIMIT 1',
      [owner.identity.subjectId, 'report'],
    )
  ).rows[0].challenge_id as Id<'verification'>;
  const verification = value(await s.contacts.verificationMessage(challenge));
  value(await s.contacts.confirm(verification.verificationToken, 'POST'));
  const status = value(await s.delivery.status([owner.token], send.id));
  value(await s.delivery.cancel([owner.token], send.id, status.revision));
  expect(s.send).not.toHaveBeenCalled();
  const deletion = value(
    await s.privacy.requestOwner([owner.token], 'delete', 's3fixture', uid('command')),
  );
  expect((await s.reports.readShared(shareKeys)).ok).toBe(false);
  await settle(deletion.id);
  const maintenance = await coordinator(['privacy', 'callbacks', 'delivery']);
  for (let n = 0; n < 40; n++) {
    value(await maintenance.cycle(['privacy', 'callbacks', 'delivery']));
    const current = value(await s.privacy.status(deletion.proof));
    if (current.status === 'completed') break;
    await settle(deletion.id);
  }
  expect(value(await s.privacy.status(deletion.proof)).status).toBe('completed');
  expect(
    (await f.admin.query('SELECT id FROM app.reports WHERE id=$1', [report])).rows,
  ).toHaveLength(0);
  expect(s.send).not.toHaveBeenCalled();
});
it('UC01/G1 refuses the actual catalog resolver when licensed/source policy acceptance is absent', async () => {
  const runtime = await createReportRuntime({
    privateScope: f.scope,
    catalogScope: f.adapter('tt_catalog_runtime'),
    sourceScope: f.adapter('tt_report_source_runtime'),
    crypto: s.reportCrypto,
    encryption: {
      encrypt: async () => ({ keyVersion: 'fixture', hex: 'a'.repeat(64) }),
      decrypt: async () => new Uint8Array(),
    },
    now: () => time(),
  });
  const owner = await f.owner();
  expect((await runtime.create([owner.token], uid('command'), engineFixture().request)).ok).toBe(
    false,
  );
  expect(
    (
      await f.admin.query('SELECT id FROM app.reports WHERE owner_subject_id=$1', [
        owner.identity.subjectId,
      ])
    ).rows,
  ).toHaveLength(0);
});
it('UC08/09 applies browser choice through collection, aggregation and withdrawal without private result joins', async () => {
  const owner = await f.owner(),
    a = await analytics(),
    signals = { gpc: false, cmpAvailable: true };
  const before = value(await s.contacts.browser([owner.token], signals));
  value(
    await s.contacts.setBrowserChoices(
      [owner.token],
      uid('command'),
      {
        expectedRevision: before.revision,
        allowed: ['analytics'],
        gpc: false,
        notices: s.contactPolicy.notices,
      },
      'POST',
    ),
  );
  const token = value(await a.analytics.issue([owner.token], signals));
  if (token.status !== 'issued') throw Error('No collection token');
  expect(
    value(
      await a.analytics.collect(
        token.token,
        JSON.stringify({
          events: [
            {
              id: uid('event'),
              name: 'public_page_view',
              occurredAt: time(),
              route: '/',
              props: {},
            },
          ],
        }),
        { ...signals, ip: '192.0.2.27', bot: 'not_flagged' },
      ),
    ).status,
  ).toBe('accepted');
  value(await a.analytics.rebuildOne());
  const after = value(await s.contacts.browser([owner.token], signals));
  value(
    await s.contacts.setBrowserChoices(
      [owner.token],
      uid('command'),
      {
        expectedRevision: after.revision,
        allowed: [],
        gpc: false,
        notices: s.contactPolicy.notices,
      },
      'POST',
    ),
  );
  expect(
    value(
      await a.analytics.collect(
        token.token,
        JSON.stringify({
          events: [
            {
              id: uid('event'),
              name: 'public_page_view',
              occurredAt: time(),
              route: '/',
              props: {},
            },
          ],
        }),
        {
          ...signals,
          ip: '192.0.2.27',
          bot: 'not_flagged',
        },
      ),
    ).status,
  ).toBe('refused');
  expect(value(await a.operations.dashboard(f.staff, time().slice(0, 10))).events).toBeNull();
  value(await a.analytics.maintenance(100));
  expect(
    (
      await f.admin.query('SELECT id FROM analytics.events WHERE subject_id=$1', [
        owner.identity.subjectId,
      ])
    ).rows,
  ).toHaveLength(0);
});
it('keeps executable rights work moving beyond 100 earlier manual cases and respects leases/barriers', async () => {
  const manual = await f.owner();
  for (let n = 0; n < 101; n++) {
    const r = value(
      await s.privacy.requestOwner([manual.token], 'access', 's3fixture', uid('command')),
    );
    value(await s.privacy.workOne(r.id));
  }
  const owner = await f.owner(),
    r = value(await s.privacy.requestOwner([owner.token], 'restrict', 's3fixture', uid('command')));
  await settle(r.id);
  expect(value(await s.privacy.queue()).some((v) => v.id === r.id)).toBe(false);
  expect(value(await s.privacy.ready(4))).toContain(r.id);
  await f.admin.query(
    "UPDATE privacy.request_work SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=now()+interval '1 minute' WHERE request_id=$1",
    [r.id],
  );
  expect(value(await s.privacy.ready(4))).not.toContain(r.id);
  await f.admin.query(
    'UPDATE privacy.request_work SET lease_token=NULL,lease_until=NULL WHERE request_id=$1',
    [r.id],
  );
  for (let n = 0; n < 5; n++) value(await s.privacy.workOne(r.id));
  expect(value(await s.privacy.status(r.proof)).status).toBe('completed');
  expect(await s.privacy.ready(101)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('separates unverified notification work, excludes delivered and expired proofs, and bounds candidates', async () => {
  value(
    await s.privacy.requestEmail(
      'notification-' + uid('tag') + '@example.invalid',
      'access',
      's3fixture',
    ),
  );
  const ids = value(await s.privacy.notifications(4));
  expect(ids).toHaveLength(1);
  value(await s.privacy.dispatchVerification(ids[0]!));
  expect(value(await s.privacy.notifications(4))).toEqual([]);
  value(
    await s.privacy.requestEmail(
      'expired-' + uid('tag') + '@example.invalid',
      'access',
      's3fixture',
    ),
  );
  const pending = value(await s.privacy.notifications(4));
  await f.admin.query(
    "UPDATE privacy.request_work SET proof_expires_at=now()-interval '1 second' WHERE request_id=$1",
    [pending[0]],
  );
  expect(value(await s.privacy.notifications(4))).toEqual([]);
  expect(await s.privacy.notifications(0)).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it('binds every maintenance lane to bounded accepted methods and leaves retention in dry-run', async () => {
  const maintenance = await coordinator([
    'callbacks',
    'publication',
    'privacy',
    'analytics',
    'quotas',
    'retention',
    'assets',
    'sources',
    'delivery',
    'privacy_verification',
  ]);
  for (const group of [
    ['analytics', 'quotas', 'sources', 'publication'],
    ['retention', 'assets', 'privacy_verification', 'delivery'],
  ] as const) {
    const r = value(await maintenance.cycle(group));
    expect(r.results.every((a) => a.status === 'completed')).toBe(true);
  }
  expect(s.send).not.toHaveBeenCalled();
});
it('exposes only permission-scoped capped queue/age/capacity alarms and no consumer identifiers', async () => {
  const scope = f.adapter('tt_operations_runtime'),
    health = createServiceHealth({
      uow: scope.unitOfWork,
      health: createServiceHealthRepository(scope),
      operations: createOperationsRepository(scope),
    });
  await f.admin.query(
    "INSERT INTO app.webhook_inbox(provider,provider_event_id,payload_digest,received_at,signature_verified_at) SELECT 'resend','s3-health-'||n,decode(repeat('a',64),'hex'),now()-interval '1 hour',now() FROM generate_series(1,1500) n",
  );
  const rows = value(
      await health.review(f.staff, { backlog: 100, lagSeconds: 30, capacityBasisPoints: 8000 }),
    ),
    callback = rows.find((r) => r.code === 'callbacks')!;
  expect(callback).toMatchObject({ queued: 1001, capped: true, alerts: ['backlog', 'lag'] });
  expect(callback.ageSeconds).toBeGreaterThanOrEqual(3600);
  await f.admin.query('UPDATE app.rate_limit_capacity SET max_rows=greatest(1,used_rows)');
  await f.admin.query(
    "INSERT INTO admin.recovery_commands(id,actor_id,kind,input_digest,state,created_at,finished_at) VALUES($1,$2,'mail_reconcile',repeat('a',64),'unknown',now()-interval '1 hour',now())",
    [uid('command'), f.staff],
  );
  const alarms = value(
    await health.review(f.staff, { backlog: 100, lagSeconds: 30, capacityBasisPoints: 8000 }),
  );
  expect(alarms.find((r) => r.code === 'quota_capacity')?.alerts).toContain('capacity');
  expect(alarms.find((r) => r.code === 'recovery_unknown')?.alerts).toContain('review_required');
  await f.admin.query('UPDATE app.rate_limit_capacity SET max_rows=100000');
  expect(JSON.stringify(rows)).not.toMatch(/subject|email@|proof|provider_event|s3-health-/);
  expect(
    await health.review(uid('staff'), { backlog: 1, lagSeconds: 1, capacityBasisPoints: 1 }),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(
    await health.review(f.staff, { backlog: 0, lagSeconds: 1, capacityBasisPoints: 1 }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('composes the optional one-minute local workflow with maintenance disabled unless explicitly selected', async () => {
  const maintenance = await coordinator(),
    workflow = createWorkflows({
      baseUrl: 'http://127.0.0.1:8288',
      appId: 's3-fixture',
      run: async () => {},
      reconcile: async () => [],
      maintenance: () => maintenance.cycle(['privacy', 'quotas', 'analytics', 'assets']),
    });
  expect(workflow.functions).toHaveLength(3);
  expect(
    value(await maintenance.cycle(['privacy', 'quotas', 'analytics', 'assets'])).results.every(
      (r) => r.status === 'disabled',
    ),
  ).toBe(true);
  expect(s.send).not.toHaveBeenCalled();
});
