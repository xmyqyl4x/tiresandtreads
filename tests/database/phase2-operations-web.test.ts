import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOperationsP2Client } from '../../packages/contracts/src/phase2-operations-client.ts';
import { createP2OwnerClient } from '../../packages/contracts/src/phase2-owner-client.ts';
import { createResultsClient } from '../../packages/contracts/src/results-client.ts';
import { operationsWebFixture } from '../fixtures/phase2/operations-web.ts';
import { value, time } from '../fixtures/phase2/compose-partner-services.ts';
let f: Awaited<ReturnType<typeof operationsWebFixture>>;
const day = () => new Date().toISOString().slice(0, 10);
const send =
  (token: string): typeof fetch =>
  async (input, init) => {
    const u = new URL(String(input));
    return f.web.request('/local-p2-operations-api' + u.pathname + u.search, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        authorization: 'Bearer ' + token,
        origin: f.web.webOrigin,
      },
    });
  };
const ownerSend: typeof fetch = async (input, init) => {
  const u = new URL(String(input));
  return f.web.request('/local-p2-owner-api' + u.pathname + u.search, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers)),
      authorization: 'Bearer ' + f.token,
      origin: f.web.webOrigin,
    },
  });
};
const client = (handle = f.operator.handle) =>
  createOperationsP2Client(f.web.webOrigin, send(handle));
async function command(handle = f.operator.handle) {
  return { key: randomUUID(), csrf: (await client(handle).p2OperationsSession({})).data.csrf };
}
const dashboard = (handle = f.operator.handle) =>
  client(handle).p2OperationsDashboard({ query: { day: day() } });
beforeAll(async () => {
  f = await operationsWebFixture();
}, 120000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
it('installs only the explicit55th local migration with forced-RLS immutable command receipts', async () => {
  expect(f.operationsMigrationHead).toBe('0055_analysis_operations');
  expect(
    (await f.f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(55);
  const row = (
    await f.f.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='admin.ai_operation_commands'::regclass",
    )
  ).rows[0];
  expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const runtime = f.f.analysisPool('tt_p2_ai_runtime');
  await expect(runtime.query('SELECT * FROM admin.ai_operation_commands')).rejects.toMatchObject({
    code: '42501',
  });
  const html = await (await f.web.request('/staff/assistance')).text();
  expect(html).toContain('Assistance, photo and privacy operations');
  expect(html).not.toContain(f.operator.handle);
});
it('exposes current role-separated safe metadata and no private inference fields', async () => {
  expect((await client(f.observer.handle).p2OperationsSession({})).data.capabilities).toEqual({
    aiObserve: true,
    aiControl: false,
    photoObserve: false,
  });
  const ai = (await dashboard(f.observer.handle)).data;
  expect(ai.data.ai).not.toBeNull();
  expect(ai.data.photo).toBeNull();
  const photo = (await dashboard(f.photoObserver.handle)).data;
  expect(photo.data.ai).toBeNull();
  expect(photo.data.photo?.confirmationsSampled).toBe(0);
  await expect(client(f.unassigned.handle).p2OperationsSession({})).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(JSON.stringify(ai)).not.toMatch(
    /PRIVATE_ZIP|omit-this-note|input_manifest|prompt_version|provider_request_id|owner_subject_id|sanitized_asset/,
  );
});
it('reuses existing independent privacy, mail and consented-visitor projections', async () => {
  for (const kind of ['privacy', 'mail', 'callbacks'] as const) {
    const p = (await client().p2OperationsPurpose({ query: { kind, day: day() } })).data;
    expect(p.queue!.items.length).toBeLessThanOrEqual(25);
    expect(p.visitors).toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/recipient|email_address|token_digest/);
  }
  const last = new Date();
  last.setUTCHours(0, 0, 0, 0);
  last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() + 6) % 7) - 7);
  const week = last.toISOString().slice(0, 10);
  expect(
    (await client().p2OperationsPurpose({ query: { kind: 'pilot', day: day(), week } })).data.pilot,
  ).toMatchObject({
    week,
    accepted: '0',
    opensAreEstimates: true,
    deliveryIsIndependentFact: true,
  });
  await expect(
    client(f.observer.handle).p2OperationsPurpose({ query: { kind: 'pilot', day: day(), week } }),
  ).rejects.toMatchObject({ code: 'not_found' });
  const visitors = (await client().p2OperationsPurpose({ query: { kind: 'visitors', day: day() } }))
    .data.visitors!;
  expect(visitors.coverage).toBe('consented traffic only');
  expect(visitors.events).toBeNull();
  expect(visitors.dailyDistinctSessions).toBeNull();
  await expect(
    client(f.observer.handle).p2OperationsPurpose({ query: { kind: 'privacy', day: day() } }),
  ).rejects.toMatchObject({ code: 'not_found' });
});
let resumed: string, receiptId: string;
it('resumes an already admitted owner request through the unchanged worker and retains immutable report facts', async () => {
  const core = (
    await f.f.admin.query(
      'SELECT output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
      [f.report],
    )
  ).rows;
  const owner = createP2OwnerClient(f.web.webOrigin, ownerSend),
    request = (
      await owner.p2AnalysisRequest({
        path: { report: f.report, version: '1' },
        body: { policyId: f.example.policy, allowed: true, noticeVersion: 'ai-processing-v1' },
        command: { key: randomUUID(), csrf: f.csrf },
      })
    ).data;
  resumed = request.id!;
  const cmd = await command();
  receiptId = cmd.key;
  const input = { path: { request: resumed }, body: {}, command: cmd };
  expect((await client().p2OperationsResume(input)).data.state).toBe('succeeded');
  expect(f.executeCalls.filter((x) => x === resumed)).toHaveLength(1);
  expect(f.analysis.calls).toHaveLength(1);
  await expect(client().p2OperationsResume(input)).rejects.toMatchObject({ code: 'conflict' });
  expect((await client().p2OperationsReceipt({ path: { command: receiptId } })).data.state).toBe(
    'succeeded',
  );
  expect(
    (await client().p2OperationsResume({ ...input, command: await command() })).data.state,
  ).toBe('refused');
  expect(f.analysis.calls).toHaveLength(1);
  expect(
    (
      await f.f.admin.query(
        'SELECT output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [f.report],
      )
    ).rows,
  ).toEqual(core);
  const data = (await dashboard()).data.data.ai!;
  expect(BigInt(data.usdReconciledMinor)).toBeGreaterThan(0n);
  expect(data.requestStates.accepted).toBeGreaterThan(0);
});
it('dispatches only a recorded generic task through its existing rights/reuse worker', async () => {
  const e = await f.generic.example(),
    queued = value(await f.generic.service.read(e.input));
  expect(queued.state).toBe('pending');
  expect(
    (
      await client().p2OperationsResume({
        path: { request: queued.id! },
        body: {},
        command: await command(),
      })
    ).data.state,
  ).toBe('succeeded');
  expect(f.generic.calls).toHaveLength(1);
  expect(value(await f.generic.service.read(e.input)).state).toBe('available');
});
it('retains unknown photo charges and refuses a second dispatch instead of resetting uncertain work', async () => {
  const owner = createP2OwnerClient(f.web.webOrigin, ownerSend),
    capture = (
      await owner.p2PhotoCapture({
        body: { policyId: f.photoExample.policy },
        command: { key: randomUUID(), csrf: f.csrf },
      })
    ).data;
  const { key: _key, ...body } = f.photoExample.input;
  void _key;
  const intent = (
    await owner.p2PhotoIntent({
      body: { ...body, batchId: capture.batchId },
      command: { key: randomUUID(), csrf: f.csrf },
    })
  ).data;
  if (intent.state === 'manual') throw Error('Synthetic admission required');
  await owner.p2PhotoFinalize({
    path: { upload: intent.id },
    bytes: f.photoExample.bytes,
    grant: intent.grant,
    command: { key: randomUUID(), csrf: f.csrf },
  });
  f.photo.setBehavior(async () => {
    throw Error('synthetic network uncertainty');
  });
  const request = (
    await owner.p2PhotoExtract({
      path: { upload: intent.id },
      body: {},
      command: { key: randomUUID(), csrf: f.csrf },
    })
  ).data;
  await client().p2OperationsResume({
    path: { request: request.id },
    body: {},
    command: await command(),
  });
  const before = f.photo.calls.length;
  expect(
    (await f.f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [request.id]))
      .rows[0]!.state,
  ).toBe('uncertain');
  expect(
    (
      await client().p2OperationsResume({
        path: { request: request.id },
        body: {},
        command: await command(),
      })
    ).data.state,
  ).toBe('refused');
  expect(f.photo.calls).toHaveLength(before);
  expect((await dashboard()).data.data.ai!.unknownCostAttempts).toBeGreaterThan(0);
  expect(
    (
      await f.f.admin.query(
        'SELECT state,settled_minor FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
        [request.id],
      )
    ).rows.every((r) => r.state === 'uncertain' && r.settled_minor === null),
  ).toBe(true);
  f.photo.reset();
});
it('disables only the observed active policy and preserves deterministic owner reads', async () => {
  const a = (await dashboard()).data.data.ai!,
    policy = a.policies.find((p) => p.id === f.example.policy)!;
  expect(
    (
      await client().p2OperationsDisable({
        path: { policy: policy.id },
        body: { fingerprint: '0'.repeat(64) },
        command: await command(),
      })
    ).data.state,
  ).toBe('refused');
  await expect(
    client(f.observer.handle).p2OperationsDisable({
      path: { policy: policy.id },
      body: { fingerprint: policy.fingerprint },
      command: {
        key: randomUUID(),
        csrf: (await client(f.observer.handle).p2OperationsSession({})).data.csrf,
      },
    }),
  ).rejects.toMatchObject({ code: 'not_found' });
  const changed = (
    await client().p2OperationsDisable({
      path: { policy: policy.id },
      body: { fingerprint: policy.fingerprint },
      command: await command(),
    })
  ).data;
  expect(changed.state).toBe('succeeded');
  await expect(
    f.f.admin.query('UPDATE admin.ai_operation_commands SET target_id=$2 WHERE id=$1', [
      changed.id,
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    f.f.admin.query("UPDATE app.ai_policy_versions SET status='active' WHERE id=$1", [policy.id]),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await createResultsClient(f.web.webOrigin, ownerSend).read(f.report, 1)).reportId).toBe(
    f.report,
  );
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
it('rechecks database role withdrawal and fresh MFA before returning metadata', async () => {
  await f.f.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp(),revision=revision+1 WHERE staff_id=$1',
    [f.observer.id],
  );
  await expect(dashboard(f.observer.handle)).rejects.toMatchObject({ code: 'not_found' });
  const p = f.p.sessions.get(f.photoObserver.handle)!;
  f.p.sessions.set(f.photoObserver.handle, { ...p, mfaAt: time(-600000) });
  await expect(dashboard(f.photoObserver.handle)).rejects.toMatchObject({ code: 'unauthorized' });
});
it('withholds another operator receipt even after the caller receives its own control role', async () => {
  const review = await f.seedReceiptReview();
  expect(
    (await client().p2OperationsReceipt({ path: { command: review.unknown } })).data.state,
  ).toBe('unknown');
  expect(
    (await client().p2OperationsReceipt({ path: { command: review.refused } })).data.state,
  ).toBe('refused');
  await f.f.admin.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='ai_operator'",
    [f.unassigned.id],
  );
  await expect(
    client(f.unassigned.handle).p2OperationsReceipt({ path: { command: receiptId } }),
  ).rejects.toMatchObject({ code: 'not_found' });
});
it('caps persisted request samples and uses the operations window index at representative cardinality', async () => {
  const base = (
    await f.f.admin.query(
      "SELECT r.id FROM app.ai_analysis_requests r JOIN app.ai_policy_versions p ON p.id=r.policy_version_id WHERE p.task='generic_explanation' LIMIT 1",
    )
  ).rows[0]!.id;
  await f.f.admin.query(
    `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,state,expires_at,created_at) SELECT gen_random_uuid(),scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,'ops-sample-'||n,notice_version,permission_revision,subject_permission_revision,invalidation_revision,'queued',clock_timestamp()+interval '90 seconds',clock_timestamp() FROM app.ai_analysis_requests CROSS JOIN generate_series(1,5001) n WHERE id=$1`,
    [base],
  );
  const metrics = (await dashboard()).data.data.ai!;
  expect(metrics.requestsTruncated).toBe(true);
  expect(metrics.requestsSampled).toBe(5000);
  expect(metrics.queue).toHaveLength(25);
  expect(metrics.queue.every((r) => !r.recordedWork)).toBe(true);
  const calls = f.executeCalls.length;
  expect(
    (
      await client().p2OperationsResume({
        path: { request: metrics.queue[0]!.id },
        body: {},
        command: await command(),
      })
    ).data.state,
  ).toBe('refused');
  expect(f.executeCalls).toHaveLength(calls);
  const plan = JSON.stringify(
    (
      await f.f.admin.query(
        'EXPLAIN(COSTS OFF) SELECT id FROM app.ai_analysis_requests WHERE created_at>=$1 AND created_at<$2 ORDER BY created_at DESC,id DESC LIMIT 25',
        [day() + 'T00:00:00Z', new Date(Date.parse(day() + 'T00:00:00Z') + 86400000).toISOString()],
      )
    ).rows,
  );
  expect(plan).toContain('ai_request_operations_window_idx');
  console.log(
    'P2_OPERATIONS_WEB_EVIDENCE ' +
      JSON.stringify({
        actualNext: true,
        actualPostgreSQL: true,
        optInMigrations: 55,
        newTables: 1,
        currentRoleMfa: true,
        immutableAudit: true,
        negativeOnlyPolicyControl: true,
        existingReportPhotoGenericWorkers: true,
        recordedWorkOnly: true,
        unknownChargesPreserved: true,
        boundedSamples: 5000,
        indexedWindow: true,
        purposeScopedP1Services: true,
        privateFieldsExcluded: true,
        deterministicFallback: true,
        actualAuthenticationAccepted: false,
        actualModelEvaluation: false,
        actualPrivacyAcceptance: false,
        productionActivation: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
