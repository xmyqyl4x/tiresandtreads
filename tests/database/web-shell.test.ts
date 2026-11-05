import { beforeAll, afterAll, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { startWebPreview } from '../fixtures/http/web-preview.ts';
let f: Awaited<ReturnType<typeof startWebPreview>>, html: string;
beforeAll(async () => {
  f = await startWebPreview();
  html = await (await f.request('/')).text();
}, 180000);
afterAll(async () => {
  await f?.cleanup();
}, 30000);
it('renders the accessible local shell with shared navigation, language, landmarks and no indexing', async () => {
  expect(html).toContain('<title>Your next set. A clearer choice. | Tires &amp; Tread</title>');
  expect(html).toContain('lang="en-US"');
  expect(html).toContain('Skip to main content');
  expect(html).toContain('id="main"');
  expect(html).toContain('Your next set.');
  expect(html).toContain('Privacy choices');
  expect(html).not.toMatch(/https:\/\/(fonts|www\.googletagmanager|pagead)/);
  const r = await f.request('/design-system');
  expect(r.status).toBe(200);
  const text = await r.text();
  expect(text).toContain('Example value');
  expect(text).toContain('Validate example');
  expect(r.headers.get('x-robots-tag')).toContain('noindex');
});
it('round-trips explicit browser consent through Next, the local HTTP services and PostgreSQL', async () => {
  const policy = (await (await f.request('/api/v1/consent/policy')).json()).data;
  const { necessary, analytics, ads, targeted_ads } = policy.notices;
  const session = await f.request('/api/v1/sessions', {
    method: 'POST',
    headers: { origin: f.webOrigin, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(session.status).toBe(200);
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!,
    who = (await session.json()).data;
  const before = (
    await (
      await f.request('/api/v1/consent/browser?cmpAvailable=true', { headers: { cookie } })
    ).json()
  ).data;
  expect(before).toMatchObject({
    analytics: false,
    ads: false,
    targeted_ads: false,
    identity_sharing: false,
  });
  const save = await f.request('/api/v1/consent/browser', {
    method: 'POST',
    headers: {
      origin: f.webOrigin,
      cookie,
      'content-type': 'application/json',
      'x-csrf-token': who.csrf,
      'idempotency-key': 'web_consent_0000001',
    },
    body: JSON.stringify({
      expectedRevision: before.revision,
      allowed: [],
      gpc: false,
      notices: { necessary, analytics, ads, targeted_ads },
    }),
  });
  expect(save.status, await save.clone().text()).toBe(200);
  const after = (
    await (
      await f.request('/api/v1/consent/browser?cmpAvailable=true', { headers: { cookie } })
    ).json()
  ).data;
  expect(after.revision).not.toBe(before.revision);
  expect(after.analytics).toBe(false);
});
it('keeps route authority local and refuses missing sections, callback forwarding and forged hosts', async () => {
  expect((await f.request('/preview/unknown')).status).toBe(404);
  const raw = (path: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: 3000 });
      let data = '';
      socket.setTimeout(3000, () => socket.destroy(Error('Owned preview socket timeout')));
      socket.on('error', reject);
      socket.on('data', (b) => {
        data += b.toString();
      });
      socket.on('end', () => resolve(data));
      socket.on('connect', () =>
        socket.write(
          'GET ' + path + ' HTTP/1.1\r\nHost: evil.invalid\r\nConnection: close\r\n\r\n',
        ),
      );
    });
  expect(await raw('/')).toMatch(/^HTTP\/1.1 404/);
  expect(await raw('/api/v1/consent/policy')).toMatch(/^HTTP\/1.1 403/);
  expect((await f.request('/api/v1/workflows/wake')).status).toBe(404);
});
it('measures the initial shell JavaScript against the 120KB gzip budget without preloading the consent SDK', async () => {
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)],
    sizes = [];
  let total = 0,
    legacy = 0;
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    const url = tag[1]!;
    expect(url.startsWith('/local-preview-assets/')).toBe(true);
    const r = await f.request(url);
    expect(r.status).toBe(200);
    const size = gzipSync(new Uint8Array(await r.arrayBuffer())).byteLength,
      isLegacy = /\bnomodule\b/i.test(tag[0]);
    if (isLegacy) legacy += size;
    else total += size;
    sizes.push({ url, gzipBytes: size, legacy: isLegacy });
  }
  console.log(
    'LOCAL_WEB_BUNDLE ' +
      JSON.stringify({
        initialScripts: tags.length,
        gzipBytes: total,
        legacyNoModuleBytes: legacy,
        sizes,
        budgetBytes: 120000,
        scope: 'local-shell-modern-supported-browser',
      }),
  );
  expect(total).toBeLessThanOrEqual(120000);
  const manifest = JSON.parse(
    readFileSync('apps/web/node_modules/.cache/tt-preview/assets.json', 'utf8'),
  ) as {
    files: Record<string, { body: string }>;
    groups: Record<'visitor' | 'editorial' | 'checklist' | 'staff' | 'commercial', string[]>;
  };
  const all = Object.values(manifest.groups).flat();
  expect(new Set(all).size).toBe(all.length);
  expect([...all].sort()).toEqual(Object.keys(manifest.files).sort());
  for (const tag of tags) expect(manifest.groups.visitor).toContain(tag[1]!.split('/').at(-1));
  const size = (group: string[]) =>
    group
      .filter((path) => path.endsWith('.js'))
      .reduce((sum, path) => sum + gzipSync(manifest.files[path]!.body).byteLength, 0);
  const withConsent = size(manifest.groups.visitor);
  console.log(
    'LOCAL_WEB_COMPLETE_CLIENT ' +
      JSON.stringify({ gzipBytes: withConsent, budgetBytes: 120000, includesConsent: true }),
  );
  expect(withConsent).toBeLessThanOrEqual(120000);
  expect(size(manifest.groups.commercial)).toBeLessThanOrEqual(12000);
  const checklist = size(manifest.groups.checklist);
  expect(checklist).toBeLessThanOrEqual(120000);
  console.log(
    'LOCAL_WEB_ENTRY_GROUPS ' +
      JSON.stringify({
        visitorWithConsentGzipBytes: withConsent,
        checklistGzipBytes: checklist,
        editorialGzipBytes: size(manifest.groups.editorial),
        commercialGzipBytes: size(manifest.groups.commercial),
        publicBudgetBytes: 120000,
        disjoint: true,
        exhaustive: true,
      }),
  );
}, 30000);
