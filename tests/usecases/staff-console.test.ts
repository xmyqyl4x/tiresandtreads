import { it, expect, vi } from 'vitest';
import { createStaffConsoleQueries } from '../../packages/application/src/queries/staff-console.ts';
import { ServiceFault } from '../../packages/application/src/services/service-work.ts';
import { id, instant, known, unknown, type Result } from '../../packages/domain/src/values/core.ts';
import type { StaffConsoleReads } from '../../packages/application/src/ports/staff-console.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
const value = <T>(r: Result<T>) => {
  if (!r.ok) throw Error('Invalid fixture');
  return r.value;
};
const uuid = '10000000-0000-4000-8000-000000000001',
  actor = value(id('staff', uuid)),
  at = value(instant('2026-11-04T18:00:00.000Z'));
function setup() {
  const authorize = vi.fn(async () => {});
  const reads = {
    findings: vi.fn<StaffConsoleReads['findings']>(async () => ({
      items: [
        {
          id: uuid,
          pageId: uuid,
          rule: 'unavailable',
          severity: 'error',
          state: 'open',
          detectedAt: at,
        },
      ],
      next: null,
    })),
    reports: vi.fn(async () => ({
      items: [
        {
          id: value(id('report', uuid)),
          state: 'draft' as const,
          updatedAt: at,
          ownerId: 'PRIVATE_OWNER',
          email: 'PRIVATE_CONTACT',
        },
      ],
      next: null,
    })),
    sources: vi.fn<StaffConsoleReads['sources']>(async () => ({
      items: [
        {
          key: 'source-a',
          kind: 'nhtsa-tire-recalls',
          enabled: true,
          hasError: false,
          lastRunState: 'completed',
          lastAttemptAt: at,
          lastSucceededAt: at,
          nextDueAt: value(instant('2026-11-04T19:00:00.000Z')),
          rawConfiguration: 'PRIVATE_CONFIG',
        },
      ],
      next: null,
    })),
    bundle: vi.fn<StaffConsoleReads['bundle']>(async () => null),
    strategy: vi.fn(async () => ({
      items: [
        {
          id: value(id('seo_page', uuid)),
          path: '/learn/tire-basics',
          canonical: '/learn/tire-basics',
          status: 'noindex',
          reviewDue: at,
          ownerId: 'PRIVATE_OWNER',
        },
      ],
      next: null,
    })),
    configuration: vi.fn<StaffConsoleReads['configuration']>(async () => null),
  } satisfies StaffConsoleReads;
  const queries = createStaffConsoleQueries({
    authority: { require: authorize },
    reads,
    now: () => at,
  });
  return { authorize, reads, queries };
}
it('uses independent permissions and strips private fields from every operator read', async () => {
  const f = setup();
  expect(await f.queries.reports(actor)).toEqual({
    ok: true,
    value: { items: [{ id: uuid, state: 'draft', updatedAt: at }], next: null },
  });
  expect(f.authorize).toHaveBeenCalledWith(actor, 'privacy.review');
  expect(await f.queries.strategy(actor)).toMatchObject({
    ok: true,
    value: { items: [{ path: '/learn/tire-basics' }] },
  });
  expect(f.authorize).toHaveBeenCalledWith(actor, 'seo.publish');
  const source = await f.queries.sources(actor);
  expect(source).toMatchObject({
    ok: true,
    value: {
      actualCoverage: 'unconfirmed',
      asOf: at,
      bundle: null,
      sources: [{ state: 'scheduled' }],
    },
  });
  expect(f.authorize).toHaveBeenCalledWith(actor, 'data.review');
  expect(
    JSON.stringify([await f.queries.reports(actor), await f.queries.strategy(actor), source]),
  ).not.toContain('PRIVATE_');
  expect(await f.queries.configuration(actor)).toEqual({
    ok: true,
    value: { version: 0, policy: null, networkReady: false },
  });
  expect(f.authorize).toHaveBeenCalledWith(actor, 'commercial.manage');
});
it.each(['reports', 'sources', 'strategy', 'configuration'] as const)(
  'refuses %s without authority and discards a result after revocation',
  async (name) => {
    const f = setup();
    f.authorize.mockRejectedValueOnce(new ServiceFault('forbidden'));
    expect(await f.queries[name](actor)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    f.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ServiceFault('forbidden'));
    expect(await f.queries[name](actor)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  },
);
it('captures bounded pagination before authorization and rejects malformed cursors and sizes', async () => {
  const f = setup(),
    page = { limit: 25, after: null as string | null };
  const pending = f.queries.reports(actor, page);
  page.limit = 100;
  page.after = 'changed';
  await pending;
  expect(f.reads.reports).toHaveBeenCalledWith({ limit: 25, after: null });
  for (const limit of [0, 101, NaN, 1.5])
    expect(await f.queries.reports(actor, { limit, after: null })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  expect(await f.queries.strategy(actor, { limit: 25, after: 'x'.repeat(513) })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it.each([
  { enabled: false, hasError: true, lastSucceededAt: null, nextDueAt: null, state: 'disabled' },
  { enabled: true, hasError: true, lastSucceededAt: at, nextDueAt: at, state: 'attention' },
  {
    enabled: true,
    hasError: false,
    lastRunState: 'quarantined',
    lastSucceededAt: at,
    nextDueAt: at,
    state: 'attention',
  },
  { enabled: true, hasError: false, lastSucceededAt: null, nextDueAt: at, state: 'not_ready' },
  { enabled: true, hasError: false, lastSucceededAt: at, nextDueAt: null, state: 'not_ready' },
  { enabled: true, hasError: false, lastSucceededAt: at, nextDueAt: at, state: 'due' },
])('distinguishes refresh state from actual coverage: $state', async (input) => {
  const f = setup(),
    row = (await f.reads.sources(value(pageRequest(25, null)))).items[0]!;
  f.reads.sources.mockResolvedValue({ items: [{ ...row, ...input }], next: null });
  expect(await f.queries.sources(actor)).toMatchObject({
    ok: true,
    value: { actualCoverage: 'unconfirmed', sources: [{ state: input.state }] },
  });
});
it('keeps bundle completeness separate from source freshness and actual licensed coverage', async () => {
  const f = setup(),
    source = {
      datasetId: value(id('dataset', uuid)),
      providerId: value(id('provider', uuid)),
      licenseId: value(id('license', uuid)),
      kind: 'fitment',
      fetchedAt: at,
      expiresAt: known(at),
      rights: { display: true, api: false, cache: true, derived: false, snapshot: true },
    };
  f.reads.bundle.mockResolvedValue({
    bundleId: value(id('bundle', uuid)),
    market: 'US',
    coverage: 'partial',
    components: [
      { key: 'fitment', source },
      { key: 'recalls', source: { ...source, expiresAt: unknown('not_supplied') } },
      {
        key: 'prices',
        source: { ...source, expiresAt: known(value(instant('2026-11-04T19:00:00.000Z'))) },
      },
    ],
  });
  const r = await f.queries.sources(actor);
  expect(r).toMatchObject({
    ok: true,
    value: {
      actualCoverage: 'unconfirmed',
      bundle: {
        completeness: 'partial',
        components: [{ freshness: 'stale' }, { freshness: 'unknown' }, { freshness: 'fresh' }],
      },
    },
  });
});
it('discards unbounded adapter results and sanitizes unknown infrastructure failures', async () => {
  const f = setup(),
    r = await f.reads.reports();
  f.reads.reports.mockResolvedValue({ ...r, items: [...r.items, ...r.items] });
  expect(await f.queries.reports(actor, { limit: 1, after: null })).toMatchObject({
    ok: false,
    error: { code: 'integrity' },
  });
  f.reads.strategy.mockRejectedValueOnce(Error('PRIVATE_DATABASE_DETAIL'));
  const failed = await f.queries.strategy(actor);
  expect(failed).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(failed)).not.toContain('PRIVATE_');
  expect(
    await f.queries.sources(actor, { limit: 25, after: 'invalid-source-cursor' }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('reads only validated current policy and refuses corrupt version or payload authority', async () => {
  const f = setup(),
    policy = {
      schemaVersion: 1 as const,
      issuedAt: at,
      expiresAt: '2026-11-04T19:00:00.000Z',
      accountId: null,
      adsTxt: [],
      blockedCategories: [],
      blockedUrls: [],
      slots: [],
    };
  f.reads.configuration.mockResolvedValue({ version: 1, policy, networkReady: false });
  expect(await f.queries.configuration(actor)).toMatchObject({
    ok: true,
    value: { version: 1, policy },
  });
  f.reads.configuration.mockResolvedValue({ version: 0, policy, networkReady: false });
  expect(await f.queries.configuration(actor)).toMatchObject({
    ok: false,
    error: { code: 'integrity' },
  });
  const corrupt = { ...policy, privatePayload: 'PRIVATE' };
  f.reads.configuration.mockResolvedValue({ version: 1, policy: corrupt, networkReady: false });
  expect(await f.queries.configuration(actor)).toMatchObject({
    ok: false,
    error: { code: 'integrity' },
  });
});
