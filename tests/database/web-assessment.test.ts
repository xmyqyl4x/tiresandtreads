import { beforeAll, afterAll, it, expect } from 'vitest';
import { startWebPreview } from '../fixtures/http/web-preview.ts';
import { engineFixture, uuid } from '../fixtures/engine/base.ts';
let f: Awaited<ReturnType<typeof startWebPreview>>;
beforeAll(async () => {
  f = await startWebPreview('http://127.0.0.1:3000', 'dev', 'synthetic');
}, 180000);
afterAll(async () => {
  await f?.cleanup();
}, 30000);
it('stores a technical result with stale safety evidence without issuing a supported pick', async () => {
  const owner = await who(),
    r = await create(
      { ...engineFixture().request, regionKey: 'SYNTHETIC_STALE' },
      'web_assessment_stale_0001',
      owner,
    );
  expect(r.status).toBe(200);
  const id = (await r.json()).data.report_id,
    read = (
      await (await f.request('/api/v1/reports/' + id, { headers: { cookie: owner.cookie } })).json()
    ).data;
  expect(read.output.result.picks).toEqual([]);
  expect(read.output.result.decisions[0].reasons).toContain('RECALL_STALE');
  expect(read.output.issuanceAuthorized).toBe(false);
});
async function who() {
  const r = await f.request('/api/v1/sessions', {
    method: 'POST',
    headers: { origin: f.webOrigin, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(r.status).toBe(200);
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: (await r.json()).data.csrf };
}
async function create(body: unknown, key: string, owner: Awaited<ReturnType<typeof who>>) {
  return f.request('/api/v1/reports', {
    method: 'POST',
    headers: {
      origin: f.webOrigin,
      'content-type': 'application/json',
      cookie: owner.cookie,
      'x-csrf-token': owner.csrf,
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
}
it('renders an accessible form without an email/ad gate and without selecting an ambiguous wheel package', async () => {
  const r = await f.request('/preview/find-tires');
  expect(r.status).toBe(200);
  const html = await r.text();
  for (const label of [
    'Tire assessment',
    'Front tire size',
    'Rear tire size',
    'Annual mileage',
    'Maximum budget',
    'Create assessment',
    'Choose wheel package',
  ])
    expect(html).toContain(label);
  expect(html).not.toContain('type="email"');
  expect(html).not.toMatch(/<option[^>]+selected[^>]*>Synthetic/);
});
it('reads published vehicle, both wheel packages and their separate axle sizes with one pinned bundle', async () => {
  const first = (await (await f.request('/api/v1/reference?kind=vehicles&modelYear=2026')).json())
    .data;
  expect(first.items).toHaveLength(1);
  const bundle = first.source.bundleId;
  const configs = (
    await (
      await f.request(
        '/api/v1/reference?kind=fitmentConfigurations&vehicleId=' + uuid(39) + '&bundle=' + bundle,
      )
    ).json()
  ).data;
  expect(configs.items).toHaveLength(2);
  const axles = (
    await (
      await f.request(
        '/api/v1/reference?kind=fitmentAxles&configurationId=' + uuid(40) + '&bundle=' + bundle,
      )
    ).json()
  ).data;
  expect(axles.items.map((r: { fact: { sizeCode: string } }) => r.fact.sizeCode).sort()).toEqual([
    '225/45R18',
    '255/40R18',
  ]);
  expect(axles.source.bundleId).toBe(bundle);
});
it('persists mileage and exact budget through Next/API/SQL, and replays the same command once', async () => {
  const owner = await who(),
    input = {
      ...engineFixture().request,
      annualMiles: 12000,
      budget: { basis: 'installed', ceilingMinor: '80009', currency: 'USD' },
    };
  const a = await create(input, 'web_assessment_command_0001', owner);
  expect(a.status, await a.clone().text()).toBe(200);
  const saved = (await a.json()).data,
    b = (await (await create(input, 'web_assessment_command_0001', owner)).json()).data;
  expect(b.report_id).toBe(saved.report_id);
  const read = (
    await (
      await f.request('/api/v1/reports/' + saved.report_id, { headers: { cookie: owner.cookie } })
    ).json()
  ).data;
  expect(read.input.annualMiles).toBe(12000);
  expect(read.input.budget.ceilingMinor).toBe('80009');
  expect(read.output.result.picks).toEqual([uuid(101)]);
  expect(read.output.issuanceAuthorized).toBe(false);
  const rows = await f.synthetic!.db.admin.query(
    'SELECT count(*)::int AS n FROM app.report_versions WHERE report_id=$1',
    [saved.report_id],
  );
  expect(rows.rows[0].n).toBe(1);
  expect(f.synthetic!.providerCalls()).toBe(0);
});
it('keeps manual/unsupported information unverified and refuses invalid mileage server-side', async () => {
  const owner = await who(),
    input = {
      ...engineFixture().request,
      configurationId: null,
      sizes: { front: '225/45R18', rear: '255/40R18' },
      annualMiles: null,
    };
  const r = await create(input, 'web_assessment_command_0002', owner);
  expect(r.status).toBe(200);
  const id = (await r.json()).data.report_id;
  const read = (
    await (await f.request('/api/v1/reports/' + id, { headers: { cookie: owner.cookie } })).json()
  ).data;
  expect(read.output.result.picks).toEqual([]);
  expect(
    (await create({ ...input, annualMiles: -1 }, 'web_assessment_command_0003', owner)).status,
  ).toBe(400);
});
