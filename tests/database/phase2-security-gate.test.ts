import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createAssessmentClient } from '../../packages/contracts/src/assessment-client.ts';
import { createP2PartnerClient } from '../../packages/contracts/src/phase2-partner-client.ts';
import { createP2StaffClient } from '../../packages/contracts/src/phase2-staff-client.ts';
import { createP2PresentationClient } from '../../packages/contracts/src/phase2-presentation-client.ts';
import { p2Id } from '../../packages/integrations/src/http/phase2-common.ts';
import { value } from '../fixtures/phase2/compose-partner-services.ts';
import { composeAnalysisDelivery } from '../fixtures/phase2/compose-analysis-delivery.ts';
import { securityRenderer } from '../fixtures/phase2/security-renderer.ts';
import { PDFDocument } from 'pdf-lib';
import { ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import {
  withSecurityArchive,
  expectedSecurityRestoreCatalog,
} from '../fixtures/phase2/security-archive.ts';
import { securityWebFixture } from '../fixtures/phase2/security-web.ts';
import { createP2OwnerClient } from '../../packages/contracts/src/phase2-owner-client.ts';
import { createResultsClient } from '../../packages/contracts/src/results-client.ts';
import { createP2ReviewClient } from '../../packages/contracts/src/phase2-review-client.ts';
import { createOperationsP2Client } from '../../packages/contracts/src/phase2-operations-client.ts';
import { photoReadingSet } from '../../packages/domain/src/photo-policy.ts';
let f: Awaited<ReturnType<typeof securityWebFixture>>;
const send =
  (prefix: string, token: string): typeof fetch =>
  async (input, init) => {
    const u = new URL(String(input));
    return f.web.request(prefix + u.pathname + u.search, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        authorization: 'Bearer ' + token,
        origin: f.web.webOrigin,
      },
    });
  };
const owner = (token = f.token) =>
  createP2OwnerClient(f.web.webOrigin, send('/local-p2-owner-api', token));
const command = () => ({ key: randomUUID(), csrf: f.csrf });
const ownerSend = () => send('/local-p2-owner-api', f.token);
async function freshReport() {
  return (
    await createAssessmentClient(f.web.webOrigin, ownerSend()).create(
      {
        market: 'US',
        regionKey: 'SYNTHETIC_US',
        configurationId: null,
        wheelPackage: null,
        sizes: { front: '225/45R18', rear: '255/40R18' },
        strategy: 'year_round',
        winterUse: 'none',
        replace: ['front_left', 'front_right', 'rear_left', 'rear_right'],
        priorities: ['wet'],
        budget: null,
      },
      f.csrf,
      randomUUID(),
    )
  ).report_id;
}
async function queuedAnalysis(report: string) {
  return (
    await owner().p2AnalysisRequest({
      path: { report, version: '1' },
      body: { policyId: f.example.policy, allowed: true, noticeVersion: 'ai-processing-v1' },
      command: command(),
    })
  ).data;
}
let batch: string,
  batchUploads = 0;
async function photoIntent(bytes: Uint8Array = f.photoExample.bytes) {
  const c = owner();
  if (!batch || batchUploads === 4) {
    batch = (
      await c.p2PhotoCapture({ body: { policyId: f.photoExample.policy }, command: command() })
    ).data.batchId;
    batchUploads = 0;
  }
  const { key: _key, ...body } = f.photoExample.input;
  void _key;
  const intent = (
    await c.p2PhotoIntent({
      body: {
        ...body,
        batchId: batch,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      command: command(),
    })
  ).data;
  if (intent.state === 'manual') throw Error('Synthetic photo admission required');
  batchUploads++;
  return { c, intent, bytes };
}
async function readyPhoto() {
  const e = await photoIntent();
  await e.c.p2PhotoFinalize({
    path: { upload: e.intent.id },
    bytes: e.bytes,
    grant: e.intent.grant,
    command: command(),
  });
  return e;
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function enteredWorker(entered: ReturnType<typeof latch>, work: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      entered.promise,
      work.then(() => {
        throw Error('Worker finished before synthetic provider admission');
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error('Bounded synthetic provider admission timed out')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function staffClient(handle: string) {
  const transport = send('/local-p2-staff-api', handle),
    review = createP2ReviewClient(f.web.webOrigin, transport),
    csrf = (await review.p2StaffSession({})).data.csrf;
  return {
    csv: createP2StaffClient(f.web.webOrigin, transport),
    review,
    command: () => ({ key: randomUUID(), csrf }),
  };
}
beforeAll(async () => {
  f = await securityWebFixture();
}, 120000);
afterEach(() => {
  f?.photo.reset();
  f?.analysis.resetBehavior();
});
afterAll(async () => {
  await f?.cleanup();
  if (f)
    console.log(
      'P2_SECURITY_GATE_EVIDENCE ' +
        JSON.stringify({
          actualNext: true,
          actualPostgreSQL: true,
          optInMigrations: 55,
          optInTables: 225,
          privateSurfaces: 4,
          localScenarioCases: 16,
          crossPurposeIsolation: true,
          tenantIsolation: true,
          inFlightWithdrawalAndDeletion: true,
          originalWorkerChargesPreserved: true,
          realRendererFrozenRetry: true,
          signedSourceErasure: true,
          currentRoleRevocation: true,
          quarantinedSqlRestore: true,
          independentStaffPublication: true,
          browserInteractionClaimed: false,
          modelConfigurationChanged: false,
          actualAuthenticationAccepted: false,
          actualModelEvaluation: false,
          actualPrivacyAcceptance: false,
          actualLatestChainRestoreAcceptance: false,
          actualPhaseAcceptance: false,
          productionActivation: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
}, 60000);
it('serves the combined owner, partner, import and operations boundaries on one exact55 database', async () => {
  expect(
    (await f.f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(55);
  for (const path of ['/assisted-report', '/partners', '/staff/data', '/staff/assistance']) {
    const r = await f.web.request(path),
      html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(html).not.toContain(f.token);
    expect(html).not.toContain(f.operator.handle);
  }
  const review = createP2ReviewClient(f.web.webOrigin, send('/local-p2-staff-api', f.p.verifier));
  expect(
    (await review.p2BusinessQueue({ query: { after: null, limit: 25 } })).data.items.map(
      (i) => i.org,
    ),
  ).toContain(f.pending.org);
  const ops = createOperationsP2Client(
    f.web.webOrigin,
    send('/local-p2-operations-api', f.operator.handle),
  );
  expect((await ops.p2OperationsSession({})).data.capabilities.aiControl).toBe(true);
  expect(f.analysis.calls).toHaveLength(0);
  expect(f.photo.calls).toHaveLength(0);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
it('refuses owner capability reuse across staff and partner purposes without leaking private authority', async () => {
  const results = createResultsClient(
    f.web.webOrigin,
    send('/local-p2-owner-api', f.strangerToken),
  );
  await expect(results.read(f.report, 1)).rejects.toMatchObject({ code: 'not_found' });
  const surfaces = [
    {
      prefix: '/local-p2-staff-api',
      authorized: f.uploader,
      status: 403,
      code: 'forbidden',
      session: (transport: typeof fetch) =>
        createP2ReviewClient(f.web.webOrigin, transport).p2StaffSession({}),
    },
    {
      prefix: '/local-p2-operations-api',
      authorized: f.operator.handle,
      status: 403,
      code: 'forbidden',
      session: (transport: typeof fetch) =>
        createOperationsP2Client(f.web.webOrigin, transport).p2OperationsSession({}),
    },
    {
      prefix: '/local-p2-api',
      authorized: f.company.handle,
      status: 401,
      code: 'unauthorized',
      session: (transport: typeof fetch) =>
        createP2PartnerClient(f.web.webOrigin, transport).p2PartnerSession({}),
    },
  ];
  for (const surface of surfaces) {
    // A legitimate principal proves this is a reachable session contract, not a route refusal.
    expect(await surface.session(send(surface.prefix, surface.authorized))).toMatchObject({
      data: { csrf: expect.any(String) },
    });
    const ownerTransport: typeof fetch = async (input, init) => {
      const response = await send(surface.prefix, f.token)(input, init);
      expect(response.status).toBe(surface.status);
      const text = await response.clone().text();
      for (const secret of [f.token, f.operator.handle, f.example.owner.token])
        expect(text).not.toContain(secret);
      return response;
    };
    await expect(surface.session(ownerTransport)).rejects.toMatchObject({ code: surface.code });
  }
  expect(
    (
      await createResultsClient(f.web.webOrigin, send('/local-p2-owner-api', f.token)).read(
        f.report,
        1,
      )
    ).reportId,
  ).toBe(f.report);
});
it('rejects cross-site analysis admission before recording work or model cost', async () => {
  const before = (await f.f.admin.query('SELECT count(*)::int n FROM app.ai_analysis_requests'))
    .rows;
  const response = await f.web.request(
    '/local-p2-owner-api/api/v1/reports/' + f.report + '/versions/1/analysis',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + f.token,
        origin: 'https://untrusted.example.invalid',
        'content-type': 'application/json',
        'x-csrf-token': f.csrf,
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        policyId: f.example.policy,
        allowed: true,
        noticeVersion: 'ai-processing-v1',
      }),
    },
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'forbidden' });
  expect(
    (await f.f.admin.query('SELECT count(*)::int n FROM app.ai_analysis_requests')).rows,
  ).toEqual(before);
  expect(f.analysis.calls).toHaveLength(0);
});
it('refuses a different verified tenant across organization, offer and staff review reads', async () => {
  const company = createP2PartnerClient(f.web.webOrigin, send('/local-p2-api', f.company.handle)),
    other = createP2PartnerClient(f.web.webOrigin, send('/local-p2-api', f.otherCompany.handle)),
    offer = await f.p.published(f.company.org, f.company.handle),
    path = { org: f.company.org };
  expect((await company.p2Organization({ path })).data.organization.id).toBe(f.company.org);
  await company.p2OfferPreview({ path: { ...path, offer }, query: { version: 1 } });
  await expect(other.p2Organization({ path })).rejects.toMatchObject({ code: 'not_found' });
  await expect(
    other.p2OfferPreview({ path: { ...path, offer }, query: { version: 1 } }),
  ).rejects.toMatchObject({ code: 'not_found' });
  const tenantReview = createP2ReviewClient(
    f.web.webOrigin,
    send('/local-p2-staff-api', f.otherCompany.handle),
  );
  await expect(
    tenantReview.p2BusinessQueue({ query: { after: null, limit: 25 } }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await createP2ReviewClient(
    f.web.webOrigin,
    send('/local-p2-staff-api', f.p.verifier),
  ).p2BusinessQueue({ query: { after: null, limit: 25 } });
});
it('refuses forged JPEG declarations without forwarding attacker markup to extraction', async () => {
  const e = await photoIntent(
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>PRIVATE_ATTACK</script></svg>',
      ),
    ),
    before = f.photo.calls.length;
  await expect(
    e.c.p2PhotoFinalize({
      path: { upload: e.intent.id },
      bytes: e.bytes,
      grant: e.intent.grant,
      command: command(),
    }),
  ).rejects.toBeDefined();
  expect(f.photo.calls).toHaveLength(before);
  const rows = (
    await f.f.admin.query(
      'SELECT count(*)::int n FROM app.photo_field_candidates c JOIN app.photo_extractions e ON e.id=c.extraction_id WHERE e.upload_id=$1',
      [e.intent.id],
    )
  ).rows;
  expect(rows[0]!.n).toBe(0);
});
it.each(['unsafe', 'unavailable'] as const)(
  'refuses photo processing when the required scanner is %s on the combined host',
  async (scan) => {
    const e = await photoIntent(),
      before = f.photo.calls.length;
    f.photo.setScan(scan);
    await expect(
      e.c.p2PhotoFinalize({
        path: { upload: e.intent.id },
        bytes: e.bytes,
        grant: e.intent.grant,
        command: command(),
      }),
    ).rejects.toBeDefined();
    expect(f.photo.calls).toHaveLength(before);
    expect(
      (await createResultsClient(f.web.webOrigin, ownerSend()).read(f.report, 1)).reportId,
    ).toBe(f.report);
  },
);
it('withdraws owner analysis during an actual in-flight worker, preserves charge evidence and rejects late publication', async () => {
  const report = await freshReport(),
    request = await queuedAnalysis(report),
    entered = latch(),
    release = latch();
  expect(request.id).not.toBeNull();
  f.analysis.setBehavior(async (input) => {
    entered.release();
    await release.promise;
    return f.analysis.defaultBehavior(input);
  });
  const work = f.runtime.execute(p2Id('ai_request', request.id!));
  let completed: Awaited<typeof work> | undefined;
  try {
    await enteredWorker(entered, work);
    const status = (await owner().p2AnalysisStatus({ path: { request: request.id! } })).data;
    expect(status.processing?.allowed).toBe(true);
    await owner().p2AnalysisChoice({
      path: { scope: status.processing!.scopeId },
      body: {
        allowed: false,
        expectedRevision: status.processing!.permissionRevision,
        noticeVersion: 'ai-processing-v1',
      },
      command: command(),
    });
    expect(
      (await owner().p2AnalysisAttachment({ path: { report, version: '1' } })).data.state,
    ).toBe('unavailable');
  } finally {
    release.release();
    completed = await work;
  }
  expect(completed?.ok).toBe(false);
  expect(
    (
      await f.f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        request.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await createP2PresentationClient(f.web.webOrigin, ownerSend()).p2AnalysisPresentation({
        path: { report, version: '1' },
      })
    ).data.selection,
  ).toBeNull();
  const attempts = (
    await f.f.admin.query(
      'SELECT state,cost_status,cost_minor::text FROM app.ai_attempts WHERE request_id=$1',
      [request.id],
    )
  ).rows;
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ cost_status: 'reconciled', cost_minor: '5' });
  expect((await createResultsClient(f.web.webOrigin, ownerSend()).read(report, 1)).reportId).toBe(
    report,
  );
  // A new request cannot silently reverse a withdrawal. Restore only through a separate
  // explicit current-revision permission choice for later independent fixture scenarios.
  const denied = (await owner().p2AnalysisStatus({ path: { request: request.id! } })).data
    .processing!;
  expect(denied.allowed).toBe(false);
  await owner().p2AnalysisChoice({
    path: { scope: denied.scopeId },
    body: {
      allowed: true,
      expectedRevision: denied.permissionRevision,
      noticeVersion: 'ai-processing-v1',
    },
    command: command(),
  });
  expect(
    (
      await createP2PresentationClient(f.web.webOrigin, ownerSend()).p2AnalysisPresentation({
        path: { report, version: '1' },
      })
    ).data.selection,
  ).toBeNull();
}, 30000);
it('removes a photo during in-flight extraction and refuses stale candidate publication without erasing measured cost', async () => {
  const e = await readyPhoto(),
    request = (
      await e.c.p2PhotoExtract({ path: { upload: e.intent.id }, body: {}, command: command() })
    ).data,
    entered = latch(),
    release = latch(),
    lateOutput = {
      schema: 1,
      fields: [
        {
          field: 'tire_size',
          rawText: '225/65R17',
          value: '225/65R17',
          quality: 'clear',
          unknownReason: null,
          region: null,
        },
      ],
    };
  const publishable = photoReadingSet(lateOutput, new Date().toISOString());
  expect(publishable.ok).toBe(true);
  if (!publishable.ok) throw Error('Publishable synthetic candidate required');
  expect(publishable.value.fields).toHaveLength(1);
  expect(publishable.value.fields[0]!.value).toBe('225/65R17');
  f.photo.setBehavior(async () => {
    entered.release();
    await release.promise;
    return {
      state: 'complete',
      output: lateOutput,
      providerRequestId: 'synthetic-late-result',
      inputTokens: 1n,
      outputTokens: 1n,
      costMinor: 5n,
    };
  });
  const work = f.photo.service.execute(p2Id('ai_request', request.id));
  let completed: Awaited<typeof work> | undefined;
  try {
    await enteredWorker(entered, work);
    expect(
      (await e.c.p2PhotoDelete({ path: { upload: e.intent.id }, body: {}, command: command() }))
        .data.cleanupPending,
    ).toBe(true);
    await expect(e.c.p2PhotoStatus({ path: { upload: e.intent.id } })).rejects.toMatchObject({
      code: 'not_found',
    });
  } finally {
    release.release();
    completed = await work;
  }
  expect(completed?.ok).toBe(false);
  await expect(e.c.p2PhotoStatus({ path: { upload: e.intent.id } })).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(
    (
      await f.f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        request.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await f.f.admin.query('SELECT cost_minor::text FROM app.ai_attempts WHERE request_id=$1', [
        request.id,
      ])
    ).rows,
  ).toEqual([{ cost_minor: '5' }]);
  expect(
    (
      await f.f.admin.query(
        'SELECT count(*)::int n FROM app.photo_field_candidates c JOIN app.photo_extractions e ON e.id=c.extraction_id WHERE e.upload_id=$1',
        [e.intent.id],
      )
    ).rows[0]!.n,
  ).toBe(0);
}, 30000);
it('keeps mixed private reads usable during competing SQL worker admissions and charges only the single model attempt', async () => {
  const report = await freshReport(),
    queued = await queuedAnalysis(report),
    entered = latch(),
    release = latch(),
    before = f.analysis.calls.length;
  const ops = createOperationsP2Client(
      f.web.webOrigin,
      send('/local-p2-operations-api', f.operator.handle),
    ),
    csrf = (await ops.p2OperationsSession({})).data.csrf,
    resume = () =>
      ops.p2OperationsResume({
        path: { request: queued.id! },
        body: {},
        command: { key: randomUUID(), csrf },
      });
  f.analysis.setBehavior(async (input) => {
    entered.release();
    await release.promise;
    return f.analysis.defaultBehavior(input);
  });
  const work = resume(),
    latencies: number[] = [];
  try {
    await enteredWorker(entered, work);
    await resume();
    const partner = createP2PartnerClient(
        f.web.webOrigin,
        send('/local-p2-api', f.otherCompany.handle),
      ),
      staff = await staffClient(f.p.verifier),
      reads = [
        async () => {
          expect(
            (await createResultsClient(f.web.webOrigin, ownerSend()).read(report, 1)).reportId,
          ).toBe(report);
        },
        async () => {
          expect(
            (await partner.p2Organization({ path: { org: f.otherCompany.org } })).data.organization
              .id,
          ).toBe(f.otherCompany.org);
        },
        async () => {
          expect(
            (await staff.review.p2BusinessQueue({ query: { after: null, limit: 25 } })).data.items
              .length,
          ).toBeGreaterThan(0);
        },
        async () => {
          expect(
            (
              await ops.p2OperationsDashboard({
                query: { day: new Date().toISOString().slice(0, 10) },
              })
            ).data.capabilities.aiControl,
          ).toBe(true);
        },
      ];
    for (let wave = 0; wave < 4; wave++)
      await Promise.all(
        reads.map(async (read) => {
          const start = performance.now();
          await read();
          latencies.push(performance.now() - start);
        }),
      );
  } finally {
    release.release();
    await work;
  }
  await resume();
  expect(f.analysis.calls.length - before).toBe(1);
  expect(
    (
      await f.f.admin.query(
        'SELECT count(*)::int n,sum(cost_minor)::text cost FROM app.ai_attempts WHERE request_id=$1',
        [queued.id],
      )
    ).rows,
  ).toEqual([{ n: 1, cost: '5' }]);
  expect(
    (
      await f.f.admin.query(
        'SELECT count(*)::int n FROM app.ai_budget_windows WHERE reserved_minor<0 OR spent_minor<0 OR reserved_minor+spent_minor>limit_minor',
      )
    ).rows[0]!.n,
  ).toBe(0);
  latencies.sort((a, b) => a - b);
  console.log(
    'P2_SECURITY_MIXED_LOAD_EVIDENCE ' +
      JSON.stringify({
        reads: latencies.length,
        waves: 4,
        competingResumeCommands: 2,
        syntheticModelCalls: f.analysis.calls.length - before,
        p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
        maxMs: latencies.at(-1),
        rssBytes: process.memoryUsage().rss,
        actualNext: true,
        actualPostgreSQL: true,
        productionSlaAccepted: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
      }),
  );
}, 30000);
it('renders a real SQL-frozen assisted selection to branded HTML, text and PDF and retries identical bytes without regeneration', async () => {
  const report = await freshReport(),
    request = await queuedAnalysis(report);
  value(await f.runtime.execute(p2Id('ai_request', request.id!)));
  const attachment = (await owner().p2AnalysisAttachment({ path: { report, version: '1' } })).data;
  expect(attachment.state).toBe('available');
  if (attachment.state !== 'available') throw Error('Accepted synthetic attachment required');
  const renderer = securityRenderer(),
    delivery = await composeAnalysisDelivery(
      f.f,
      undefined,
      { owner: f.example.owner, report },
      { baseRenderer: renderer },
    );
  try {
    const sendReceipt = await delivery.request(undefined, {
      ...delivery.input,
      analysis: { attachmentRevision: attachment.attachment.revision, fallback: null },
    });
    await delivery.due(sendReceipt.id);
    delivery.provider.send.mockResolvedValueOnce({ outcome: 'uncertain', messageId: null });
    value(await delivery.service.dispatch(sendReceipt.id));
    const first = delivery.provider.send.mock.calls[0]![1],
      calls = f.analysis.calls.length;
    expect(first.mail.html).toContain('AI-assisted installer questions');
    expect(first.mail.text).toContain(
      'Personalized claims and citations remain in the private owner view',
    );
    expect(
      (await PDFDocument.load(Buffer.from(first.mail.pdf, 'base64'))).getPageCount(),
    ).toBeGreaterThan(1);
    for (const secret of [f.token, f.example.owner.token.digest, 'PRIVATE_ZIP', 'omit-this-note'])
      expect(JSON.stringify(first)).not.toContain(secret);
    await f.f.admin.query(
      'UPDATE email.delivery_work SET next_attempt_at=clock_timestamp() WHERE send_id=$1',
      [sendReceipt.id],
    );
    value(await delivery.service.dispatch(sendReceipt.id));
    expect(delivery.provider.send.mock.calls[1]![1]).toEqual(first);
    expect(delivery.renderer.render).toHaveBeenCalledOnce();
    expect(f.analysis.calls).toHaveLength(calls);
  } finally {
    await delivery.cleanup();
  }
}, 30000);
it('publishes independent reviewed CSV data while immutable owner report facts remain unchanged', async () => {
  const original = (
      await f.f.admin.query(
        'SELECT report_id,version,input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions ORDER BY report_id,version',
      )
    ).rows,
    e = await f.csv.example(),
    uploader = await staffClient(f.uploader),
    reviewer = await staffClient(f.reviewer),
    publisher = await staffClient(f.publisher),
    query = {
      templateId: e.template.id,
      providerId: e.input.providerId,
      licenseId: e.input.licenseId,
      market: 'US' as const,
      effectiveAt: e.input.effectiveAt,
      externalVersion: e.input.externalVersion,
    };
  const uploaded = (
      await uploader.csv.p2CsvUpload({ query, bytes: e.bytes, command: uploader.command() })
    ).data,
    path = { intake: uploaded.id! };
  await uploader.csv.p2CsvValidate({ path, body: {}, command: uploader.command() });
  const preview = (await uploader.csv.p2CsvPreview({ path, body: {}, command: uploader.command() }))
    .data;
  await expect(
    uploader.csv.p2CsvReview({
      path,
      body: { previewId: preview.id, decision: 'approved', reason: 'self_review' },
      command: uploader.command(),
    }),
  ).rejects.toBeDefined();
  const reviewed = (
    await reviewer.csv.p2CsvReview({
      path,
      body: { previewId: preview.id, decision: 'approved', reason: 'combined_security_review' },
      command: reviewer.command(),
    })
  ).data;
  await publisher.csv.p2CsvPublish({
    path,
    body: { reviewId: reviewed.id },
    command: publisher.command(),
  });
  expect((await publisher.csv.p2CsvReceipt({ path })).data.publicationBundleId).toBeTruthy();
  expect(
    (
      await f.f.admin.query(
        'SELECT report_id,version,input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions ORDER BY report_id,version',
      )
    ).rows,
  ).toEqual(original);
});
it('rejects disguised binary CSV uploads without echoing their private cells or creating an ingest job', async () => {
  const e = await f.csv.example(),
    uploader = await staffClient(f.uploader),
    marker = 'PRIVATE_CSV_PAYLOAD',
    bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, ...new TextEncoder().encode(marker)]),
    response = (
      await uploader.csv.p2CsvUpload({
        query: {
          templateId: e.template.id,
          providerId: e.input.providerId,
          licenseId: e.input.licenseId,
          market: 'US',
          effectiveAt: e.input.effectiveAt,
          externalVersion: e.input.externalVersion,
        },
        bytes,
        command: uploader.command(),
      })
    ).data;
  expect(response.phase).toBe('invalid');
  expect(response.id).toBeNull();
  expect(response.runId ?? null).toBeNull();
  expect(response.errors).not.toContain(marker);
});
it('purges every version of a separately confirmed image through the existing signed erasure worker while retaining report facts', async () => {
  const e = await readyPhoto(),
    before = (
      await f.f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [f.report],
      )
    ).rows,
    assets = (
      await f.f.admin.query(
        'SELECT original_id,sanitized_id FROM app.photo_service_intents WHERE id=$1',
        [e.intent.id],
      )
    ).rows[0]!;
  await e.c.p2PhotoConfirm({
    path: { upload: e.intent.id },
    body: { candidateId: null, field: 'tire_size', revision: '1', value: '235/65R17' },
    command: command(),
  });
  const removed = (
      await e.c.p2PhotoDelete({ path: { upload: e.intent.id }, body: {}, command: command() })
    ).data,
    job = p2Id('analysis_erasure', removed.jobId);
  for (let n = 0; n < 40 && value(await f.privacy.service.status(job)) !== 'complete'; n++)
    value(await f.privacy.service.workOne(job));
  expect(value(await f.privacy.service.status(job))).toBe('complete');
  const versions = await f.photo.s3.send(new ListObjectVersionsCommand({ Bucket: f.photo.bucket }));
  expect(
    [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])].filter((v) =>
      [assets.original_id, assets.sanitized_id].some((id) => v.Key === 'assets/' + id),
    ),
  ).toEqual([]);
  expect(
    (
      await f.f.admin.query(
        'SELECT count(*)::int n FROM app.confirmed_photo_fields WHERE upload_id=$1',
        [e.intent.id],
      )
    ).rows[0]!.n,
  ).toBe(0);
  await expect(e.c.p2PhotoStatus({ path: { upload: e.intent.id } })).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(
    (
      await f.f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [f.report],
      )
    ).rows,
  ).toEqual(before);
  expect(f.privacy.journal.size).toBeGreaterThan(0);
});
it('rechecks a current operator role after session admission and refuses policy writes and receipt reads after revocation', async () => {
  const ops = createOperationsP2Client(
      f.web.webOrigin,
      send('/local-p2-operations-api', f.operator.handle),
    ),
    session = (await ops.p2OperationsSession({})).data,
    receipts = await f.seedReceiptReview(),
    policy = (
      await f.f.admin.query(
        'SELECT configuration_hash,status FROM app.ai_policy_versions WHERE id=$1',
        [f.example.policy],
      )
    ).rows[0]!,
    role = (await f.f.admin.query("SELECT id FROM admin.roles WHERE code='ai_operator'")).rows[0]!
      .id;
  expect(session.capabilities.aiControl).toBe(true);
  await f.f.admin.query(
    'DELETE FROM admin.staff_role_assignments WHERE staff_id=$1 AND role_id=$2',
    [f.operator.id, role],
  );
  try {
    expect((await ops.p2OperationsSession({})).data.capabilities.aiControl).toBe(false);
    await expect(
      ops.p2OperationsDisable({
        path: { policy: f.example.policy },
        body: { fingerprint: policy.configuration_hash },
        command: { key: randomUUID(), csrf: session.csrf },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      ops.p2OperationsReceipt({ path: { command: receipts.unknown } }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (
        await f.f.admin.query('SELECT status FROM app.ai_policy_versions WHERE id=$1', [
          f.example.policy,
        ])
      ).rows,
    ).toEqual([{ status: 'active' }]);
    expect(
      (await createResultsClient(f.web.webOrigin, ownerSend()).read(f.report, 1)).reportId,
    ).toBe(f.report);
  } finally {
    await f.f.admin.query(
      'INSERT INTO admin.staff_role_assignments(staff_id,role_id) VALUES($1,$2)',
      [f.operator.id, role],
    );
  }
});
it('restores the latest synthetic225-table SQL snapshot and preserves schema security while quarantining all runtime connections', async () => {
  await withSecurityArchive(async (proof) => {
    expect(proof.archiveBytes).toBeGreaterThan(10000);
    expect(proof.sourceRows).toHaveLength(225);
    expect(proof.restoredRows).toEqual(proof.sourceRows);
    expect(proof.restoredCatalog).toEqual(expectedSecurityRestoreCatalog(proof.sourceCatalog));
    expect(
      (await proof.restored.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
    ).toBe(55);
    const permissions = (
      await proof.restored.query(
        "SELECT rolname,has_database_privilege(rolname,current_database(),'CONNECT') AS allowed FROM pg_roles WHERE rolname LIKE 'tt_%' AND NOT rolsuper ORDER BY rolname",
      )
    ).rows;
    expect(permissions.length).toBeGreaterThan(15);
    expect(permissions.every((r) => r.allowed === false)).toBe(true);
    await expect(
      proof.restored.query("UPDATE admin.ai_operation_commands SET state='unknown'"),
    ).rejects.toMatchObject({ code: '25006' });
    console.log(
      'P2_SECURITY_ARCHIVE_EVIDENCE ' +
        JSON.stringify({
          actualPgDumpRestore: true,
          migrations: 55,
          tables: 225,
          allTableHashesMatch: true,
          catalogParity: true,
          runtimeConnectDenied: true,
          inspectionsReadOnly: true,
          archiveBytes: proof.archiveBytes,
          objectArchiveRestored: false,
          postBackupDeletionReplay: false,
          independentlyDurableCustody: false,
          actualLatestChainRestoreAcceptance: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  });
}, 60000);
