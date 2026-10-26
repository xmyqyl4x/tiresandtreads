import { afterAll, beforeAll, it, expect } from 'vitest';
import { privateFixture, uid, time, key, result } from '../fixtures/private/database.ts';
import { createCommercialRuntime } from '../../packages/integrations/src/commercial-runtime.ts';
import { ok, fail, type Result, type Id } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import type { CommercialPolicy } from '../../packages/domain/src/commercial-policy.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
async function staff(role = 'commercial_operator') {
  const id = uid('staff');
  await f.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
    [id, id],
  );
  await f.admin.query(
    'INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code=$2',
    [id, role],
  );
  return id;
}
async function setup(
  options: {
    check?: () => Promise<'valid' | 'invalid' | 'unavailable'>;
    recover?: () => Promise<Result<unknown, ReturnType<typeof failure>>>;
    activated?: boolean;
    clock?: () => string;
  } = {},
) {
  const actor = await staff(),
    reviewer = await staff(),
    support = await staff('support_operator'),
    privacy = await staff('privacy_operator');
  const scopes = {
    staff: f.adapter('tt_staff_service_runtime'),
    commercial: f.adapter('tt_commercial_runtime'),
    public: f.adapter('tt_public_runtime'),
  };
  let calls = 0;
  const parameters = {
    scopes,
    now: options.clock ?? (() => time()),
    externalActivationApproved: options.activated ?? false,
    checker: { check: async () => (options.check ? options.check() : ('valid' as const)) },
    mail: {
      async reconcile() {
        calls++;
        return options.recover ? options.recover() : ok({ status: 'manual_review' });
      },
      async replay() {
        calls++;
        return ok('processed');
      },
    },
    privacy: {
      async retry(_actor: Id<'staff'>, _target: Id<'privacy_request'>, _evidence: string) {
        expect(_actor).toBe(privacy);
        expect(_target).toMatch(/^[a-f0-9-]{36}$/);
        expect(_evidence).toHaveLength(64);
        calls++;
        return ok(null);
      },
    },
  };
  return {
    ...(await createCommercialRuntime(parameters)),
    actor,
    reviewer,
    support,
    privacy,
    scopes,
    parameters,
    calls: () => calls,
  };
}
function policy(): CommercialPolicy {
  return {
    schemaVersion: 1,
    issuedAt: time(-1000),
    expiresAt: time(3600000),
    accountId: null,
    adsTxt: [],
    blockedCategories: [],
    blockedUrls: [],
    slots: [
      {
        key: 'education_one',
        route: 'education',
        width: 320,
        height: 250,
        housePath: '/guides/before-you-buy',
        houseLabel: 'Before you buy',
      },
    ],
  };
}
it('rejects elevated or swapped runtime credentials before composing service adapters', async () => {
  const s = await setup();
  await expect(
    createCommercialRuntime({ ...s.parameters, scopes: { ...s.scopes, staff: f.scope } }),
  ).rejects.toThrow('role');
});
it('previews without writes, requires distinct current reviewers, and fences concurrent configuration publishers', async () => {
  const s = await setup(),
    p = policy();
  const before = (
    await f.admin.query(
      "SELECT count(*) FROM admin.configuration_versions WHERE key='commercial_policy'",
    )
  ).rows[0].count;
  value(await s.commercial.preview(s.actor, p));
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM admin.configuration_versions WHERE key='commercial_policy'",
      )
    ).rows[0].count,
  ).toBe(before);
  expect(await s.commercial.publish(s.actor, s.actor, 0, p)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  const head = (
    await f.admin.query(
      "SELECT COALESCE(max(version),0) AS n FROM admin.configuration_versions WHERE key='commercial_policy'",
    )
  ).rows[0].n;
  const writes = await Promise.all([
    s.commercial.publish(s.actor, s.reviewer, Number(head), p),
    s.commercial.publish(s.actor, s.reviewer, Number(head), p),
  ]);
  expect(writes.filter((r) => r.ok)).toHaveLength(1);
  expect(writes.filter((r) => !r.ok)).toMatchObject([{ error: { code: 'conflict' } }]);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM admin.audit_events WHERE action IN ('commercial.configure','commercial.review')",
      )
    ).rows[0].count,
  ).toBe('2');
});
it('enforces current roles and returns keyset pages with no identity, payload or credential fields', async () => {
  const s = await setup();
  for (let i = 0; i < 3; i++)
    await f.admin.query(
      "INSERT INTO app.webhook_inbox(provider,provider_event_id,payload_digest,received_at,signature_verified_at) VALUES('resend',$1,decode($2,'hex'),now(),now())",
      [uid('event'), key().digest],
    );
  expect(await s.staff.queue(s.actor, 'callbacks')).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  const page = value(await s.staff.queue(s.support, 'callbacks', null, 2));
  expect(page.items).toHaveLength(2);
  expect(page.next).not.toBeNull();
  expect(Object.keys(page.items[0]!).sort()).toEqual(['dueAt', 'id', 'state']);
  const next = value(await s.staff.queue(s.support, 'callbacks', page.next, 2));
  expect(next.items[0]!.id > page.items[1]!.id).toBe(true);
  await f.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=now(),revision=revision+1,updated_at=now() WHERE staff_id=$1',
    [s.support],
  );
  expect(await s.staff.queue(s.support, 'callbacks')).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
it('audits concurrent recovery once, binds replay to the actor/input, and never force-resends', async () => {
  const s = await setup(),
    command = uid('command'),
    target = uid('send'),
    evidence = key().digest;
  const results = await Promise.all([
    s.staff.recover(s.support, command, 'mail_reconcile', target, evidence),
    s.staff.recover(s.support, command, 'mail_reconcile', target, evidence),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(s.calls()).toBe(1);
  expect(
    value(await s.staff.recover(s.support, command, 'mail_reconcile', target, evidence)).state,
  ).toBe('succeeded');
  expect(s.calls()).toBe(1);
  expect(
    await s.staff.recover(s.support, command, 'mail_reconcile', uid('send'), evidence),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    await s.staff.recover(s.actor, uid('command'), 'mail_reconcile', target, evidence),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(
    value(
      await s.staff.recover(s.support, uid('command'), 'callback_replay', uid('inbox'), evidence),
    ).state,
  ).toBe('succeeded');
  expect(
    value(
      await s.staff.recover(
        s.privacy,
        uid('command'),
        'privacy_retry',
        uid('privacy_request'),
        evidence,
      ),
    ).state,
  ).toBe('succeeded');
  const stored = (
    await f.admin.query('SELECT * FROM admin.recovery_commands WHERE id=$1', [command])
  ).rows[0];
  expect(JSON.stringify(stored)).not.toContain(target);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM admin.audit_events a JOIN admin.audit_identity_links l ON l.event_id=a.id WHERE l.actor_staff_id=$1 AND action='recovery.mail_reconcile'",
        [s.support],
      )
    ).rows[0].count,
  ).toBe('2');
});
it('retains failed/unknown recovery outcomes and refuses automatic replay after provider or commit uncertainty', async () => {
  for (const error of ['forbidden', 'commit_unknown', 'throw'] as const) {
    const s = await setup({
        recover: async () => {
          if (error === 'throw') throw Error('private provider details');
          return fail(failure(error));
        },
      }),
      command = uid('command'),
      target = uid('send'),
      evidence = key().digest;
    expect(
      value(await s.staff.recover(s.support, command, 'mail_reconcile', target, evidence)).state,
    ).toBe(error === 'forbidden' ? 'failed' : 'unknown');
    await s.staff.recover(s.support, command, 'mail_reconcile', target, evidence);
    expect(s.calls()).toBe(1);
  }
});
it('bounds staff inputs, scopes every queue, and rejects disabled identities', async () => {
  const s = await setup(),
    data = await staff('data_operator');
  for (const [actor, queue] of [
    [data, 'imports'],
    [s.privacy, 'privacy'],
    [s.support, 'mail'],
  ] as const)
    expect((await s.staff.queue(actor, queue)).ok).toBe(true);
  expect(await s.staff.queue(s.support, 'privacy')).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  for (const [queue, after, limit] of [
    ['toString', null, 25],
    ['mail', 'bad', 25],
    ['mail', null, 101],
  ] as const)
    expect(await s.staff.queue(s.support, queue as 'mail', after, limit)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  expect(
    await s.staff.recover(s.support, 'bad', 'mail_reconcile', uid('send'), key().digest),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  await f.admin.query(
    "UPDATE admin.staff_identities SET status='disabled',updated_at=now(),revision=revision+1 WHERE id=$1",
    [s.support],
  );
  expect(await s.staff.queue(s.support, 'mail')).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
async function publish(s: Awaited<ReturnType<typeof setup>>, p = policy()) {
  const head = Number(
    (
      await f.admin.query(
        "SELECT COALESCE(max(version),0) AS n FROM admin.configuration_versions WHERE key='commercial_policy' AND status='published'",
      )
    ).rows[0].n,
  );
  return value(await s.commercial.publish(s.actor, s.reviewer, head, p));
}
async function publicPage() {
  const page = uid('seo_page'),
    content = uid('content'),
    key = uid('content_key'),
    path = '/learn/page-' + key;
  await f.admin.query(
    "INSERT INTO app.published_content(id,content_key,cms_revision,locale,market,public_dto,content_hash,published_at) VALUES($1,$2,'1','en-US','US','{}',$3,now())",
    [content, key, 'a'.repeat(64)],
  );
  await f.admin.query(
    "INSERT INTO app.content_publications(content_key,locale,market,generation,content_id,checksum,published_at,expires_at) VALUES($1,'en-US','US',1,$2,$3,now(),now()+interval '1 hour')",
    [key, content, 'a'.repeat(64)],
  );
  await f.admin.query(
    "INSERT INTO app.content_publication_heads(content_key,locale,market,generation) VALUES($1,'en-US','US',1)",
    [key],
  );
  await f.admin.query(
    "INSERT INTO app.public_page_details(content_key,locale,market,generation,document_id,collection,public_path,document) VALUES($1,'en-US','US',1,$2,'articles',$3,'{}')",
    [key, uid('document'), path],
  );
  await f.admin.query(
    "INSERT INTO admin.seo_page_registry(id,public_path,locale,market,content_key,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,$2,'en-US','US',$3,'education',$4,now()+interval '1 hour','eligible',$2)",
    [page, path, key, f.staff],
  );
  return { page, path };
}
const signals = {
  consent: true,
  cmpAvailable: true,
  gpc: false,
  under13: false,
  internal: false,
  blocked: false,
  filled: true,
};
it('serves house content only on live registered public inventory and never touches engine ranks', async () => {
  const s = await setup(),
    page = await publicPage();
  const engine = engineFixture(),
    input = value(normalizeAssessment(engine.request)),
    before = evaluate(input, engine.snapshot);
  await publish(s);
  const rulesBefore = (
    await f.admin.query('SELECT document_hash FROM app.rule_versions ORDER BY id')
  ).rows;
  expect(value(await s.commercial.placements(page.path, 'US', signals))[0]?.mode).toBe('house');
  for (const path of [
    '/',
    '/reports/private',
    '/compare',
    '/email',
    '/privacy',
    '/learn/missing',
    page.path + '?token=private',
  ])
    expect(value(await s.commercial.placements(path, 'US', signals))).toEqual([]);
  expect(value(await s.commercial.adsTxt())).toMatchObject({ status: 'not_connected', body: '' });
  expect(
    value(await s.commercial.placements(page.path, 'US', { ...signals, under13: true })),
  ).toEqual([]);
  await f.admin.query(
    "UPDATE admin.seo_page_registry SET index_status='noindex',updated_at=now(),revision=revision+1 WHERE id=$1",
    [page.page],
  );
  expect(value(await s.commercial.placements(page.path, 'US', signals))).toEqual([]);
  expect(
    (await f.admin.query('SELECT document_hash FROM app.rule_versions ORDER BY id')).rows,
  ).toEqual(rulesBefore);
  expect(evaluate(input, engine.snapshot)).toEqual(before);
});
async function account(s: Awaited<ReturnType<typeof setup>>) {
  const c = uid('configuration'),
    a = uid('ad_account');
  await f.admin.query(
    "INSERT INTO admin.configuration_versions(id,key,version,value,status,published_at,reviewed_by) VALUES($1,$2,1,'{}','published',now(),$3)",
    [c, uid('network'), s.reviewer],
  );
  await f.admin.query(
    "INSERT INTO admin.ad_network_accounts(id,network,external_account_id,status,verified_at,configuration_id) VALUES($1,'synthetic',$2,'verified',now(),$3)",
    [a, uid('external'), c],
  );
  const v = Number(
    (await f.admin.query('SELECT COALESCE(max(version),0)+1 AS n FROM app.public_configurations'))
      .rows[0].n,
  );
  await f.admin.query(
    "INSERT INTO app.public_configurations(version,configuration_id,issued_at,expires_at,analytics,advertising,checksum) VALUES($1,$2,now(),now()+interval '1 hour',false,true,$3)",
    [v, c, 'a'.repeat(64)],
  );
  return a;
}
it('requires current approved network, public kill switch and consent, and blocks external ads until manual brand sync', async () => {
  const s = await setup({ activated: true }),
    a = await account(s),
    page = await publicPage();
  await publish(s, {
    ...policy(),
    accountId: a,
    adsTxt: ['example.com, fixture, DIRECT'],
  });
  expect(value(await s.commercial.placements(page.path, 'US', signals))[0]?.mode).toBe('external');
  expect(value(await s.commercial.adsTxt()).body).toBe('example.com, fixture, DIRECT\n');
  expect(
    value(await s.commercial.placements(page.path, 'US', { ...signals, consent: false }))[0]?.mode,
  ).toBe('house');
  value(await s.commercial.blockBrand(s.actor, 'blocked-fixture', 'US', 'Synthetic review'));
  expect(value(await s.commercial.placements(page.path, 'US', signals))[0]?.mode).toBe('house');
  await f.admin.query('DELETE FROM admin.ad_brand_blocks');
  await f.admin.query(
    "UPDATE admin.ad_network_accounts SET status='suspended',updated_at=now(),revision=revision+1 WHERE id=$1",
    [a],
  );
  expect(value(await s.commercial.placements(page.path, 'US', signals))[0]?.mode).toBe('house');
  expect(value(await s.commercial.adsTxt()).status).toBe('not_connected');
});
it('does not fall back to an older policy when the latest expires or the global kill switch is off', async () => {
  const s = await setup({ activated: true }),
    a = await account(s),
    page = await publicPage();
  await publish(s, { ...policy(), accountId: a });
  const future = await createCommercialRuntime({ ...s.parameters, now: () => time(7200000) });
  expect(value(await future.commercial.placements(page.path, 'US', signals))).toEqual([]);
  expect(value(await future.commercial.adsTxt()).status).toBe('not_connected');
  // Append a new current configuration; immutable snapshots are not rewritten to simulate shutdown.
  const c = uid('configuration');
  await f.admin.query(
    "INSERT INTO admin.configuration_versions(id,key,version,value,status,published_at,reviewed_by) VALUES($1,$2,1,'{}','published',now(),$3)",
    [c, uid('kill'), s.reviewer],
  );
  await f.admin.query(
    "INSERT INTO app.public_configurations(version,configuration_id,issued_at,expires_at,analytics,advertising,checksum) SELECT max(version)+1,$1,now(),now()+interval '1 hour',false,false,$2 FROM app.public_configurations",
    [c, 'a'.repeat(64)],
  );
  expect(value(await s.commercial.placements(page.path, 'US', signals))[0]?.mode).toBe('house');
});
async function retailer() {
  const id = uid('retailer'),
    terms = await f.asset();
  await f.admin.query(
    "INSERT INTO app.retailers(id,code,name,market,approved_origin,status) VALUES($1,$2,'Synthetic retailer','US','https://shop.example','active')",
    [id, id],
  );
  await f.admin.query(
    "INSERT INTO admin.affiliate_applications(retailer_id,network,status,submitted_at,approved_terms_asset_id) VALUES($1,'synthetic','approved',now(),$2)",
    [id, terms.id],
  );
  return id;
}
it('requires approved retailer terms, current exact-origin checks and revision-bound link health', async () => {
  const s = await setup(),
    r = await retailer(),
    k = uid('link'),
    input = {
      key: k,
      retailerId: r,
      destination: 'https://shop.example/tires?ref=site',
      market: 'US',
    };
  expect(value(await s.commercial.setAffiliate(s.actor, s.reviewer, input))).toEqual({
    revision: '1',
  });
  expect(value(await s.commercial.resolveAffiliate(k, 'US'))).toBeNull();
  value(await s.commercial.checkAffiliate(s.actor, k));
  expect(value(await s.commercial.resolveAffiliate(k, 'US'))).toMatchObject({
    destination: input.destination,
    referrerPolicy: 'no-referrer',
    rel: 'sponsored noopener noreferrer',
  });
  expect(await s.commercial.setAffiliate(s.actor, s.reviewer, input, '0')).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  value(
    await s.commercial.setAffiliate(
      s.actor,
      s.reviewer,
      { ...input, destination: 'https://shop.example/other' },
      '1',
    ),
  );
  expect(value(await s.commercial.resolveAffiliate(k, 'US'))).toBeNull();
  value(await s.commercial.checkAffiliate(s.actor, k));
  await f.admin.query(
    "UPDATE admin.affiliate_applications SET status='suspended',updated_at=now(),revision=revision+1 WHERE retailer_id=$1",
    [r],
  );
  expect(value(await s.commercial.resolveAffiliate(k, 'US'))).toBeNull();
});
it('records invalid/unavailable checks and rejects stale checks when a destination changes during I/O', async () => {
  for (const checkResult of ['invalid', 'unavailable'] as const) {
    const s = await setup({ check: async () => checkResult }),
      k = uid('link');
    value(
      await s.commercial.setAffiliate(s.actor, s.reviewer, {
        key: k,
        retailerId: await retailer(),
        destination: 'https://shop.example/tires',
        market: 'US',
      }),
    );
    value(await s.commercial.checkAffiliate(s.actor, k));
    expect(value(await s.commercial.resolveAffiliate(k, 'US'))).toBeNull();
  }
  const s = await setup(),
    r = await retailer(),
    k = uid('link'),
    input = { key: k, retailerId: r, destination: 'https://shop.example/a', market: 'US' };
  value(await s.commercial.setAffiliate(s.actor, s.reviewer, input));
  const raced = await createCommercialRuntime({
    ...s.parameters,
    checker: {
      async check() {
        value(
          await s.commercial.setAffiliate(
            s.actor,
            s.reviewer,
            { ...input, destination: 'https://shop.example/b' },
            '1',
          ),
        );
        return 'valid';
      },
    },
  });
  expect(await raced.commercial.checkAffiliate(s.actor, k)).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
});
function report(accountId: string, generation = '1') {
  return {
    accountId,
    start: '2026-10-01',
    end: '2026-10-02',
    sourceRevision: 'rev-' + generation,
    sourceGeneration: generation,
    fetchedAt: time(-1000),
    rows: [
      {
        day: '2026-10-01',
        dimension: 'all',
        currency: 'USD',
        impressions: '100',
        eligibleRequests: '200',
        revenueMinor: '123',
        revenueStatus: 'estimated' as const,
        viewableImpressions: '80',
        consentRequests: '150',
        totalRequests: '300',
        latencySamples: '10',
        latencyTotalMs: '1250',
      },
    ],
  };
}
it('stages and atomically approves aggregate reports, preserves provenance and calculates exact integer ratios', async () => {
  const s = await setup(),
    a = await account(s),
    r = report(a),
    i = value(await s.commercial.importReport(s.actor, r));
  expect(i.state).toBe('validated');
  expect(value(await s.commercial.revenue(s.actor, a, '2026-10-01')).status).toBe('not_reported');
  expect(await s.commercial.approveReport(s.actor, s.actor, i.id, '0')).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  value(await s.commercial.approveReport(s.actor, s.reviewer, i.id, '0'));
  expect(value(await s.commercial.revenue(s.actor, a, '2026-10-01'))).toMatchObject({
    status: 'reported',
    fillBasisPoints: '5000',
    rpmMinor: '1230',
    viewabilityBasisPoints: '8000',
    consentCoverageBasisPoints: '5000',
    meanLatencyMs: '125',
    metric: { revenueStatus: 'estimated', sourceRevision: 'rev-1', sourceGeneration: '1' },
  });
  expect(value(await s.commercial.importReport(s.actor, r)).id).toBe(i.id);
  expect(
    await s.commercial.importReport(s.actor, {
      ...r,
      rows: [{ ...r.rows[0], revenueMinor: '999' }],
    }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect((await s.commercial.approveReport(s.actor, s.reviewer, i.id, '0')).ok).toBe(true);
});
it('reconciles finalized negative corrections without adding estimates, omitted dimensions or currencies', async () => {
  const s = await setup(),
    a = await account(s),
    first = value(await s.commercial.importReport(s.actor, report(a)));
  value(await s.commercial.approveReport(s.actor, s.reviewer, first.id, '0'));
  await f.admin.query(
    "INSERT INTO app.currencies(code,minor_unit_digits) VALUES('EUR',2) ON CONFLICT DO NOTHING",
  );
  const correction = {
    ...report(a, '2'),
    rows: [
      {
        ...report(a).rows[0]!,
        revenueMinor: '-25',
        revenueStatus: 'finalized',
        currency: 'EUR',
        impressions: '0',
        eligibleRequests: null,
        viewableImpressions: null,
        consentRequests: null,
        totalRequests: null,
        latencySamples: null,
        latencyTotalMs: null,
      },
    ],
  };
  const next = value(await s.commercial.importReport(s.actor, correction));
  expect(await s.commercial.approveReport(s.actor, s.reviewer, next.id, '0')).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  value(await s.commercial.approveReport(s.actor, s.reviewer, next.id, '1'));
  expect(
    value(await s.commercial.revenue(s.actor, a, '2026-10-01', 'all', 'USD')).metric,
  ).toBeNull();
  expect(value(await s.commercial.revenue(s.actor, a, '2026-10-01', 'all', 'EUR'))).toMatchObject({
    status: 'reported',
    metric: { revenueMinor: '-25', impressions: '0', revenueStatus: 'finalized' },
    fillBasisPoints: null,
    rpmMinor: null,
    consentCoverageBasisPoints: null,
    meanLatencyMs: null,
  });
  const empty = value(await s.commercial.importReport(s.actor, { ...report(a, '3'), rows: [] }));
  value(await s.commercial.approveReport(s.actor, s.reviewer, empty.id, '2'));
  expect(
    value(await s.commercial.revenue(s.actor, a, '2026-10-01', 'all', 'EUR')).metric,
  ).toBeNull();
});
it('serializes concurrent generation publication, rejects stale sources and rolls back partially invalid batches', async () => {
  const s = await setup(),
    a = await account(s),
    one = value(await s.commercial.importReport(s.actor, report(a))),
    two = value(await s.commercial.importReport(s.actor, report(a, '2')));
  const outcomes = await Promise.all([
    s.commercial.approveReport(s.actor, s.reviewer, one.id, '0'),
    s.commercial.approveReport(s.actor, s.reviewer, two.id, '0'),
  ]);
  expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
  const current = (
    await f.admin.query(
      "SELECT max(source_generation)::text AS n FROM admin.ad_report_imports WHERE account_id=$1 AND state='approved'",
      [a],
    )
  ).rows[0].n;
  expect(
    await s.commercial.importReport(s.actor, { ...report(a, current), sourceRevision: 'stale' }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  const bad = {
    ...report(a, '10'),
    rows: [report(a).rows[0]!, { ...report(a).rows[0]!, day: '2026-10-02', currency: 'ZZZ' }],
  };
  expect((await s.commercial.importReport(s.actor, bad)).ok).toBe(false);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM admin.ad_report_imports WHERE account_id=$1 AND source_revision='rev-10'",
        [a],
      )
    ).rows,
  ).toEqual([]);
});
it('denies private dimensions, stale reviewers and unapproved accounts while distinguishing missing from zero', async () => {
  const s = await setup(),
    a = await account(s);
  expect(value(await s.commercial.revenue(s.actor, uid('ad_account'), '2026-10-01'))).toMatchObject(
    { status: 'not_connected', metric: null },
  );
  expect(await s.commercial.revenue(s.support, a, '2026-10-01')).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  for (const dim of ['report:secret', 'page:' + uid('report'), 'slot:' + uid('slot')])
    expect(
      (
        await s.commercial.importReport(s.actor, {
          ...report(a),
          rows: [{ ...report(a).rows[0], dimension: dim }],
        })
      ).ok,
    ).toBe(false);
  await f.admin.query(
    "UPDATE admin.ad_network_accounts SET status='suspended',updated_at=now(),revision=revision+1 WHERE id=$1",
    [a],
  );
  expect(await s.commercial.importReport(s.actor, report(a))).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  expect(
    await s.commercial.publish(s.actor, s.reviewer, 0, { ...policy(), accountId: a }),
  ).toMatchObject({ ok: false });
});
it('restricts service roles to masked queues and commercial data, excluding raw personal graphs and mutation bypasses', async () => {
  const s = await setup();
  for (const scope of Object.values(s.scopes))
    for (const table of [
      'privacy.contacts',
      'email.email_sends',
      'app.report_versions',
      'analytics.events',
      'admin.staff_identities',
    ])
      expect(
        await result(scope.unitOfWork, (tx) => scope.query(tx, `SELECT * FROM ${table} LIMIT 1`)),
      ).toMatchObject({ ok: false });
  for (const sql of [
    "UPDATE admin.roles SET permissions='[]'",
    'DELETE FROM admin.audit_events',
    "UPDATE app.rule_versions SET document='{}'",
  ])
    expect(
      await result(s.scopes.commercial.unitOfWork, (tx) => s.scopes.commercial.query(tx, sql)),
    ).toMatchObject({ ok: false });
  expect(
    await result(s.scopes.public.unitOfWork, (tx) =>
      s.scopes.public.query(tx, 'SELECT * FROM admin.ad_daily_metrics LIMIT 1'),
    ),
  ).toMatchObject({ ok: false });
});
it('rejects unapproved affiliate applications, malformed policy/report shapes and revoked reviewers', async () => {
  const s = await setup(),
    r = await retailer(),
    input = {
      key: uid('link'),
      retailerId: r,
      destination: 'https://shop.example/tires',
      market: 'US',
    };
  expect(
    await s.commercial.setAffiliate(s.actor, s.reviewer, {
      ...input,
      destination: 'https://evil.example/tires',
    }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  await f.admin.query(
    "UPDATE admin.affiliate_applications SET status='suspended',updated_at=now(),revision=revision+1 WHERE retailer_id=$1",
    [r],
  );
  expect((await s.commercial.setAffiliate(s.actor, s.reviewer, input)).ok).toBe(false);
  for (const raw of [null, {}, { ...policy(), extra: 'secret' }])
    expect(await s.commercial.preview(s.actor, raw)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  expect(
    await s.commercial.importReport(s.actor, { ...report(uid('ad_account')), email: 'private' }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(await s.commercial.resolveAffiliate('bad?token=secret', 'US')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(await s.commercial.checkAffiliate(s.actor, 'missing')).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
  expect(await s.commercial.revenue(s.actor, uid('ad_account'), '2026-02-30')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(await s.commercial.publish(s.actor, s.reviewer, -1, policy())).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(await s.commercial.blockBrand(s.actor, 'bad?', 'US', '')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  await f.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=now(),updated_at=now(),revision=revision+1 WHERE staff_id=$1',
    [s.reviewer],
  );
  expect(await s.commercial.setAffiliate(s.actor, s.reviewer, input)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
it('defaults unconnected link checks to unavailable and denies invalid activation configuration', async () => {
  const s = await setup(),
    r = await retailer(),
    k = uid('link');
  value(
    await s.commercial.setAffiliate(s.actor, s.reviewer, {
      key: k,
      retailerId: r,
      destination: 'https://shop.example/tires',
      market: 'US',
    }),
  );
  const runtime = await createCommercialRuntime({
    scopes: s.scopes,
    mail: s.parameters.mail,
    privacy: s.parameters.privacy,
    now: s.parameters.now,
  });
  expect(value(await runtime.commercial.checkAffiliate(s.actor, k))).toEqual({
    status: 'unavailable',
  });
  expect(value(await runtime.commercial.resolveAffiliate(k, 'US'))).toBeNull();
  await expect(
    createCommercialRuntime({ ...s.parameters, externalActivationApproved: 'yes' as never }),
  ).rejects.toThrow('activation');
});
it('keeps approved report metrics and attached observations immutable at their complete financial grain', async () => {
  const s = await setup(),
    a = await account(s),
    r = report(a),
    i = value(await s.commercial.importReport(s.actor, r));
  value(await s.commercial.approveReport(s.actor, s.reviewer, i.id, '0'));
  const metric = (
    await f.admin.query('SELECT id FROM admin.ad_daily_metrics WHERE import_id=$1', [i.id])
  ).rows[0].id;
  for (const sql of [
    'UPDATE admin.ad_daily_metrics SET revenue_minor=99 WHERE id=$1',
    'UPDATE admin.ad_metric_observations SET latency_total_ms=1 WHERE metric_id=$1',
    'DELETE FROM admin.ad_metric_observations WHERE metric_id=$1',
  ])
    await expect(f.admin.query(sql, [metric])).rejects.toThrow();
  expect(await s.commercial.approveReport(s.actor, s.reviewer, i.id, '-1')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it('uses an indexed bounded masked queue at representative cardinality', async () => {
  const s = await setup();
  await f.admin.query(
    "INSERT INTO app.webhook_inbox(provider,provider_event_id,payload_digest,received_at,signature_verified_at) SELECT 'resend','bulk-'||n,decode($1,'hex'),now(),now() FROM generate_series(1,10000) n",
    [key().digest],
  );
  await f.admin.query('ANALYZE app.webhook_inbox');
  const first = value(await s.staff.queue(s.support, 'callbacks', null, 100));
  expect(first.items).toHaveLength(100);
  const query = value(
    await result(s.scopes.staff.unitOfWork, (tx) =>
      s.scopes.staff.query(
        tx,
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,state,due_at FROM admin.staff_callback_queue WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 100',
        [first.next],
      ),
    ),
  );
  const plan = (
    query.rows[0]!['QUERY PLAN'] as { 'Execution Time': number; Plan: Record<string, unknown> }[]
  )[0]!;
  expect(JSON.stringify(plan)).toContain('webhook_inbox_pk');
  expect(plan.Plan['Actual Rows']).toBe(100);
  expect(plan['Execution Time']).toBeLessThan(1000);
  console.log(
    'STAFF_QUEUE_EVIDENCE',
    JSON.stringify({
      syntheticCallbacks: 10000,
      returned: 100,
      executionMs: plan['Execution Time'],
      indexed: true,
    }),
  );
});
it('keeps all/page/slot aggregates separate, preserves source freshness and normalizes replay order', async () => {
  const s = await setup(),
    a = await account(s),
    page = await publicPage();
  await publish(s);
  const slot = (await f.admin.query("SELECT id FROM admin.ad_slots WHERE slot_key='education_one'"))
    .rows[0].id;
  const r = report(a),
    rows = [
      r.rows[0]!,
      { ...r.rows[0]!, dimension: 'page:' + page.page, revenueMinor: '50' },
      { ...r.rows[0]!, dimension: 'slot:' + slot, revenueMinor: '30' },
    ];
  const first = value(await s.commercial.importReport(s.actor, { ...r, rows }));
  value(await s.commercial.approveReport(s.actor, s.reviewer, first.id, '0'));
  expect(
    value(await s.commercial.revenue(s.actor, a, '2026-10-01', 'page:' + page.page)).metric
      ?.revenueMinor,
  ).toBe('50');
  expect(
    value(await s.commercial.revenue(s.actor, a, '2026-10-01', 'slot:' + slot)).metric
      ?.revenueMinor,
  ).toBe('30');
  expect(value(await s.commercial.revenue(s.actor, a, '2026-10-01')).metric).toMatchObject({
    revenueMinor: '123',
    fetchedAt: r.fetchedAt,
  });
  expect(
    value(
      await s.commercial.importReport(s.actor, {
        ...r,
        rows: [...rows].reverse(),
        fetchedAt: time(-500),
      }),
    ).id,
  ).toBe(first.id);
  expect(value(await s.commercial.revenue(s.actor, a, '2026-10-01')).metric?.fetchedAt).toBe(
    r.fetchedAt,
  );
  expect(
    await s.commercial.importReport(s.actor, { ...report(a, '2'), fetchedAt: time(3600000) }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
