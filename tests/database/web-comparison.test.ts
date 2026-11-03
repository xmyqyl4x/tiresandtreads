import { beforeAll, afterAll, it, expect } from 'vitest';
import { assessmentApiFixture } from '../fixtures/http/assessment-api.ts';
import { engineFixture, uuid } from '../fixtures/engine/base.ts';
import { success, time } from '../fixtures/private/database.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof assessmentApiFixture>>;
beforeAll(async () => {
  f = await assessmentApiFixture();
}, 45000);
afterAll(async () => {
  try {
    if (f) expect(f.providerCalls()).toBe(0);
  } finally {
    await f?.cleanup();
  }
});
const command = () => crypto.randomUUID();
async function seed(regionKey = 'SYNTHETIC_FIVE') {
  const owner = await f.session(),
    created = await f.call('/reports', owner, { ...engineFixture().request, regionKey }, command());
  expect(created.status, await created.clone().text()).toBe(200);
  return { owner, id: (await created.json()).data.report_id as Id<'report'> };
}
const quoteInput = {
  id: null,
  expectedRevision: null,
  skuId: null,
  productText: 'PRIVATE_FIXTURE_PRODUCT',
  shopName: 'PRIVATE_FIXTURE_SHOP',
  currency: 'USD',
  totalMinor: '80009',
  quantity: 4,
  basis: 'installed_set',
  sizeCode: null,
  observedOn: new Date().toISOString().slice(0, 10),
  taxContextConfirmed: false,
  taxIncluded: null,
  components: [],
};
async function addQuote(owner: Awaited<ReturnType<typeof f.session>>, id: string) {
  const r = await f.call('/reports/' + id + '/quotes', owner, quoteInput, command());
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()).data.resource_id as string;
}
async function shared(token: string) {
  return fetch(f.server.origin + '/api/v1/shared', {
    headers: { authorization: 'Bearer ' + token },
  });
}
async function download(token: string) {
  return fetch(f.server.origin + '/api/v1/download', {
    headers: { authorization: 'Bearer ' + token },
  });
}
it('restores owner quotes with bounded scoped pagination and directly reads a quote beyond the first hundred', async () => {
  const { owner, id } = await seed(),
    who = await f.ownerIdentity(owner);
  await success(f.db.scope.unitOfWork, async (tx) => {
    for (let i = 0; i < 101; i++) {
      const qid = uuid(1000 + i) as Id<'quote'>;
      await f.db.reports.saveQuote(tx, who, null, {
        id: qid,
        reportId: id,
        sourceKey: qid,
        skuId: null,
        currency: 'USD',
        totalMinor: 80009n,
        quantity: 4,
        basis: 'installed_set',
        observedOn: new Date().toISOString().slice(0, 10),
        components: [],
        expiresAt: time(86400000),
      });
    }
  });
  const page1 = (await (await f.call('/reports/' + id + '/quotes', owner)).json()).data;
  expect(page1.items).toHaveLength(50);
  expect(page1.next).toBeTypeOf('string');
  const page2 = (
    await (
      await f.call('/reports/' + id + '/quotes?after=' + encodeURIComponent(page1.next), owner)
    ).json()
  ).data;
  expect(page2.items).toHaveLength(50);
  const page3 = (
    await (
      await f.call('/reports/' + id + '/quotes?after=' + encodeURIComponent(page2.next), owner)
    ).json()
  ).data;
  expect(page3.items).toHaveLength(1);
  expect(page3.next).toBeNull();
  expect(new Set([...page1.items, ...page2.items, ...page3.items].map((q) => q.id)).size).toBe(101);
  const last = await f.call('/reports/' + id + '/quotes/' + uuid(1100), owner);
  expect(last.status).toBe(200);
  expect((await last.json()).data).toMatchObject({
    quote: { id: uuid(1100), totalMinor: '80009' },
    private: null,
  });
  expect((await f.call('/reports/' + id + '/quotes', await f.session())).status).not.toBe(200);
  expect((await f.call('/reports/' + id + '/quotes')).status).toBe(401);
  for (const suffix of ['?after=bad', '?after=a&after=b', '?limit=10000'])
    expect((await f.call('/reports/' + id + '/quotes' + suffix, owner)).status).toBe(400);
  const other = await seed();
  expect(
    (
      await f.call(
        '/reports/' + other.id + '/quotes?after=' + encodeURIComponent(page1.next),
        other.owner,
      )
    ).status,
  ).toBe(400);
});
it('stores four selected items once, refuses a fifth without replacement and preserves quote uncertainty/basis warnings', async () => {
  const { owner, id } = await seed(),
    quote = await addQuote(owner, id),
    items = [
      { kind: 'catalog', key: uuid(101) },
      { kind: 'catalog', key: uuid(102) },
      { kind: 'catalog', key: uuid(103) },
      { kind: 'quote', key: quote },
    ],
    body = { version: 1, expectedRevision: null, items },
    key = command();
  const r = await f.call('/reports/' + id + '/compare', owner, body, key);
  expect(r.status, await r.clone().text()).toBe(200);
  const a = (await r.json()).data,
    b = (await (await f.call('/reports/' + id + '/compare', owner, body, key)).json()).data;
  expect(b.result_revision).toBe(a.result_revision);
  const view = (
    await (
      await f.call('/reports/' + id + '/comparisons/' + a.result_revision + '?version=1', owner)
    ).json()
  ).data;
  expect(view.comparison.items).toHaveLength(4);
  expect(view.comparison.items[3]).toMatchObject({
    kind: 'quote',
    snapshot: {
      productKnown: false,
      fit: 'unverified',
      price: { installed: null },
      verdict: { relation: 'not_comparable', evidenceMissing: true, delta: null },
    },
  });
  expect(
    (
      await f.call(
        '/reports/' + id + '/compare',
        owner,
        {
          ...body,
          expectedRevision: a.result_revision,
          items: [...items, { kind: 'catalog', key: uuid(105) }],
        },
        command(),
      )
    ).status,
  ).toBe(400);
  expect((await f.call('/reports/' + id + '/compare', owner, body, command())).status).toBe(409);
  const count = await f.db.admin.query(
    'SELECT count(*)::int AS n FROM app.comparisons WHERE report_id=$1',
    [id],
  );
  expect(count.rows[0].n).toBe(1);
  expect((await (await f.call('/reports/' + id, owner)).json()).data.comparisonRevision).toBe(
    a.result_revision,
  );
  const newer = await f.call(
    '/reports/' + id + '/compare',
    owner,
    { ...body, expectedRevision: a.result_revision, items: items.slice(0, 2) },
    command(),
  );
  expect(newer.status).toBe(200);
  const latest = (await newer.json()).data;
  expect((await (await f.call('/reports/' + id, owner)).json()).data.comparisonRevision).toBe(
    latest.result_revision,
  );
  expect(
    (
      await (
        await f.call('/reports/' + id + '/comparisons/' + a.result_revision + '?version=1', owner)
      ).json()
    ).data.comparison.items,
  ).toHaveLength(4);
});
it('exposes a redacted comparison through a share and refuses revoked and expired capabilities', async () => {
  const { owner, id } = await seed(),
    quote = await addQuote(owner, id),
    c = (
      await (
        await f.call(
          '/reports/' + id + '/compare',
          owner,
          {
            version: 1,
            expectedRevision: null,
            items: [
              { kind: 'catalog', key: uuid(101) },
              { kind: 'quote', key: quote },
            ],
          },
          command(),
        )
      ).json()
    ).data;
  const cap = (
    await (
      await f.call(
        '/reports/' + id + '/shares',
        owner,
        { version: 1, comparisonRevision: c.result_revision },
        command(),
      )
    ).json()
  ).data;
  const read = await shared(cap.token);
  expect(read.status).toBe(200);
  const text = await read.text();
  expect(text).not.toMatch(
    /PRIVATE_FIXTURE|productText|shopName|annualMiles|regionKey|configurationId/,
  );
  expect(JSON.parse(text).data).toMatchObject({
    access: 'read_only',
    comparison: { revision: c.result_revision },
  });
  expect(
    (await f.call('/reports/' + id + '/shares/' + cap.resource_id, owner, {}, command(), 'DELETE'))
      .status,
  ).toBe(200);
  expect((await shared(cap.token)).status).not.toBe(200);
  const expired = await f.expiredShare(owner, id);
  expect((await shared(expired)).status).not.toBe(200);
});
it('discovers and downloads existing private PDFs through real owner/shared grants and refuses cross-scope and revoked access', async () => {
  const { owner, id } = await seed('SYNTHETIC_PDF'),
    own = (await (await f.call('/reports/' + id, owner)).json()).data;
  expect(own.pdfs).toHaveLength(1);
  const cap = (
      await (
        await f.call(
          '/reports/' + id + '/shares',
          owner,
          { version: 1, comparisonRevision: null },
          command(),
        )
      ).json()
    ).data,
    view = (await (await shared(cap.token)).json()).data;
  expect(view.pdfs).toHaveLength(1);
  expect(view.pdfs[0].assetId).not.toBe(own.pdfs[0].assetId);
  const ownerGrant = (
    await (
      await f.call(
        '/reports/' + id + '/pdf',
        owner,
        { version: 1, assetId: own.pdfs[0].assetId },
        command(),
      )
    ).json()
  ).data;
  const bytes = await download(ownerGrant.token);
  expect(bytes.status).toBe(200);
  expect(bytes.headers.get('content-type')).toContain('application/pdf');
  expect((await bytes.text()).startsWith('%PDF-')).toBe(true);
  const grant = await fetch(f.server.origin + '/api/v1/shared/pdf', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + cap.token,
      'content-type': 'application/json',
      origin: f.server.origin,
      'idempotency-key': command(),
    },
    body: JSON.stringify({ assetId: view.pdfs[0].assetId }),
  });
  expect(grant.status, await grant.clone().text()).toBe(200);
  const sharedGrant = (await grant.json()).data;
  expect((await download(sharedGrant.token)).status).toBe(200);
  const wrong = await fetch(f.server.origin + '/api/v1/shared/pdf', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + cap.token,
      'content-type': 'application/json',
      origin: f.server.origin,
      'idempotency-key': command(),
    },
    body: JSON.stringify({ assetId: own.pdfs[0].assetId }),
  });
  expect(wrong.status).not.toBe(200);
  expect(
    (
      await f.call(
        '/reports/' + id + '/pdf',
        await f.session(),
        { version: 1, assetId: own.pdfs[0].assetId },
        command(),
      )
    ).status,
  ).not.toBe(200);
  await f.call('/reports/' + id + '/shares/' + cap.resource_id, owner, {}, command(), 'DELETE');
  expect((await download(sharedGrant.token)).status).not.toBe(200);
  expect((await download(ownerGrant.token)).status).toBe(200);
});
it('does not advertise a report-only PDF for a comparison-bound share or a quarantined asset', async () => {
  const { owner, id } = await seed('SYNTHETIC_PDF'),
    own = (await (await f.call('/reports/' + id, owner)).json()).data;
  const c = (
      await (
        await f.call(
          '/reports/' + id + '/compare',
          owner,
          { version: 1, expectedRevision: null, items: [{ kind: 'catalog', key: uuid(101) }] },
          command(),
        )
      ).json()
    ).data,
    cap = (
      await (
        await f.call(
          '/reports/' + id + '/shares',
          owner,
          { version: 1, comparisonRevision: c.result_revision },
          command(),
        )
      ).json()
    ).data;
  expect((await (await shared(cap.token)).json()).data.pdfs).toEqual([]);
  await f.db.admin.query("UPDATE app.object_assets SET state='quarantined' WHERE id=$1", [
    own.pdfs[0].assetId,
  ]);
  expect((await (await f.call('/reports/' + id, owner)).json()).data.pdfs).toEqual([]);
  expect(
    (
      await f.call(
        '/reports/' + id + '/pdf',
        owner,
        { version: 1, assetId: own.pdfs[0].assetId },
        command(),
      )
    ).status,
  ).not.toBe(200);
});
