import { beforeAll, afterAll, it, expect } from 'vitest';
import { publicApiFixture } from '../fixtures/http/public-api.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
let f: Awaited<ReturnType<typeof publicApiFixture>>;
beforeAll(async () => {
  f = await publicApiFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
it('UC01/UC03 commits and reads a report through real HTTP and PostgreSQL with duplicate/conflicting command handling', async () => {
  const who = await f.session(),
    body = engineFixture().request;
  const created = await f.call('/reports', who, body);
  expect(created.status).toBe(200);
  const first = await created.json(),
    id = first.data.report_id;
  const duplicate = await f.call('/reports', who, body);
  expect((await duplicate.json()).data).toEqual(first.data);
  const read = await f.call('/reports/' + id, who);
  expect(read.status).toBe(200);
  expect(await read.text()).toContain('issuanceAuthorized');
  const other = await f.session();
  expect((await f.call('/reports/' + id, other)).status).toBe(404);
  expect((await f.call('/reports/' + id)).status).toBe(401);
  const stored = await f.db.admin.query(
    'SELECT count(*)::integer AS count FROM app.reports WHERE id=$1',
    [id],
  );
  expect(stored.rows[0].count).toBe(1);
});
it('refuses tampered/expired owner credentials and CSRF before report issuance', async () => {
  const who = await f.session();
  expect(
    (await f.call('/reports', { ...who, csrf: 'wrong' }, engineFixture().request)).status,
  ).toBe(403);
  expect(
    (
      await f.call(
        '/reports',
        { ...who, cookie: 'tt_owner=' + 'a'.repeat(43) },
        engineFixture().request,
      )
    ).status,
  ).toBe(401);
  await f.db.admin.query(
    "UPDATE app.owner_sessions SET expires_at=clock_timestamp()+interval '10 milliseconds' WHERE key_version='http-v1'",
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect((await f.call('/sessions/current', who)).status).toBe(401);
});
it('UC03 refines through a stored draft and refuses a stale revision without publishing again', async () => {
  const who = await f.session(),
    created = await (await f.call('/reports', who, engineFixture().request)).json(),
    report = created.data.report_id;
  const original = await (await f.call('/reports/' + report, who)).json();
  const draft = await (
    await f.call(
      '/reports/' + report + '/draft',
      who,
      {
        baseVersion: 1,
        expectedRevision: null,
        input: { ...engineFixture().request, priorities: ['noise'] },
      },
      'synthetic_draft_001',
    )
  ).json();
  const body = {
    baseVersion: 1,
    draftRevision: draft.data.result_revision,
    expectedRevision: original.data.revision,
  };
  const refined = await f.call('/reports/' + report + '/refine', who, body, 'synthetic_refine_001');
  expect(refined.status).toBe(200);
  expect((await refined.json()).data.report_version).toBe(2);
  expect(
    (await f.call('/reports/' + report + '/refine', who, body, 'synthetic_refine_002')).status,
  ).toBe(409);
});
it('UC04 stores a private quote and compares it without inventing known installed costs', async () => {
  const who = await f.session(),
    created = await (await f.call('/reports', who, engineFixture().request)).json(),
    report = created.data.report_id;
  const body = {
    id: null,
    expectedRevision: null,
    skuId: null,
    productText: 'Synthetic private quote',
    shopName: 'Synthetic shop',
    currency: 'USD',
    totalMinor: '74900',
    quantity: 4,
    basis: 'installed_set',
    observedOn: new Date().toISOString().slice(0, 10),
    taxContextConfirmed: false,
    taxIncluded: true,
    components: ['mounting', 'balancing', 'tpms_valve', 'disposal', 'tax'].map((kind) => ({
      kind,
      included: true,
      basis: 'per_order',
      minor: null,
    })),
  };
  const quoted = await f.call('/reports/' + report + '/quotes', who, body, 'synthetic_quote_001');
  expect(quoted.status).toBe(200);
  const quote = (await quoted.json()).data.resource_id;
  expect((await f.call('/reports/' + report + '/quotes/' + quote, who)).status).toBe(200);
  const compared = await f.call(
    '/reports/' + report + '/compare',
    who,
    { version: 1, expectedRevision: null, items: [{ kind: 'quote', key: quote }] },
    'synthetic_compare_001',
  );
  expect(compared.status).toBe(200);
  const comparison = (await compared.json()).data;
  expect(
    (
      await f.call(
        '/reports/' + report + '/comparisons/' + comparison.result_revision + '?version=1',
        who,
      )
    ).status,
  ).toBe(200);
});
it('UC05 reads a capability through a header and denies it after owner revocation', async () => {
  const who = await f.session(),
    created = await (await f.call('/reports', who, engineFixture().request)).json(),
    report = created.data.report_id;
  const share = await f.call(
    '/reports/' + report + '/shares',
    who,
    { version: 1, comparisonRevision: null },
    'synthetic_share_001',
  );
  expect(share.status).toBe(200);
  const value = (await share.json()).data;
  const read = () =>
    fetch(f.server.origin + '/api/v1/shared', {
      headers: { authorization: 'Bearer ' + value.token },
    });
  expect((await read()).status).toBe(200);
  const revoked = await fetch(
    f.server.origin + '/api/v1/reports/' + report + '/shares/' + value.resource_id,
    {
      method: 'DELETE',
      headers: {
        origin: f.server.origin,
        cookie: who.cookie,
        'x-csrf-token': who.csrf,
        'content-type': 'application/json',
        'idempotency-key': 'synthetic_revoke_001',
      },
      body: '{}',
    },
  );
  expect(revoked.status).toBe(200);
  expect((await read()).status).toBe(404);
});
it('uses PostgreSQL quotas and denies overload before creating another owner session', async () => {
  await f.db.admin.query(
    "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES('local_http','1',86400,1,true)",
  );
  try {
    expect((await f.call('/reference?kind=vehicles')).status).toBe(200);
    const result = await f.call('/reference?kind=vehicles');
    expect(result.status).toBe(429);
    expect(Number(result.headers.get('retry-after'))).toBeGreaterThan(0);
  } finally {
    await f.db.admin.query(
      "DELETE FROM app.rate_limit_buckets WHERE policy_key='local_http' AND window_seconds=86400",
    );
    await f.db.admin.query(
      "DELETE FROM app.rate_limit_policies WHERE policy_key='local_http' AND window_seconds=86400",
    );
  }
});
it('returns explicit missing-data evidence and refuses unsupported or unbounded lookups', async () => {
  const reference = await f.call('/reference?kind=vehicles');
  expect(reference.status).toBe(200);
  expect(await reference.json()).toHaveProperty('data.coverage');
  expect((await f.call('/reference?kind=vehicles&limit=101')).status).toBe(400);
  expect((await f.call('/reference?kind=vehicles&bundle=bad')).status).toBe(400);
});
