import { it, expect, vi } from 'vitest';
import { createPublicCommerceQuery } from '../../packages/application/src/queries/public-commerce.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
const slot = {
  key: 'education_one',
  route: 'education' as const,
  width: 300,
  height: 100,
  housePath: '/guides/trust',
  houseLabel: 'Understand the evidence',
  mode: 'house' as const,
  label: 'From Tires & Tread',
  refreshSeconds: null,
};
function setup() {
  const commercial = {
    placements: vi.fn<Parameters<typeof createPublicCommerceQuery>[0]['placements']>(async () =>
      ok([slot]),
    ),
    resolveAffiliate: vi.fn(async () =>
      ok(
        null as null | {
          destination: string;
          checkedAt: string;
          disclosure: string;
          rel: string;
          referrerPolicy: 'no-referrer';
        },
      ),
    ),
    adsTxt: vi.fn(async () => ok({ status: 'not_connected' as const, body: '', version: null })),
  };
  const content = vi.fn(async () => 2000 as number | null);
  return { commercial, content, q: createPublicCommerceQuery(commercial, content) };
}
it.each(['/', '/preview/report?report=PRIVATE', '/guides/size-decoder', '/learn/unreviewed'])(
  'does no commercial or content I/O on excluded %s',
  async (path) => {
    const f = setup();
    expect(await f.q.inventory(path)).toMatchObject({ slots: [], affiliates: [], network: 'held' });
    expect(f.content).not.toHaveBeenCalled();
    expect(f.commercial.placements).not.toHaveBeenCalled();
  },
);
it('returns only public house fields and never offers live activation from browser hints', async () => {
  const f = setup();
  const r = await f.q.inventory('/learn/tire-basics');
  expect(r.slots).toEqual([
    {
      key: slot.key,
      width: 300,
      height: 100,
      housePath: slot.housePath,
      houseLabel: slot.houseLabel,
      mode: 'house',
      label: slot.label,
    },
  ]);
  expect(f.commercial.placements).toHaveBeenCalledWith(
    '/learn/tire-basics',
    'US',
    expect.objectContaining({
      consent: false,
      cmpAvailable: false,
      gpc: true,
      internal: true,
      filled: false,
    }),
  );
  expect(JSON.stringify(r)).not.toMatch(/destination|accountId|staffId|reportId/);
});
it('suppresses expired/withdrawn pages, house targets and unavailable configuration', async () => {
  const f = setup();
  f.content.mockResolvedValueOnce(null);
  expect((await f.q.inventory('/learn/tire-basics')).slots).toEqual([]);
  f.content.mockResolvedValueOnce(2000).mockResolvedValueOnce(null);
  expect((await f.q.inventory('/learn/tire-basics')).slots).toEqual([]);
  f.commercial.placements.mockResolvedValueOnce(fail(failure('unavailable')));
  expect((await f.q.inventory('/learn/tire-basics')).slots).toEqual([]);
});
it('checks a current approved affiliate again at click time and cannot redirect arbitrary keys', async () => {
  const f = setup();
  const link = {
    destination: 'https://shop.example/tires?ref=site',
    checkedAt: new Date().toISOString(),
    disclosure: 'We may earn a commission from this link.',
    rel: 'sponsored noopener noreferrer',
    referrerPolicy: 'no-referrer' as const,
  };
  f.commercial.resolveAffiliate.mockResolvedValue(ok(link));
  expect((await f.q.inventory('/learn/tire-basics')).affiliates[0]?.href).toBe(
    '/go/approved_retailer',
  );
  f.commercial.resolveAffiliate.mockResolvedValue(ok(null));
  expect(await f.q.affiliate('approved_retailer')).toBeNull();
  const calls = f.commercial.resolveAffiliate.mock.calls.length;
  expect(await f.q.affiliate('https://evil.example')).toBeNull();
  expect(f.commercial.resolveAffiliate.mock.calls).toHaveLength(calls);
});
it('fails closed when a content or publication dependency throws', async () => {
  const f = setup();
  f.content.mockRejectedValueOnce(Error('private details'));
  expect(await f.q.inventory('/learn/tire-basics')).toMatchObject({
    slots: [],
    affiliates: [],
    network: 'held',
  });
});
it('withholds the complete inventory on short or invalid content before commercial reads', async () => {
  for (const count of [0, 599, NaN, Infinity, 600.5]) {
    const f = setup();
    f.content.mockResolvedValue(count);
    expect(await f.q.inventory('/learn/tire-basics')).toMatchObject({ slots: [], affiliates: [] });
    expect(f.commercial.placements).not.toHaveBeenCalled();
  }
});
