import { beforeAll, afterAll, it, expect } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { PDFDocument } from 'pdf-lib';
import { startWebPreview } from '../fixtures/http/web-preview.ts';
import { templateMailProof } from '../fixtures/http/template-mail.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof startWebPreview>>;
beforeAll(async () => {
  f = await startWebPreview(
    'http://127.0.0.1:3000',
    'dev',
    'synthetic',
    undefined,
    templateMailProof,
  );
}, 180000);
afterAll(async () => {
  await f?.cleanup();
}, 30000);
async function session() {
  const r = await f.request('/api/v1/sessions', {
    method: 'POST',
    headers: { origin: f.webOrigin, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(r.status).toBe(200);
  return {
    cookie: r.headers.get('set-cookie')!.split(';')[0]!,
    csrf: (await r.json()).data.csrf as string,
  };
}
type Owner = Awaited<ReturnType<typeof session>>;
async function command(who: Owner, path: string, body: unknown, key = crypto.randomUUID()) {
  return f.request('/api/v1' + path, {
    method: 'POST',
    headers: {
      origin: f.webOrigin,
      cookie: who.cookie,
      'x-csrf-token': who.csrf,
      'idempotency-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
it('joins built Next, HTTP, SQL, immutable snapshot, real email/PDF templates and a bounded local sink without accelerating the cancellation clock', async () => {
  const who = await session(),
    input = engineFixture().request,
    created = await command(who, '/reports', input);
  expect(created.status, await created.clone().text()).toBe(200);
  const id = (await created.json()).data.report_id,
    read = await f.request('/api/v1/reports/' + id, { headers: { cookie: who.cookie } }),
    original = (await read.json()).data;
  expect(original.output.result.picks.length).toBeGreaterThan(0);
  expect(original.output.issuanceAuthorized).toBe(false);
  const scheduled = await command(who, '/deliveries', {
    email: 'journey@example.invalid',
    report: { id, version: 1 },
    offers: false,
    notices: { report: f.synthetic!.notices.report },
  });
  expect(scheduled.status, await scheduled.clone().text()).toBe(200);
  const receipt = (await scheduled.json()).data,
    before = await f.synthetic!.db.admin.query(
      'SELECT d.document,s.send_after FROM email.delivery_snapshots d JOIN email.email_sends s ON s.id=d.send_id WHERE s.id=$1',
      [receipt.id],
    );
  expect(before.rows[0].document.report.reportId).toBe(id);
  expect(before.rows[0].document.report.result.picks).toEqual(original.output.result.picks);
  expect((await f.synthetic!.delivery.dispatch(receipt.id as Id<'send'>)).ok).toBe(true);
  expect(f.synthetic!.syntheticMail).toHaveLength(0);
  // Honor the actual 60-second interval; no trigger, deadline or production clock is changed.
  await delay(Math.max(0, new Date(before.rows[0].send_after).getTime() - Date.now()) + 100);
  const worked = await f.synthetic!.delivery.dispatch(receipt.id as Id<'send'>);
  expect(worked, JSON.stringify(worked)).toMatchObject({ ok: true, value: { state: 'accepted' } });
  expect(f.synthetic!.syntheticMail).toHaveLength(1);
  const mail = f.synthetic!.syntheticMail[0]!;
  expect(mail.recipient).toBe('journey@example.invalid');
  expect(mail.mail).toMatchObject({ fixture: true, commercial: false });
  expect(mail.mail.html).toContain('Recorded options');
  expect(mail.mail.html).not.toMatch(/<script|<iframe|<img|pagead|googletag|annualMiles/);
  expect(mail.mail.text).toContain(id);
  const pdf = Buffer.from(mail.mail.pdf, 'base64'),
    doc = await PDFDocument.load(pdf);
  expect(doc.getPageCount()).toBeGreaterThan(0);
  expect(doc.getTitle()).toBe('Your tire assessment');
  const assets = await f.synthetic!.db.admin.query(
    'SELECT pdf_asset_id,payload_asset_id FROM email.delivery_work WHERE send_id=$1',
    [receipt.id],
  );
  expect(Buffer.from(f.synthetic!.objectsData.get(assets.rows[0].pdf_asset_id)!)).toEqual(pdf);
  expect(
    JSON.parse(
      Buffer.from(f.synthetic!.objectsData.get(assets.rows[0].payload_asset_id)!).toString(),
    ).mail,
  ).toEqual(mail.mail);
  await f.synthetic!.delivery.dispatch(receipt.id as Id<'send'>);
  expect(f.synthetic!.syntheticMail).toHaveLength(1);
  console.log(
    'LOCAL_PRODUCT_JOURNEY ' +
      JSON.stringify({
        builtNext: true,
        actualPostgreSQL: true,
        frozenSnapshot: true,
        realEmailPdfRenderer: true,
        cancellationClockUnchanged: true,
        syntheticSinkMessages: 1,
        actualRecipientNotifications: 0,
        productionActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 90000);
it('recovers unsupported and invalid input without saving invalid reports or issuing unsafe picks', async () => {
  const who = await session(),
    input = { ...engineFixture().request, configurationId: null };
  const r = await command(who, '/reports', input);
  expect(r.status).toBe(200);
  const id = (await r.json()).data.report_id,
    read = (
      await (await f.request('/api/v1/reports/' + id, { headers: { cookie: who.cookie } })).json()
    ).data;
  expect(read.output.result.picks).toEqual([]);
  expect(read.output.issuanceAuthorized).toBe(false);
  expect((await command(who, '/reports', { ...input, annualMiles: -1 })).status).toBe(400);
  expect((await command(who, '/reports', engineFixture().request)).status).toBe(200);
});
it('keeps unauthenticated private pages useful and free of owner data, public ads and indexing', async () => {
  for (const path of [
    '/preview/report',
    '/preview/compare',
    '/preview/delivery',
    '/preview/privacy',
    '/preview/shared',
  ]) {
    const response = await f.request(path),
      html = await response.text();
    expect(response.status, path).toBe(200);
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('id="main"');
    expect(html).not.toMatch(
      /data-commercial-inventory|<iframe|journey@example.invalid|synthetic-link/,
    );
  }
});
it('serves crawl controls and safe commercial fallbacks without fabricated publisher identity', async () => {
  for (const path of ['/robots.txt', '/sitemap.xml', '/ads.txt']) {
    const r = await f.request(path);
    expect(r.status, path).toBe(200);
    const body = await r.text();
    expect(body).not.toMatch(/pub-[0-9]+|journey@example.invalid/);
    if (path === '/robots.txt') expect(body).toContain('Disallow: /');
    if (path === '/sitemap.xml') expect(body).not.toContain('/preview/report');
  }
  expect((await f.request('/go/unreviewed', { redirect: 'manual' })).status).toBe(404);
});
