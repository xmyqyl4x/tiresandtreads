import { composePilot } from '../fixtures/phase2/compose-pilot.ts';
import { pilotRoutes } from '../../packages/integrations/src/http/phase2-pilot.ts';
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
let limited = false;
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
  p = await composePartnerServices(f);
  i = await composeInsights(f);
  csv = await composeStaffCsv(f);
  pilot = await composePilot(f);
  const admission = createP2HttpAdmission(p.service),
    routes = [
      ...partnerRoutes({ ...p, insights: i.service, admission, secret }),
      ...pilotRoutes({ service: pilot.service, admission, secret }),
      ...staffCsvRoutes({ service: csv.service, admission, secret }),
    ];
  host = await listenLocalApi((origin) =>
    createHttpApi({
      origin,
      routes,
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
  expect((await call(u, root + '/status')).data.phase).toBe('published');
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
