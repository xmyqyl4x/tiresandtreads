import { it, expect, vi } from 'vitest';
import { createReferenceQuery } from '../../packages/application/src/queries/reference.ts';
import type { CatalogRepository } from '../../packages/application/src/ports/catalog.ts';
import type { UnitOfWork } from '../../packages/application/src/ports/transactions.ts';
const uow: UnitOfWork = { run: (fn) => fn({} as never) };
function setup() {
  const pin = vi.fn(async () => null),
    page = vi.fn(async () => ({ items: [], next: null }));
  const catalog = { pin, page } as unknown as CatalogRepository;
  return { pin, page, run: createReferenceQuery(uow, catalog) };
}
it.each([
  'kind=bogus',
  'kind=vehicles&market=CA',
  'kind=vehicles&limit=101',
  'kind=vehicles&bundle=bad',
  'kind=vehicles&email=private',
  'kind=vehicles&modelYear=abc',
  'kind=vehicles&id=bad',
  'kind=vehicles&modelYear=1800',
  'kind=vehicles&locale=',
])('rejects invalid reference input %s before persistence', async (text) => {
  const s = setup();
  expect(await s.run(new URLSearchParams(text))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(s.pin).not.toHaveBeenCalled();
});
it('keeps a missing published bundle unavailable rather than fabricating form options', async () => {
  const s = setup();
  expect(await s.run(new URLSearchParams('kind=vehicles'))).toMatchObject({
    ok: true,
    value: { coverage: 'unavailable', items: [], source: null },
  });
  expect(s.page).not.toHaveBeenCalled();
});
it('pins the selected bundle and bounded pagination with source provenance', async () => {
  const s = setup();
  s.pin.mockResolvedValue({
    bundleId: '66666666-6666-4666-8666-666666666664',
    market: 'US',
    coverage: 'partial',
    components: [],
  } as never);
  const r = await s.run(new URLSearchParams('kind=vehicles&modelYear=2024&limit=5'));
  expect(r).toMatchObject({ ok: true, value: { coverage: 'partial', source: { components: [] } } });
  expect(s.page).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ page: { limit: 5, after: null }, filters: { modelYear: 2024 } }),
  );
});
