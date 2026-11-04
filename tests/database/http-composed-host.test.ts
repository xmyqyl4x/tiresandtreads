import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { composedApiFixture } from '../fixtures/http/composed-host.ts';
import { createLocalPublicApi } from '../../packages/integrations/src/http/local-runtime.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
let f: Awaited<ReturnType<typeof composedApiFixture>>,
  api: Awaited<ReturnType<typeof createLocalPublicApi>>;
beforeAll(async () => {
  f = await composedApiFixture();
  api = await createLocalPublicApi(f.env);
}, 60000);
afterAll(async () => {
  await api?.shutdown();
  await f?.cleanup();
});
it('uses real paired application/CMS roles and S3/KMS-backed publication through the actual local API host', async () => {
  const doc = await f.f.document(),
    r = await fetch(api.origin + '/api/v1/staff/content', {
      method: 'POST',
      headers: {
        origin: api.origin,
        authorization: 'Bearer ' + f.issued.bearer,
        'x-csrf-token': f.issued.csrf,
        'content-type': 'application/json',
        'idempotency-key': 'paired_content_0001',
      },
      body: JSON.stringify({ ...doc.ref, action: 'publish' }),
    });
  expect(r.status, await r.clone().text()).toBe(200);
  const cycle = await api.services.maintenance.cycle(['publication']);
  expect(cycle.ok).toBe(true);
  const read = await fetch(
    api.origin + '/api/v1/content?path=' + encodeURIComponent(doc.body.path),
  );
  expect(read.status).toBe(200);
  expect(await read.text()).toContain('Synthetic title');
  expect(api.metadata).toMatchObject({ S3Accepted: false, publicActivation: false });
});
it('keeps actual host reports unavailable without accepted source facts while serving independent lookups and default-off analytics', async () => {
  const session = await fetch(api.origin + '/api/v1/sessions', {
    method: 'POST',
    headers: { origin: api.origin, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(session.status).toBe(200);
  const { data } = await session.json(),
    cookie = session.headers.get('set-cookie')!.split(';')[0]!;
  const report = await fetch(api.origin + '/api/v1/reports', {
    method: 'POST',
    headers: {
      origin: api.origin,
      cookie,
      'x-csrf-token': data.csrf,
      'content-type': 'application/json',
      'idempotency-key': 'paired_report_0001',
    },
    body: JSON.stringify(engineFixture().request),
  });
  expect(report.status).toBe(503);
  expect(await report.text()).not.toMatch(/password|postgres:|fixture-secret|stack/);
  expect((await fetch(api.origin + '/api/v1/reference?kind=domainEntityVersions')).status).toBe(
    200,
  );
});
it('serves real published redirect and removal rules ahead of existing or missing pages through the actual local API host', async () => {
  const path = '/learn/local-routing-existing',
    doc = await f.f.document('articles', path),
    content = api.services.content.services;
  expect((await content.enqueue(f.f.staff, doc.ref)).ok).toBe(true);
  expect((await api.services.maintenance.cycle(['publication'])).ok).toBe(true);
  expect(await (await fetch(api.origin + '/api/v1/content?path=' + path)).text()).toContain(
    'Synthetic title',
  );
  const rules = [
    { source: path, target: '/guides/local-routing-new', code: 301 as const },
    { source: '/learn/local-routing-old', target: '/learn/tire-basics', code: 302 as const },
    { source: '/glossary/local-routing-gone', target: null, code: 410 as const },
  ];
  // Existing disposable content fixture identities supply synthetic publication authority only.
  expect(
    (
      await content.publishRedirects(f.f.staff, f.f.staff, {
        revision: 1,
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        rules,
      })
    ).ok,
  ).toBe(true);
  for (const { source, code, target } of rules) {
    const response = await fetch(api.origin + '/api/v1/content?path=' + source);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ redirect: { code, target } });
  }
});
it('drains all five HTTP lanes and composed application/CMS pools before refusing new calls', async () => {
  await api.shutdown();
  await vi.waitFor(
    async () => {
      const active = await f.f.owner.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'tt-service-host:%' OR application_name LIKE 'tt-local-http:%'",
      );
      expect(active.rows[0].n).toBe(0);
    },
    { timeout: 1500, interval: 25 },
  );
  await expect(fetch(api.origin + '/api/v1/reference?kind=domainEntityVersions')).rejects.toThrow();
});
