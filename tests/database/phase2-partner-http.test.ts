import { validateP2Routes } from '../../packages/integrations/src/http/phase2-response-contracts.ts';
import { createP2OwnerClient } from '../../packages/contracts/src/phase2-owner-client.ts';
import { createP2PartnerClient } from '../../packages/contracts/src/phase2-partner-client.ts';
import { createP2StaffClient } from '../../packages/contracts/src/phase2-staff-client.ts';
import { ownerP2Operations } from '../../packages/contracts/src/phase2-owner-client.ts';
import { partnerP2Operations } from '../../packages/contracts/src/phase2-partner-client.ts';
import { staffP2Operations } from '../../packages/contracts/src/phase2-staff-client.ts';
import { analysisPhotoRoutes } from '../../packages/integrations/src/http/phase2-analysis.ts';
import { analysisDeliveryRoutes } from '../../packages/integrations/src/http/phase2-analysis-delivery.ts';
import { createLocalReportAnalysisRuntime } from '../../packages/integrations/src/analysis-http-runtime.ts';
import { createAnalysisErasureRepository } from '../../packages/db/src/repositories/analysis-lifecycle.ts';
import { composePhotoServices } from '../fixtures/phase2/compose-photo-services.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { composeHttpPrivacy } from '../fixtures/phase2/compose-http-privacy.ts';
import { composeAnalysisDelivery } from '../fixtures/phase2/compose-analysis-delivery.ts';
import { fixtureReportServices } from '../fixtures/http/report-services.ts';
import { publicOwnerRoutes } from '../../packages/integrations/src/http/public-owner.ts';
import { performance } from 'node:perf_hooks';
import { composePilot } from '../fixtures/phase2/compose-pilot.ts';
import { pilotRoutes } from '../../packages/integrations/src/http/phase2-pilot.ts';
import { createStaffCsvRuntime } from '../../packages/integrations/src/staff-csv-runtime.ts';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { httpAdmissionFixture } from '../fixtures/phase2/http-admission.ts';
import {
  composePartnerServices,
  value,
  uuid,
  offerBody,
  target,
  time,
} from '../fixtures/phase2/compose-partner-services.ts';
import { composeInsights } from '../fixtures/phase2/compose-insights.ts';
import { composeStaffCsv } from '../fixtures/phase2/compose-staff-csv.ts';
import { partnerRoutes } from '../../packages/integrations/src/http/phase2-partners.ts';
import { staffCsvRoutes } from '../../packages/integrations/src/http/phase2-csv.ts';
import { createP2HttpAdmission } from '../../packages/integrations/src/http/phase2-admission.ts';
import { withPartnerSessions } from '../../packages/integrations/src/http/partner-security.ts';
import { createHttpApi, type HttpActor } from '../../packages/integrations/src/http/core.ts';
import { listenLocalApi } from '../../packages/integrations/src/http/server.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { rollbackDigest } from '../../packages/db/src/repositories/import-operations.ts';
import { p2Id, p2Rev } from '../../packages/integrations/src/http/phase2-common.ts';
let f: Awaited<ReturnType<typeof httpAdmissionFixture>>,
  p: Awaited<ReturnType<typeof composePartnerServices>>,
  i: Awaited<ReturnType<typeof composeInsights>>,
  csv: Awaited<ReturnType<typeof composeStaffCsv>>,
  host: Awaited<ReturnType<typeof listenLocalApi>>;
let pilot: Awaited<ReturnType<typeof composePilot>>;
const secret = randomBytes(32),
  staff = new Map<string, HttpActor>();
let photo: Awaited<ReturnType<typeof composePhotoServices>>,
  analysis: Awaited<ReturnType<typeof composeReportAnalysis>>,
  privacy: ReturnType<typeof composeHttpPrivacy>,
  runtime: Awaited<ReturnType<typeof createLocalReportAnalysisRuntime>>;
let frozenDelivery: Awaited<ReturnType<typeof composeAnalysisDelivery>> | undefined;
let reports: ReturnType<typeof fixtureReportServices>;
let declaredOperations: string[] = [];
let limited = false;
function ownerToken(keys: HttpActor['keys']) {
  const raw = randomBytes(32).toString('base64url');
  staff.set(raw, { keys, csrf: 'synthetic-owner-csrf' });
  return raw;
}
function clientTransport(token: string): typeof fetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', 'Bearer ' + token);
    if (init?.method !== 'GET') headers.set('origin', host.origin);
    const response = await fetch(url, { ...init, headers });
    return response;
  };
}
const commandFor = (token: string) => ({ key: randomUUID(), csrf: csrf(token) });

function staffToken(id: NonNullable<HttpActor['staff']>) {
  const token = randomBytes(32).toString('base64url');
  staff.set(token, { keys: [], csrf: 'synthetic-csrf', staff: id, mfaAt: Date.now() });
  return token;
}
function csrf(token: string) {
  return (
    staff.get(token)?.csrf ??
    createHmac('sha256', secret)
      .update('p2-csrf\0' + token)
      .digest('hex')
  );
}
async function call(
  token: string,
  path: string,
  body?: unknown,
  options: { key?: string; raw?: Uint8Array; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    authorization: 'Bearer ' + token,
    ...(body !== undefined || options.raw
      ? {
          origin: host.origin,
          'x-csrf-token': csrf(token),
          'idempotency-key': options.key ?? randomUUID(),
          'content-type': options.raw ? 'application/octet-stream' : 'application/json',
        }
      : {}),
    ...options.headers,
  };
  const r = await fetch(host.origin + '/api/v1/' + path, {
    method: body !== undefined || options.raw ? 'POST' : 'GET',
    headers,
    ...(options.raw
      ? { body: Buffer.from(options.raw) }
      : body === undefined
        ? {}
        : { body: JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) }),
  });
  const data = await r.json();
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  return { status: r.status, body: data, data: data.data };
}
beforeAll(async () => {
  f = await httpAdmissionFixture();
  // Compose this reviewed contact runtime before other independent synthetic fixtures add
  // contacts under their separate test key rings. It only handles its own API-created contacts.
  frozenDelivery = await composeAnalysisDelivery(f);
  p = await composePartnerServices(f);
  i = await composeInsights(f);
  csv = await composeStaffCsv(f);
  pilot = await composePilot(f);
  // Five fixed source categories are distinct owned synthetic records. No live catalog
  // or licensed evidence is accepted; the controlled engine port uses these exact IDs.
  const engineBundle = uuid('bundle'),
    engineSourceIds: string[] = [];
  await f.admin.query(
    "INSERT INTO app.dataset_bundles(id,market,manifest_hash,status) VALUES($1,'US',$2,'staging')",
    [engineBundle, 'a'.repeat(64)],
  );
  for (const kind of ['fitment', 'catalog', 'recall', 'climate', 'market_rules']) {
    const id = uuid('dataset');
    engineSourceIds.push(id);
    await f.admin.query(
      "INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) SELECT $1,provider_id,license_id,$2,$1::uuid::text,$3,'staging',statement_timestamp()-interval '1 day',statement_timestamp(),0 FROM app.dataset_versions WHERE id=(SELECT dataset_version_id FROM app.bundle_members WHERE bundle_id=$4 LIMIT 1)",
      [id, kind, 'b'.repeat(64), f.bundleId],
    );
    await f.admin.query(
      "UPDATE app.dataset_versions SET status='published',published_at=clock_timestamp() WHERE id=$1",
      [id],
    );
    await f.admin.query(
      'INSERT INTO app.bundle_members(bundle_id,component_key,dataset_version_id) VALUES($1,$2,$3)',
      [engineBundle, kind, id],
    );
  }
  await f.admin.query(
    "UPDATE app.dataset_bundles SET status='published',published_at=clock_timestamp() WHERE id=$1",
    [engineBundle],
  );
  f = { ...f, bundleId: engineBundle };
  photo = await composePhotoServices(f);
  analysis = await composeReportAnalysis(f);
  privacy = composeHttpPrivacy(f, photo);
  runtime = await createLocalReportAnalysisRuntime({
    mode: 'local-opt-in',
    scope: analysis.adapter,
    dependencies: analysis.d,
    rights: createAnalysisErasureRepository(analysis.adapter, photo.bucket, [photo.key]),
  });
  reports = fixtureReportServices(f, { current: true, localSourceIds: engineSourceIds });
  const admission = createP2HttpAdmission(p.service),
    routes = [
      ...partnerRoutes({ ...p, insights: i.service, admission, secret }),
      ...analysisPhotoRoutes({
        analysis: runtime,
        photos: photo.service,
        privacy: privacy.service,
        admission,
        secret,
      }),
      ...analysisDeliveryRoutes({
        delivery: {
          request: (...args) => {
            if (!frozenDelivery) throw Error('Owned synthetic delivery composition required');
            return frozenDelivery.service.request(...args);
          },
        },
        admission,
        secret,
      }),
      ...publicOwnerRoutes({
        reports: reports.reports,
        shareKeys: () => [],
        lookup: async () => ok({}),
        content: async () => ok({}),
        download: async () => fail(failure('not_found')),
      }),
      ...pilotRoutes({ service: pilot.service, admission, secret }),
      ...staffCsvRoutes({ service: csv.service, admission, secret }),
    ];
  declaredOperations = routes.map((r) => r.operationId);
  host = await listenLocalApi((origin) =>
    createHttpApi({
      origin,
      routes: validateP2Routes(routes),
      security: withPartnerSessions(
        {
          authenticate: async (r) =>
            staff.get(r.headers.get('authorization')?.slice(7) ?? '') ?? null,
          quota: async () => ({ allowed: !limited, retryAfterSeconds: 3 }),
        },
        {
          verify: async (h) => {
            const a = p.sessions.get(h) ?? i.sessions.get(h);
            return a ? ok(a) : fail(failure('forbidden'));
          },
        },
        secret,
      ),
    }),
  );
}, 90000);
afterAll(async () => {
  if (f) {
    const count = (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied'))
      .rows[0]!.n;
    console.log(
      'P2_PARTNER_HTTP_EVIDENCE ' +
        JSON.stringify({
          actualPostgreSQL: true,
          applicationMigrations: count,
          actualListeningLoopback: true,
          syntheticIdentityMfa: true,
          actualAuthenticationAccepted: false,
          defaultManifestsPromoted: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  }

  try {
    await host?.close();
  } finally {
    try {
      await csv?.cleanup();
      await frozenDelivery?.cleanup();
      privacy?.cleanup();
      await photo?.cleanup();
    } finally {
      await f?.cleanup();
    }
  }
}, 60000);
it('rejects tenant guessing, missing identity, invalid query, cross-origin and CSRF before effects', async () => {
  const c = await p.company(),
    stranger = p.session();
  expect((await call(stranger, 'partners/organizations/' + c.org)).status).toBe(404);
  expect((await call('invalid', 'partners/organizations/' + c.org)).status).toBe(401);
  expect((await call(c.handle, 'partners/organizations/' + c.org + '?sql=DROP')).status).toBe(400);
  expect(
    (
      await call(
        c.handle,
        'partners/organizations/' + c.org + '/profile',
        { expected: '1', services: ['sales'] },
        { headers: { origin: 'https://other.example' } },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        c.handle,
        'partners/organizations/' + c.org + '/profile',
        { expected: '1', services: ['sales'] },
        { headers: { 'x-csrf-token': 'wrong' } },
      )
    ).status,
  ).toBe(403);
});
it('runs onboarding, private agreements, independent verification and activation through running HTTP', async () => {
  const h = p.session(),
    registered = await call(h, 'partners/organizations', {
      legalName: 'HTTP synthetic retailer',
      market: 'US',
    });
  expect(registered.status).toBe(200);
  const org = registered.data.id,
    path = 'partners/organizations/' + org;
  let r = await call(h, path + '/profile', { expected: '1', services: ['sales', 'fitting'] });
  expect(r.status).toBe(200);
  expect(
    (
      await call(h, path + '/location', {
        key: 'main',
        region: 'CA',
        address: { line1: '1 Local Way', country: 'US', city: 'Example', postal: '90001' },
      })
    ).status,
  ).toBe(200);
  for (const kind of ['pilot_terms', 'privacy', 'dpa'] as const) {
    const upload = await call(
      h,
      path + '/assets?purpose=agreement&mime=application%2Fjson',
      undefined,
      { raw: p.docs[kind] },
    );
    expect(upload.status).toBe(200);
    expect(JSON.stringify(upload.body)).not.toMatch(/bucket|objectKey|keyVersion|encrypted/);
    expect((await call(h, path + '/agreement', { kind, assetId: upload.data.id })).status).toBe(
      200,
    );
  }
  r = await call(h, path + '/submit', { expected: r.data.revision });
  expect(r.status).toBe(200);
  const asset = await call(
    h,
    path + '/assets?purpose=verification&mime=application%2Fjson',
    undefined,
    { raw: new TextEncoder().encode('{"local":true}') },
  );
  expect(asset.status).toBe(200);
  expect(
    (
      await call(h, path + '/verification', {
        kind: 'domain',
        assetId: asset.data.id,
        approved: true,
        expiresAt: time(86400000),
        domain: 'synthetic.example',
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call(p.verifier, path + '/verification', {
        kind: 'domain',
        assetId: asset.data.id,
        approved: true,
        expiresAt: time(86400000),
        domain: 'synthetic.example',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(p.verifier, path + '/decide', {
        expected: r.data.revision,
        approved: true,
        reason: 'synthetic_review',
      })
    ).status,
  ).toBe(200);
  expect((await call(p.verifier, path + '/activate', { expected: '1' })).status).toBe(200);
  expect((await call(h, path)).data.organization.status).toBe('active');
}, 90000);
it('publishes independently moderated exact-money offers and privately imports deduplicated coupon codes', async () => {
  const c = await p.company(),
    offer = uuid('partner_offer'),
    root = 'partners/organizations/' + c.org,
    path = root + '/offers/' + offer;
  expect(
    (await call(c.handle, path + '/draft', { version: 1, body: offerBody(), targets: [target()] }))
      .status,
  ).toBe(200);
  expect((await call(c.handle, path + '/submit', { version: 1 })).status).toBe(200);
  expect(
    (
      await call(c.handle, path + '/review', {
        version: 1,
        approved: true,
        reason: 'synthetic_review',
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call(p.moderator, path + '/review', {
        version: 1,
        approved: true,
        reason: 'synthetic_review',
      })
    ).status,
  ).toBe(200);
  expect((await call(p.moderator, path + '/publish', { version: 1, expected: null })).status).toBe(
    200,
  );
  expect((await call(c.handle, path + '/preview?version=1')).data.text).toContain('USD 25.00');
  const upload = await call(
      c.handle,
      root + '/assets?purpose=coupon_pool&mime=text%2Fcsv',
      undefined,
      { raw: new TextEncoder().encode('code\nPRIVATE1\nPRIVATE1\nPRIVATE2') },
    ),
    pool = uuid('coupon_pool');
  expect(upload.status).toBe(200);
  expect(
    (
      await call(c.handle, root + '/pools', {
        id: pool,
        offerId: offer,
        version: 1,
        mode: 'unique',
        assetId: upload.data.id,
        prefix: null,
        sharedCode: null,
      })
    ).status,
  ).toBe(200);
  const queued = await call(c.handle, root + '/imports', {
    poolId: pool,
    assetId: upload.data.id,
    expiresAt: time(86400000),
  });
  expect(queued.status).toBe(200);
  const lease = value(await p.consumer.lease(queued.data.jobId));
  value(await p.consumer.process(lease!));
  const status = await call(c.handle, root + '/imports/' + queued.data.id);
  expect(status.status).toBe(200);
  expect(status.data).toMatchObject({ state: 'ready', accepted: 2, duplicates: 1 });
  expect(
    (await call(c.handle, root + '/imports/' + queued.data.id + '/errors')).data.truncated,
  ).toBe(false);
  expect(JSON.stringify(status.body)).not.toMatch(/PRIVATE1|PRIVATE2|keyVersion|requester|subject/);
  expect((await call(c.handle, root + '/pools/' + pool)).data).toMatchObject({
    available: 2,
    total: 2,
  });
}, 90000);
it('durably admits a command once across concurrent requests and returns conflict for changed payload', async () => {
  const h = p.session(),
    key = randomUUID(),
    body = { legalName: 'Once only', market: 'US' };
  const result = await Promise.all([
    call(h, 'partners/organizations', body, { key }),
    call(h, 'partners/organizations', body, { key }),
  ]);
  expect(result.map((x) => x.status).sort()).toEqual([200, 409]);
  expect(
    (await call(h, 'partners/organizations', { ...body, legalName: 'Different' }, { key })).status,
  ).toBe(409);
  const count = (
    await f.admin.query(
      "SELECT count(*)::int n FROM partners.organizations WHERE legal_name='Once only'",
    )
  ).rows[0]?.n;
  expect(count).toBe(1);
});
it('enforces HTTP quotas without calling services and hides raw exception details', async () => {
  limited = true;
  try {
    expect(
      (await call(p.session(), 'partners/organizations', { legalName: 'Limited', market: 'US' }))
        .status,
    ).toBe(429);
  } finally {
    limited = false;
  }
});
it('runs private CSV upload, validation, diff, separate approval and publication through running HTTP', async () => {
  const e = await csv.example(),
    u = staffToken(csv.uploader),
    reviewer = staffToken(csv.reviewer),
    publisher = staffToken(csv.publisher),
    { command: sourceCommand, ...metadata } = e.input;
  const uploaded = await call(
    u,
    'staff/csv/uploads?' + new URLSearchParams(metadata).toString(),
    undefined,
    { raw: e.bytes, key: sourceCommand },
  );
  expect(uploaded.status).toBe(200);
  const root = 'staff/csv/uploads/' + uploaded.data.id;
  expect((await call(u, root + '/status')).data.phase).toBe('registered');
  expect((await call(u, root + '/validate', {})).status).toBe(200);
  const preview = await call(reviewer, root + '/preview', {});
  expect(preview.status).toBe(200);
  expect(preview.data.evidence.validation).toMatchObject({ accepted: '1', rejected: '0' });
  expect(
    preview.data.evidence.changes.some(
      (row: { kind: string; added: string }) => row.kind === 'tireModels' && row.added === '1',
    ),
  ).toBe(true);
  expect(
    (
      await call(u, root + '/review', {
        previewId: preview.data.id,
        decision: 'approved',
        reason: 'checks_passed',
      })
    ).status,
  ).toBe(409);
  const review = await call(reviewer, root + '/review', {
    previewId: preview.data.id,
    decision: 'approved',
    reason: 'checks_passed',
  });
  expect(review.status).toBe(200);
  expect((await call(u, root + '/publish', { reviewId: review.data.id })).status).not.toBe(200);
  expect((await call(publisher, root + '/publish', { reviewId: review.data.id })).status).toBe(200);
  const publishedStatus = (await call(u, root + '/status')).data;
  expect(publishedStatus.phase).toBe('published');
  expect(publishedStatus.publicationBundleId).toMatch(/^[a-f0-9-]{36}$/);
  const receipt = await call(publisher, root + '/receipt');
  expect(receipt.status).toBe(200);
  expect(receipt.data.publicationBundleId).toBe(publishedStatus.publicationBundleId);
  expect((await call(u, root + '/receipt')).status).toBe(409);
  expect(JSON.stringify(preview.body)).not.toMatch(
    /object_key|objectKey|bucket|envelope|encrypted/,
  );
}, 90000);
it('rejects path/URL uploads, spoofed actor fields, stale MFA, invalid IDs and content types', async () => {
  const u = staffToken(csv.uploader),
    bad = staffToken(csv.uploader);
  staff.set(bad, { ...staff.get(bad)!, mfaAt: Date.now() - 301000 });
  expect(
    (
      await call(bad, 'staff/csv/templates', {
        mapping: 'tire_models_v1',
        version: 99,
        maxBytes: 100,
        maxRows: 10,
        state: 'active',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(u, 'staff/csv/uploads?url=https%3A%2F%2Fexample.com', undefined, {
        raw: new Uint8Array([1]),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(p.session(), 'partners/organizations', {
        legalName: 'X',
        market: 'US',
        subject: 'other',
      })
    ).status,
  ).toBe(400);
  expect((await call(p.session(), 'partners/organizations/nope')).status).toBe(400);
  expect(
    (
      await call(
        p.session(),
        'partners/organizations',
        { legalName: 'X', market: 'US' },
        { headers: { 'content-type': 'text/plain' } },
      )
    ).status,
  ).toBe(415);
});
it('denies revoked partner sessions on later reads and refuses ordinary partners masked operations', async () => {
  const c = await p.company();
  p.sessions.delete(c.handle);
  expect((await call(c.handle, 'partners/organizations/' + c.org)).status).toBe(401);
  expect((await call(p.session(), 'partners/operations/visitors?week=' + i.week)).status).toBe(404);
  expect((await call(i.visitors, 'partners/operations/visitors?week=' + i.week)).status).toBe(200);
});
it('simulates stored offer targets with the shared matcher without accepting capacity or issuing a code', async () => {
  const c = await p.company(),
    offer = await p.published(c.org, c.handle),
    before = (await f.admin.query('SELECT count(*)::int n FROM partners.coupon_reservations'))
      .rows[0]!.n;
  const r = await call(
    c.handle,
    'partners/organizations/' + c.org + '/offers/' + offer + '/simulate',
    {
      version: 1,
      audience: {
        market: 'US',
        currency: 'USD',
        quantity: 4,
        subtotalMinor: '80000',
        region: 'CA',
        postal: '90001',
        latitude: null,
        longitude: null,
        products: [
          {
            skuId: uuid('sku'),
            modelId: uuid('model'),
            brandId: null,
            size: '225/65R17',
            rim: '17',
            category: 'touring',
            vehicleType: null,
            tier: null,
          },
        ],
      },
    },
  );
  expect(r.status).toBe(200);
  expect(r.data).toMatchObject({ hypothetical: true, capacityChecked: false });
  expect(r.data.decisions[0].offerId).toBe(offer);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM partners.coupon_reservations')).rows[0]!.n,
  ).toBe(before);
});
it('rolls back only a published intake with a current publisher and an exact pre-recorded approval', async () => {
  const a = await csv.reviewed(),
    first = value(
      await csv.service.publish(csv.publisher, {
        intakeId: a.id,
        reviewId: a.review.id,
        command: 'publish-' + randomUUID(),
      }),
    );
  const b = await csv.reviewed();
  value(
    await csv.service.publish(csv.publisher, {
      intakeId: b.id,
      reviewId: b.review.id,
      command: 'publish-' + randomUUID(),
    }),
  );
  const head = (
      await f.admin.query(
        "SELECT bundle_id,revision::text FROM app.market_dataset_heads WHERE market='US'",
      )
    ).rows[0]!,
    approvalId = uuid('audit_event'),
    body = {
      bundleId: first,
      expectedBundleId: head.bundle_id as string,
      expected: head.revision as string,
      approvalId,
    };
  expect(
    (await call(staffToken(csv.publisher), 'staff/csv/uploads/' + b.id + '/rollback', body)).status,
  ).toBe(404);
  const input = {
    actorId: csv.publisher,
    approvalId,
    bundleId: first,
    market: 'US',
    expectedHead: { bundleId: p2Id('bundle', head.bundle_id), revision: p2Rev(head.revision) },
  };
  await f.admin.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'import.rollback','dataset_bundle','approved',now(),$2,'[]')",
    [approvalId, rollbackDigest(input)],
  );
  expect(
    (await call(staffToken(csv.uploader), 'staff/csv/uploads/' + b.id + '/rollback', body)).status,
  ).not.toBe(200);
  const r = await call(staffToken(csv.publisher), 'staff/csv/uploads/' + b.id + '/rollback', body);
  expect(r.status).toBe(200);
  expect(r.data.value).toBe(first);
  expect(
    (await f.admin.query("SELECT bundle_id FROM app.market_dataset_heads WHERE market='US'"))
      .rows[0]!.bundle_id,
  ).toBe(first);
}, 90000);

it('registers and cancels an owner-scoped pilot reservation intent without dispatching or revealing coupon secrets', async () => {
  const e = await pilot.message({ capture: false, due: false }),
    token = randomBytes(32).toString('base64url');
  staff.set(token, { keys: [e.owner.token], csrf: 'synthetic-csrf' });
  const before = (await f.admin.query('SELECT count(*)::int n FROM partners.coupon_reservations'))
    .rows[0]!.n;
  const r = await call(token, 'sends/' + e.send + '/partner-offers', e.request);
  expect(r.status).toBe(200);
  const stranger = randomBytes(32).toString('base64url');
  staff.set(stranger, { keys: [], csrf: 'synthetic-csrf' });
  expect((await call(stranger, 'sends/' + e.send + '/partner-offers', e.request)).status).not.toBe(
    200,
  );
  expect((await call(token, 'sends/' + e.send + '/partner-offers/cancel', {})).status).toBe(200);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM partners.coupon_reservations')).rows[0]!.n,
  ).toBe(before);
  expect(pilot.provider.send).not.toHaveBeenCalled();
}, 90000);
it('reauthorizes private preview evidence after storage I/O and refuses a role withdrawn during the read', async () => {
  const e = await csv.prepared(),
    reviewer = await csv.operator('data.review');
  let revoked = false;
  const service = await createStaffCsvRuntime({
      ...csv.options,
      files: {
        ...csv.files,
        async read(id) {
          const bytes = await csv.files.read(id);
          if (!revoked) {
            revoked = true;
            await f.admin.query(
              'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1',
              [reviewer],
            );
          }
          return bytes;
        },
      },
    }),
    raw = staffToken(reviewer),
    admission = createP2HttpAdmission(p.service),
    local = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        routes: staffCsvRoutes({ service, admission, secret }),
        security: {
          authenticate: async (r) =>
            staff.get(r.headers.get('authorization')?.slice(7) ?? '') ?? null,
          quota: async () => ({ allowed: true }),
        },
      }),
    );
  try {
    const response = await fetch(local.origin + '/api/v1/staff/csv/uploads/' + e.id + '/preview', {
      method: 'POST',
      headers: {
        origin: local.origin,
        authorization: 'Bearer ' + raw,
        'x-csrf-token': csrf(raw),
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(revoked).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toMatch(/changes|evidence|rawHash|packetHash/);
  } finally {
    await local.close();
  }
});
it('binds every generated private operation to the same running opt-in API host', () => {
  const expected = Object.keys({
    ...ownerP2Operations,
    ...partnerP2Operations,
    ...staffP2Operations,
  });
  expect(expected).toHaveLength(64);
  expect(expected.every((id) => declaredOperations.filter((x) => x === id).length === 1)).toBe(
    true,
  );
  expect(new Set(declaredOperations).size).toBe(declaredOperations.length);
});
it('runs explicit photo confirmation, deterministic report, validated exact reuse, frozen send and erasure headlessly', async () => {
  const e = await photo.example(),
    raw = ownerToken(e.keys),
    client = createP2OwnerClient(host.origin, clientTransport(raw));
  const command = () => commandFor(raw);
  const batch = (await client.p2PhotoCapture({ body: { policyId: e.policy }, command: command() }))
    .data;
  const { key: sourceKey, ...photoInput } = e.input;
  const intent = (
    await client.p2PhotoIntent({
      body: { ...photoInput, batchId: batch.batchId },
      command: { ...command(), key: sourceKey },
    })
  ).data;
  if (intent.state === 'manual') throw Error('Synthetic allowed processing required');
  const path = { upload: intent.id };
  await client.p2PhotoFinalize({ path, bytes: e.bytes, grant: intent.grant, command: command() });
  const request = (await client.p2PhotoExtract({ path, body: {}, command: command() })).data;
  value(await photo.service.execute(p2Id('ai_request', request.id)));
  const suggestions = (await client.p2PhotoStatus({ path })).data;
  expect(suggestions.confirmations).toEqual([]);
  const candidate = suggestions.candidates.find((x) => x.field === 'tire_size')!;
  const confirmed = (
    await client.p2PhotoConfirm({
      path,
      body: { candidateId: candidate.id, field: 'tire_size', revision: '1', value: '225/45R18' },
      command: command(),
    })
  ).data;
  expect(confirmed.origin).toBe('corrected_candidate');
  await f.admin.query(
    "UPDATE app.market_dataset_heads SET bundle_id=$1,revision=revision+1 WHERE market='US'",
    [f.bundleId],
  );
  const created = await call(raw, 'reports', {
    market: 'US',
    regionKey: 'SYNTHETIC_US',
    configurationId: null,
    wheelPackage: null,
    sizes: { front: confirmed.value, rear: '255/40R18' },
    strategy: 'year_round',
    winterUse: 'none',
    replace: ['front_left', 'front_right', 'rear_left', 'rear_right'],
    priorities: ['wet'],
    budget: null,
  });
  expect(created.status).toBe(200);
  const report = String(created.data.report_id),
    versionPath = { report, version: '1' };
  const original = (
    await f.admin.query(
      'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
      [report],
    )
  ).rows;
  expect(original).toHaveLength(1);
  expect(original[0].input_snapshot.sizes.front).toBe(confirmed.value);
  expect(original[0].output_snapshot.purpose).toBe('technical_evaluation');
  expect(original[0].output_snapshot.issuanceAuthorized).toBe(false);
  const policy = await analysis.example();
  await f.admin.query(
    "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,100000,100000,100000,2,'active',$2 FROM app.ai_policy_versions WHERE id=$1",
    [policy.policy, f.staff],
  );
  const input = { policyId: policy.policy, allowed: true, noticeVersion: 'ai-processing-v1' };
  const pending = (
    await client.p2AnalysisRequest({ path: versionPath, body: input, command: command() })
  ).data;
  expect(pending.state).toBe('pending');
  value(await runtime.execute(p2Id('ai_request', pending.id)));
  const available = (await client.p2AnalysisStatus({ path: { request: pending.id! } })).data;
  expect(available.state).toBe('available');
  const calls = analysis.calls.length;
  expect(
    (await client.p2AnalysisRequest({ path: versionPath, body: input, command: command() })).data
      .state,
  ).toBe('available');
  expect(analysis.calls).toHaveLength(calls);
  const attachment = (await client.p2AnalysisAttachment({ path: versionPath })).data;
  expect(attachment.state).toBe('available');
  if (attachment.state !== 'available') throw Error('Validated attachment required');
  if (!frozenDelivery) throw Error('Owned synthetic delivery composition required');
  const send = (
    await client.p2AnalysisDelivery({
      body: {
        ...frozenDelivery.input,
        report: { id: report, version: 1 },
        notices: { report: frozenDelivery.contactPolicy.notices.report! },
        analysis: { attachmentRevision: attachment.attachment.revision, fallback: null },
      },
      command: command(),
    })
  ).data;
  const frozen = await frozenDelivery.row(send.id);
  expect(frozen.document.analysisIdentity.attachmentRevision).toBe(attachment.attachment.revision);
  expect(frozenDelivery.provider.send).not.toHaveBeenCalled();
  await frozenDelivery.due(send.id);
  value(await frozenDelivery.service.dispatch(p2Id('send', send.id)));
  const first = frozenDelivery.provider.send.mock.calls[0]![1];
  expect(first.mail.text).toContain('AI-assisted');
  value(await frozenDelivery.service.dispatch(p2Id('send', send.id)));
  expect(frozenDelivery.provider.send).toHaveBeenCalledTimes(1);
  expect((await frozenDelivery.row(send.id)).document.analysisIdentity).toEqual(
    frozen.document.analysisIdentity,
  );
  const removed = (await client.p2PhotoDelete({ path, body: {}, command: command() })).data;
  await expect(client.p2PhotoStatus({ path })).rejects.toBeDefined();
  for (
    let n = 0;
    n < 80 &&
    value(await privacy.service.status(p2Id('analysis_erasure', removed.jobId))) !== 'complete';
    n++
  )
    value(await privacy.service.workOne(p2Id('analysis_erasure', removed.jobId)));
  expect(value(await privacy.service.status(p2Id('analysis_erasure', removed.jobId)))).toBe(
    'complete',
  );
  const processing = (await client.p2AnalysisStatus({ path: { request: pending.id! } })).data
    .processing;
  if (!processing) throw Error('Owned current processing permission required');
  await client.p2AnalysisChoice({
    path: { scope: processing.scopeId },
    body: {
      allowed: false,
      expectedRevision: processing.permissionRevision,
      noticeVersion: 'ai-processing-v1',
    },
    command: command(),
  });
  expect((await client.p2AnalysisAttachment({ path: versionPath })).data.state).toBe('unavailable');
  expect(
    (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [report],
      )
    ).rows,
  ).toEqual(original);
  console.log(
    'P2_API_HEADLESS_EVIDENCE ' +
      JSON.stringify({
        confirmedOnly: true,
        actualDeterministicEngine: true,
        actualPostgreSQL: true,
        exactReuseWithoutExtraModelCall: true,
        frozenSelectionPreserved: true,
        ownedPhotoPurged: true,
        withdrawalDenied: true,
        reportFactsPreserved: true,
        syntheticModelAndMail: true,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        actualModelEvaluation: false,
        actualAcceptance: false,
        gatesClosed: 0,
        casesClosed: 0,
      }),
  );
}, 120000);
it('uses independent owner API intents and workers for the last code while mixed private reads remain responsive', async () => {
  const offer = await pilot.offer('unique'),
    a = await pilot.message({ capture: false }),
    b = await pilot.message({ capture: false });
  for (const m of [a, b]) {
    const raw = ownerToken([m.owner.token]);
    await createP2OwnerClient(host.origin, clientTransport(raw)).p2PilotRequest({
      path: { send: m.send },
      body: m.request,
      command: commandFor(raw),
    });
  }
  const loadTenant = await p.company(),
    reader = createP2PartnerClient(host.origin, clientTransport(loadTenant.handle));
  const before = pilot.provider.send.mock.calls.length,
    durations: number[] = [];
  const workers = Promise.all([pilot.service.dispatch(a.send), pilot.fresh().dispatch(b.send)]);
  const load = Promise.all(
    Array.from({ length: 16 }, async () => {
      const start = performance.now();
      const r = await reader.p2Organization({ path: { org: loadTenant.org } });
      expect(r.data.organization.id).toBe(loadTenant.org);
      durations.push(performance.now() - start);
    }),
  );
  const results = await workers;
  await load;
  expect(results.every((r) => r.ok)).toBe(true);
  expect(
    pilot.provider.send.mock.calls.slice(before).filter((x) => x[1].mail.commercial),
  ).toHaveLength(1);
  const codes = (
    await f.admin.query(
      "SELECT count(*)::int n FROM partners.coupon_reservations WHERE org_id=$1 AND state='issued'",
      [offer.org],
    )
  ).rows[0]!.n;
  expect(codes).toBe(1);
  durations.sort((a, b) => a - b);
  console.log(
    'P2_API_MIXED_LOAD_EVIDENCE ' +
      JSON.stringify({
        concurrentHttpReads: 16,
        independentSqlWorkers: 2,
        issuedUniqueCodes: codes,
        p95Ms: Math.ceil(durations[Math.ceil(durations.length * 0.95) - 1]!),
        maxMs: Math.ceil(durations.at(-1)!),
        syntheticMailOnly: true,
        productionSlaAccepted: false,
        actualRecipientNotifications: 0,
        gatesClosed: 0,
        casesClosed: 0,
      }),
  );
}, 120000);
it('runs staff typed upload, immutable evidence, independent review and publication receipts on the combined API', async () => {
  const e = await csv.example(),
    uploaderRaw = staffToken(csv.uploader),
    reviewerRaw = staffToken(csv.reviewer),
    publisherRaw = staffToken(csv.publisher);
  const uploader = createP2StaffClient(host.origin, clientTransport(uploaderRaw)),
    reviewer = createP2StaffClient(host.origin, clientTransport(reviewerRaw)),
    publisher = createP2StaffClient(host.origin, clientTransport(publisherRaw));
  const { command: sourceCommand, ...query } = e.input;
  const intake = (
    await uploader.p2CsvUpload({
      query: { ...query, market: 'US' },
      bytes: e.bytes,
      command: { ...commandFor(uploaderRaw), key: sourceCommand },
    })
  ).data;
  if (!intake.id) throw Error('Synthetic valid intake required');
  const path = { intake: intake.id };
  await uploader.p2CsvValidate({ path, body: {}, command: commandFor(uploaderRaw) });
  const preview = (
    await reviewer.p2CsvPreview({ path, body: {}, command: commandFor(reviewerRaw) })
  ).data;
  expect(preview.evidence.validation.accepted).toBe('1');
  await expect(
    reviewer.p2CsvReview({
      path: { intake: randomUUID() },
      body: { previewId: preview.id, decision: 'approved', reason: 'checks_passed' },
      command: commandFor(reviewerRaw),
    }),
  ).rejects.toBeDefined();
  const review = (
    await reviewer.p2CsvReview({
      path,
      body: { previewId: preview.id, decision: 'approved', reason: 'checks_passed' },
      command: commandFor(reviewerRaw),
    })
  ).data;
  await expect(
    uploader.p2CsvPublish({
      path,
      body: { reviewId: review.id },
      command: commandFor(uploaderRaw),
    }),
  ).rejects.toBeDefined();
  const publication = (
    await publisher.p2CsvPublish({
      path,
      body: { reviewId: review.id },
      command: commandFor(publisherRaw),
    })
  ).data;
  expect((await publisher.p2CsvReceipt({ path })).data.publicationBundleId).toBe(publication.value);
  expect((await uploader.p2CsvStatus({ path })).data.phase).toBe('published');
}, 120000);
it('protects admission records with forced RLS, serializes independent SQL contenders and fails closed at its row cap', async () => {
  const admission = createP2HttpAdmission(p.service),
    hash = 'd'.repeat(64),
    fingerprint = 'e'.repeat(64);
  const claims = await Promise.all(
    Array.from({ length: 12 }, () => admission.claim(hash, fingerprint)),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  await expect(admission.claim('invalid', fingerprint)).rejects.toThrow();
  const direct = await p.service.unitOfWork.run(async (tx) =>
    ok(
      (await p.service.query(tx, 'SELECT command_hash FROM admin.p2_http_admissions LIMIT 1')).rows,
    ),
  );
  expect(direct.ok).toBe(false);
  const catalog = (
    await f.admin.query(
      "SELECT c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='admin' AND c.relname='p2_http_admissions'",
    )
  ).rows[0];
  expect(catalog).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const current = (await f.admin.query('SELECT count(*)::int n FROM admin.p2_http_admissions'))
    .rows[0]!.n;
  await f.admin.query(
    "INSERT INTO admin.p2_http_admissions(command_hash,fingerprint) SELECT encode(sha256(convert_to('synthetic-cap-'||n::text,'UTF8')),'hex'),$2 FROM generate_series(1,$1::int) n",
    [100000 - current, fingerprint],
  );
  await expect(admission.claim('f'.repeat(64), fingerprint)).rejects.toThrow(
    'HTTP admission unavailable',
  );
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM admin.p2_http_admissions')).rows[0]!.n,
  ).toBe(100000);
}, 30000);
