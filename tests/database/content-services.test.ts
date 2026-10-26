import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { contentFixture, uid, time, success, result } from '../fixtures/content/database.ts';
import { createContentRuntime } from '../../packages/integrations/src/content-runtime.ts';
import { createContentServices } from '../../packages/application/src/services/content.ts';
import { createEditorialRepository } from '../../packages/db/src/repositories/editorial.ts';
import { createContentServiceRepository } from '../../packages/db/src/repositories/content-services.ts';
import { contentIdentity } from '../../packages/integrations/src/content-identity.ts';
import type { Result } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof contentFixture>>;
beforeAll(async () => {
  f = await contentFixture();
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
async function setup() {
  let at: string = time();
  const bytes = new Map<string, Uint8Array>();
  const snapshots = {
    put: vi.fn(async (key: string, b: Uint8Array) => {
      if (bytes.has(key) && Buffer.compare(Buffer.from(bytes.get(key)!), Buffer.from(b)))
        throw Error('Conflict');
      bytes.set(key, b);
    }),
    get: vi.fn(async (key: string) => {
      if (!bytes.has(key)) throw Error('Missing snapshot');
      return bytes.get(key)!;
    }),
  };
  const crawler = {
    observe: vi.fn(async () => ({
      status: 200,
      title: 'Synthetic title',
      description: 'Synthetic reviewed summary',
      canonical: 'https://example.test/learn/wrong',
      robots: 'index,follow',
      links: [] as string[],
    })),
  };
  const search = {
    enabled: true,
    daily: vi.fn(async () => [
      { day: '2026-10-01', clicks: 2n, impressions: 10n, positionSum: '20' },
    ]),
    notify: vi.fn(async () => 'received' as const),
  };
  const runtime = await createContentRuntime({
    appScope: f.appScope,
    publicScope: f.publicScope,
    cmsScope: f.cmsScope,
    snapshots,
    crawler,
    search,
    origin: 'https://example.test',
    production: true,
    now: () => at,
  });
  const editorial = createEditorialRepository(f.cmsScope),
    write = createContentServiceRepository(f.appScope),
    read = createContentServiceRepository(f.publicScope),
    deps = {
      appUow: f.appScope.unitOfWork,
      publicUow: f.publicScope.unitOfWork,
      cmsUow: f.cmsScope.unitOfWork,
      editorial,
      write,
      read,
      identity: contentIdentity,
      snapshots,
      crawler,
      search,
      origin: 'https://example.test',
      production: true,
      now: () => at,
    };
  return {
    ...runtime,
    service: runtime.services,
    bytes,
    snapshots,
    crawler,
    search,
    editorial,
    write,
    read,
    deps,
    setTime: (t: string) => {
      at = t;
    },
  };
}
async function published(collection: 'articles' | 'glossary-terms' = 'articles', path?: string) {
  const s = await setup(),
    doc = await f.document(collection, path),
    job = value(await s.service.enqueue(f.staff, doc.ref));
  value(await s.service.dispatch(job.id));
  return { ...s, doc, job };
}
it('UC10 DB16 commits a reviewed CMS revision and public registry through the separate database bridge', async () => {
  const s = await published(),
    page = value(await s.service.readPage(s.doc.body.path, 'en-US', 'US'));
  expect(page.content).toMatchObject({
    title: 'Synthetic title',
    author: 'Synthetic author',
    reviewer: 'Synthetic reviewer',
  });
  expect(page.metadata.robots).toBe('index,follow');
  expect(value(await s.service.sitemap('en-US', 'US')).items).toContainEqual({
    loc: 'https://example.test' + s.doc.body.path,
    lastmod: s.doc.stamp,
  });
  expect(await s.service.dispatch(s.job.id)).toMatchObject({ ok: true, value: null });
  expect(value(await s.service.enqueue(f.staff, s.doc.ref))).toEqual(s.job);
  expect(JSON.stringify(page)).not.toContain(f.staff);
  expect(JSON.stringify(page)).not.toContain('sourceUrl');
});
it('glossary lookup, learning and public tools operate over reviewed public DTOs', async () => {
  const s = await published('glossary-terms');
  expect(
    value(await s.service.readPage(s.doc.body.path, 'en-US', 'US')).metadata.structuredData[
      '@type'
    ],
  ).toBe('DefinedTerm');
  expect(
    value(await s.service.learn('en-US', 'US', { buying: 10 })).some(
      (p) => p.path === s.doc.body.path,
    ),
  ).toBe(true);
  expect(s.service.decodeSize('235/60R18 103H')).toMatchObject({
    status: 'decoded',
    fitmentVerified: false,
  });
  expect(
    s.service.scorecard(
      Array.from({ length: 14 }, (_, i) => ({ key: i + 1, answer: 'good' as const })),
    ),
  ).toMatchObject({ summary: 'answers_recorded', safetyVerified: false });
});
it('unapproved, expired, missing and malformed source records cannot queue a public revision', async () => {
  const s = await setup(),
    doc = await f.document();
  expect((await s.service.enqueue(f.staff, { ...doc.ref, id: uid('cms_document') })).ok).toBe(
    false,
  );
  await f.cmsAdmin.query(
    `UPDATE public.${doc.table} SET review_status='review',_status='draft' WHERE id=$1`,
    [doc.ref.id],
  );
  expect((await s.service.enqueue(f.staff, doc.ref)).ok).toBe(false);
  await f.cmsAdmin.query(
    `UPDATE public.${doc.table} SET review_status='approved',_status='published',expires_at=$2 WHERE id=$1`,
    [doc.ref.id, time(-500)],
  );
  expect((await s.service.enqueue(f.staff, doc.ref)).ok).toBe(false);
  await f.cmsAdmin.query(
    `UPDATE public.${doc.table} SET expires_at=$2,${doc.field}=$3 WHERE id=$1`,
    [
      doc.ref.id,
      time(3600000),
      JSON.stringify({ ...doc.body, privateEmail: 'do-not-export@example.invalid' }),
    ],
  );
  expect((await s.service.enqueue(f.staff, doc.ref)).ok).toBe(false);
  expect((await s.service.enqueue(uid('staff'), doc.ref)).ok).toBe(false);
});
it('role revocation after enqueue blocks application publication and leaves visible retry work', async () => {
  const s = await setup(),
    doc = await f.document(),
    job = value(await s.service.enqueue(f.staff, doc.ref));
  await f.owner.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=now() WHERE staff_id=$1',
    [f.staff],
  );
  try {
    expect((await s.service.dispatch(job.id)).ok).toBe(false);
    expect((await s.service.readPage(doc.body.path, 'en-US', 'US')).ok).toBe(false);
    expect(
      (await f.cmsAdmin.query('SELECT state FROM public.publication_work WHERE id=$1', [job.id]))
        .rows[0].state,
    ).toBe('failed');
  } finally {
    await f.owner.query(
      'UPDATE admin.staff_role_assignments SET revoked_at=NULL WHERE staff_id=$1',
      [f.staff],
    );
  }
});
it('duplicate and competing worker leases cannot publish two outcomes and expired fences cannot acknowledge', async () => {
  const s = await setup(),
    doc = await f.document(),
    job = value(await s.service.enqueue(f.staff, doc.ref));
  const r = await Promise.all([s.service.dispatch(job.id), s.service.dispatch(job.id)]);
  expect(r.filter((x) => x.ok && x.value?.status === 'published')).toHaveLength(1);
  const other = await f.document(),
    j = value(await s.service.enqueue(f.staff, other.ref)),
    old = await success(f.cmsScope.unitOfWork, (tx) => s.editorial.lease(tx, j.id));
  expect(old).not.toBeNull();
  await f.cmsAdmin.query(
    "UPDATE public.publication_work SET lease_until=now()-interval '1 second',updated_at=now()-interval '2 seconds' WHERE id=$1",
    [j.id],
  );
  const next = await success(f.cmsScope.unitOfWork, (tx) => s.editorial.lease(tx, j.id));
  expect(next!.generation).toBe(old!.generation + 1n);
  expect(
    (await result(f.cmsScope.unitOfWork, (tx) => s.editorial.finish(tx, old!, 'published'))).ok,
  ).toBe(false);
  await success(f.cmsScope.unitOfWork, (tx) => s.editorial.finish(tx, next!, 'cancelled'));
});
it('an application commit followed by lost CMS acknowledgement retries without rewriting public history', async () => {
  const s = await setup(),
    doc = await f.document(),
    job = value(await s.service.enqueue(f.staff, doc.ref));
  const spy = vi
    .spyOn(s.editorial, 'finish')
    .mockRejectedValueOnce(Error('Lost CMS acknowledgement'));
  const service = createContentServices(s.deps);
  expect((await service.dispatch(job.id)).ok).toBe(false);
  spy.mockRestore();
  expect((await s.service.readPage(doc.body.path, 'en-US', 'US')).ok).toBe(true);
  const before = (
    await f.owner.query('SELECT revision FROM admin.seo_page_registry WHERE public_path=$1', [
      doc.body.path,
    ])
  ).rows[0].revision;
  await f.cmsAdmin.query('UPDATE public.publication_work SET next_attempt_at=now() WHERE id=$1', [
    job.id,
  ]);
  value(await service.dispatch(job.id));
  expect(
    (
      await f.owner.query('SELECT revision FROM admin.seo_page_registry WHERE public_path=$1', [
        doc.body.path,
      ])
    ).rows[0].revision,
  ).toBe(before);
});
it('out-of-order source revisions cancel; withdrawal and fresh reviewed rollback retain immutable generations', async () => {
  const s = await setup(),
    doc = await f.document(),
    old = value(await s.service.enqueue(f.staff, doc.ref));
  const second = await f.update(doc, 2),
    next = value(await s.service.enqueue(f.staff, second));
  value(await s.service.dispatch(next.id));
  expect(value(await s.service.dispatch(old.id))).toEqual({ status: 'cancelled' });
  const withdrawn = await f.update(doc, 3, doc.body, false),
    w = value(await s.service.enqueue(f.staff, withdrawn, 'withdraw'));
  value(await s.service.dispatch(w.id));
  expect((await s.service.readPage(doc.body.path, 'en-US', 'US')).ok).toBe(false);
  const rollback = await f.update(doc, 4),
    r = value(await s.service.enqueue(f.staff, rollback));
  value(await s.service.dispatch(r.id));
  expect((await s.service.readPage(doc.body.path, 'en-US', 'US')).ok).toBe(true);
  const count = (
    await f.owner.query(
      'SELECT generation FROM app.public_page_details WHERE document_id=$1 ORDER BY generation',
      [doc.ref.id],
    )
  ).rows.map((x) => String(x.generation));
  expect(count).toEqual(['2', '3', '4']);
});
it('an existing document cannot move its identity or overwrite another public route', async () => {
  const s = await published(),
    other = await f.document('articles', s.doc.body.path),
    job = value(await s.service.enqueue(f.staff, other.ref));
  expect((await s.service.dispatch(job.id)).ok).toBe(false);
  const changed = await f.update(s.doc, 2, { ...s.doc.body, path: '/learn/different' }),
    moved = value(await s.service.enqueue(f.staff, changed));
  expect((await s.service.dispatch(moved.id)).ok).toBe(false);
});
it('SQL/S3 configuration publication is role-gated, retryable and never falls back after expiry or an outage', async () => {
  const s = await setup(),
    rev = 101,
    c = {
      schemaVersion: 1 as const,
      revision: rev,
      issuedAt: time(-1000),
      expiresAt: time(3600000),
      analytics: false,
      advertising: false,
    };
  value(await s.service.configure(f.staff, f.staff, c));
  value(await s.service.configure(f.staff, f.staff, c));
  expect((await s.configuration.read())?.value.revision).toBe(rev);
  expect((await s.service.configure(f.staff, f.staff, { ...c, revision: rev - 1 })).ok).toBe(false);
  expect((await s.service.configure(f.staff, f.staff, { ...c, advertising: true })).ok).toBe(false);
  expect((await s.service.configure(uid('staff'), f.staff, c)).ok).toBe(false);
  s.setTime(time(7200000));
  expect(await s.configuration.read()).toBeNull();
});
it('redirect snapshots propagate between replicas within 30 seconds and stale/unsafe/expired updates fail closed', async () => {
  const s = await setup(),
    value1 = {
      revision: 201,
      issuedAt: time(-1000),
      expiresAt: time(3600000),
      rules: [{ source: '/learn/old', target: '/guides/new', code: 301 as const }],
    };
  value(await s.service.publishRedirects(f.staff, f.staff, value1));
  const replica = await createContentRuntime({
    appScope: f.appScope,
    publicScope: f.publicScope,
    cmsScope: f.cmsScope,
    snapshots: s.snapshots,
    crawler: s.crawler,
    search: s.search,
    origin: 'https://example.test',
    production: true,
    now: s.deps.now,
  });
  expect((await replica.routing.read())?.revision).toBe(201);
  expect(await s.routing.redirect('/learn/old')).toEqual({ code: 301, target: '/guides/new' });
  value(await s.service.publishRedirects(f.staff, f.staff, value1));
  expect(
    (await s.service.publishRedirects(f.staff, f.staff, { ...value1, revision: 200 })).ok,
  ).toBe(false);
  expect(
    (
      await s.service.publishRedirects(f.staff, f.staff, {
        ...value1,
        revision: 202,
        rules: [{ source: '/report/token', target: null, code: 410 }],
      })
    ).ok,
  ).toBe(false);
  value(
    await s.service.publishRedirects(f.staff, f.staff, {
      ...value1,
      revision: 202,
      rules: [{ source: '/learn/old', target: null, code: 410 }],
    }),
  );
  s.setTime(time(31000));
  expect(await replica.routing.redirect('/learn/old')).toEqual({ code: 410, target: null });
  expect(await s.routing.redirect('/learn/old')).toEqual({ code: 410, target: null });
  s.setTime(time(7200000));
  expect(await s.routing.read()).toBeNull();
});
it('a bounded crawl stores sanitized findings and handles unavailable pages without inventing a successful audit', async () => {
  const s = await published();
  s.crawler.observe.mockResolvedValueOnce({
    status: 200,
    title: 'Wrong',
    description: 'Wrong',
    canonical: 'https://example.test/wrong',
    robots: 'noindex',
    links: ['/report/private?token=private'],
  });
  s.crawler.observe.mockRejectedValueOnce(Error('network detail'));
  const r = value(await s.service.audit(f.staff, 'en-US', 'US'));
  expect(r.scanned).toBeLessThanOrEqual(20);
  expect(r.findings).toBeGreaterThan(0);
  const facts = await f.owner.query('SELECT rule_code FROM admin.seo_findings WHERE run_id=$1', [
    r.id,
  ]);
  expect(facts.rows.map((x) => x.rule_code)).toContain('private_link');
  expect(JSON.stringify(facts.rows)).not.toContain('private?token');
  expect((await s.service.audit(uid('staff'), 'en-US', 'US')).ok).toBe(false);
});
it('search metrics preserve missing versus zero, replace corrections and reject stale fetched revisions', async () => {
  const s = await published();
  expect(
    value(await s.service.searchMetrics(f.staff, s.doc.body.path, 'en-US', 'US', '2026-10-01')),
  ).toMatchObject({ status: 'missing', clicks: null });
  value(
    await s.service.syncSearch(f.staff, s.doc.body.path, 'en-US', 'US', '2026-10-01', '2026-10-01'),
  );
  expect(
    value(await s.service.searchMetrics(f.staff, s.doc.body.path, 'en-US', 'US', '2026-10-01')),
  ).toMatchObject({ status: 'available', clicks: 2n });
  s.setTime(time(1000));
  s.search.daily.mockResolvedValueOnce([
    { day: '2026-10-01', clicks: 0n, impressions: 0n, positionSum: '0' },
  ]);
  value(
    await s.service.syncSearch(f.staff, s.doc.body.path, 'en-US', 'US', '2026-10-01', '2026-10-01'),
  );
  expect(
    value(await s.service.searchMetrics(f.staff, s.doc.body.path, 'en-US', 'US', '2026-10-01')),
  ).toMatchObject({ clicks: 0n });
  s.setTime(time(-1000));
  expect(
    (
      await s.service.syncSearch(
        f.staff,
        s.doc.body.path,
        'en-US',
        'US',
        '2026-10-01',
        '2026-10-01',
      )
    ).ok,
  ).toBe(false);
  s.search.daily.mockResolvedValueOnce([]);
  expect(
    value(
      await s.service.syncSearch(
        f.staff,
        s.doc.body.path,
        'en-US',
        'US',
        '2026-10-02',
        '2026-10-02',
      ),
    ),
  ).toMatchObject({ status: 'missing', rows: 0 });
  s.search.enabled = false;
  expect(
    value(
      await s.service.syncSearch(
        f.staff,
        s.doc.body.path,
        'en-US',
        'US',
        '2026-10-01',
        '2026-10-01',
      ),
    ),
  ).toEqual({ status: 'unavailable', rows: null });
  expect(
    (
      await s.service.syncSearch(
        f.staff,
        s.doc.body.path,
        'en-US',
        'US',
        '2026-02-30',
        '2026-03-01',
      )
    ).ok,
  ).toBe(false);
});
it('public and CMS roles cannot read contacts, administer staff or bypass source/route constraints', async () => {
  const s = await setup();
  for (const scope of [f.publicScope, f.cmsScope, f.appScope])
    expect(
      (await result(scope.unitOfWork, (tx) => scope.query(tx, 'SELECT * FROM privacy.contacts')))
        .ok,
    ).toBe(false);
  expect(
    (
      await result(f.cmsScope.unitOfWork, (tx) =>
        f.cmsScope.query(tx, 'INSERT INTO public.cms_staff(app_staff_id) VALUES($1)', [
          uid('staff'),
        ]),
      )
    ).ok,
  ).toBe(false);
  const doc = await f.document();
  expect(
    (
      await result(f.cmsScope.unitOfWork, (tx) =>
        f.cmsScope.query(tx, 'UPDATE public.articles SET id=$2 WHERE id=$1', [
          doc.ref.id,
          uid('cms_document'),
        ]),
      )
    ).ok,
  ).toBe(false);
  await expect(
    createContentRuntime({
      appScope: f.readScope,
      publicScope: f.publicScope,
      cmsScope: f.cmsScope,
      ...s.deps,
      snapshots: s.snapshots,
    } as never),
  ).rejects.toThrow('Invalid content runtime role');
  expect(value(await s.service.reconcile()).length).toBeLessThanOrEqual(20);
});
it('reviewed checklist data is published with all fourteen entries and missing definitions stay unavailable', async () => {
  const s = await setup(),
    doc = await f.document('articles', '/guides/before-you-buy');
  const questions = Array.from({ length: 14 }, (_, i) => ({
    key: i + 1,
    question: 'Synthetic question',
    goodAnswer: 'Synthetic reviewed answer',
    redFlags: ['Synthetic concern'],
    glossaryPath: '/glossary/tread',
  }));
  await f.cmsAdmin.query('UPDATE public.articles SET body=$2 WHERE id=$1', [
    doc.ref.id,
    JSON.stringify({ ...doc.body, questions }),
  ]);
  const job = value(await s.service.enqueue(f.staff, doc.ref));
  value(await s.service.dispatch(job.id));
  expect(value(await s.service.checklist('en-US', 'US')).items).toHaveLength(14);
  expect((await s.service.checklist('zz-ZZ', 'US')).ok).toBe(false);
  expect(
    value(await s.service.learn('en-US', 'US', { buying: 1 })).filter(
      (p) => p.path === '/guides/before-you-buy',
    ),
  ).toHaveLength(1);
});
it('publication emits one opaque durable notification and staff previews cannot index drafts', async () => {
  const s = await published(),
    registered = await success(f.publicScope.unitOfWork, (tx) =>
      s.read.page(tx, s.doc.body.path, 'en-US', 'US'),
    );
  expect(value(await s.service.previewMetadata(f.staff, registered!.page)).robots).toBe(
    'noindex,nofollow',
  );
  expect((await s.service.previewMetadata(uid('staff'), registered!.page)).ok).toBe(false);
  expect(value(await s.service.notify(f.staff, [s.doc.body.path]))).toEqual({ status: 'received' });
  expect((await s.service.notify(f.staff, ['/learn/unregistered'])).ok).toBe(false);
  expect((await s.service.notify(f.staff, [])).ok).toBe(false);
  expect(value(await s.service.notifyPublication(registered!.id))).toEqual({ status: 'received' });
  expect((await s.service.notifyPublication(uid('seo_page'))).ok).toBe(false);
  expect(
    (
      await f.owner.query(
        "SELECT payload FROM app.outbox WHERE aggregate_id=$1 AND event_type='content.index_notification'",
        [registered!.id],
      )
    ).rows,
  ).toEqual([{ payload: { resource_id: registered!.id, resource_kind: 'seo_page', version: 1 } }]);
});
it('snapshot write failure, role rejection and invalid lifetimes leave no SQL configuration head', async () => {
  const s = await setup(),
    c = {
      schemaVersion: 1 as const,
      revision: 501,
      issuedAt: time(-1000),
      expiresAt: time(3600000),
      analytics: false,
      advertising: false,
    };
  s.snapshots.put.mockRejectedValueOnce(Error('Object unavailable'));
  expect((await s.service.configure(f.staff, f.staff, c)).ok).toBe(false);
  expect(
    (await f.owner.query('SELECT version FROM app.public_configurations WHERE version=501')).rows,
  ).toHaveLength(0);
  expect((await s.service.configure(f.staff, f.staff, { ...c, expiresAt: time(-100) })).ok).toBe(
    false,
  );
  expect(
    (
      await s.service.publishRedirects(f.staff, uid('staff'), {
        revision: 501,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        rules: [],
      })
    ).ok,
  ).toBe(false);
  const d = await f.document();
  const j = value(await s.service.enqueue(f.staff, d.ref));
  expect(value(await s.service.reconcile())).toContain(j.id);
  expect((await s.service.enqueue(f.staff, d.ref, 'withdraw')).ok).toBe(false);
});
it('daily search trends use exact aggregate counts and distinguish an absent baseline from decline', async () => {
  const s = await published(),
    path = s.doc.body.path;
  expect(
    value(await s.service.searchTrend(f.staff, path, 'en-US', 'US', '2026-10-01', '2026-10-02')),
  ).toEqual({ status: 'insufficient_data', decline: null });
  s.search.daily.mockResolvedValueOnce([
    { day: '2026-10-01', clicks: 10n, impressions: 20n, positionSum: '20' },
    { day: '2026-10-02', clicks: 7n, impressions: 20n, positionSum: '20' },
  ]);
  value(await s.service.syncSearch(f.staff, path, 'en-US', 'US', '2026-10-01', '2026-10-02'));
  expect(
    value(await s.service.searchTrend(f.staff, path, 'en-US', 'US', '2026-10-01', '2026-10-02')),
  ).toMatchObject({ status: 'available', decline: true });
  expect(
    (await s.service.searchTrend(f.staff, path, 'en-US', 'US', '2026-10-02', '2026-10-01')).ok,
  ).toBe(false);
  s.setTime(time(8 * 86400000));
  expect(
    value(await s.service.searchMetrics(f.staff, path, 'en-US', 'US', '2026-10-01')),
  ).toMatchObject({ status: 'stale' });
  expect((await s.service.searchMetrics(f.staff, path, 'en-US', 'US', 'bad')).ok).toBe(false);
});
