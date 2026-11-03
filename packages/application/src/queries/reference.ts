import type { CatalogRepository, FactFilters, CatalogPin } from '../ports/catalog.ts';
import type { FactKind } from '../ports/catalog-records.ts';
import type { UnitOfWork } from '../ports/transactions.ts';
import { failure } from '../ports/transactions.ts';
import { pageRequest } from '../ports/pagination.ts';
import { id, ok, fail } from '../../../domain/src/values/core.ts';

const kinds = [
  'domainEntityVersions',
  'domainAliases',
  'vehicles',
  'vehicleLookupOptions',
  'fitmentConfigurations',
  'fitmentAxles',
  'tireModels',
  'tireSkus',
  'recalls',
  'adviceFacts',
] as const;
export function createReferenceQuery(uow: UnitOfWork, catalog: CatalogRepository) {
  return async (query: URLSearchParams) => {
    const allowed = [
      'kind',
      'market',
      'bundle',
      'after',
      'limit',
      'id',
      'modelYear',
      'makeEntityId',
      'vehicleId',
      'configurationId',
      'sizeCode',
      'modelId',
      'skuId',
      'locale',
    ];
    if (
      [...query.keys()].some((k) => !allowed.includes(k)) ||
      !kinds.includes(query.get('kind') as (typeof kinds)[number])
    )
      return fail(failure('invalid_input'));
    const kind = query.get('kind') as FactKind,
      market = query.get('market') ?? 'US';
    const page = pageRequest(Number(query.get('limit') ?? '25'), query.get('after'));
    const bundle = query.has('bundle') ? id('bundle', query.get('bundle')) : ok(null);
    if (!page.ok || !bundle.ok || market !== 'US') return fail(failure('invalid_input'));
    const filters: Record<string, string | number> = {};
    for (const field of allowed.slice(5)) {
      if (!query.has(field)) continue;
      const value = query.get(field)!;
      if (field === 'modelYear') {
        if (!/^\d{4}$/.test(value) || Number(value) < 1900 || Number(value) > 2200)
          return fail(failure('invalid_input'));
        filters[field] = Number(value);
      } else {
        if (
          !value ||
          value.length > 100 ||
          ((field.endsWith('Id') || field === 'id') && !id('reference', value).ok)
        )
          return fail(failure('invalid_input'));
        filters[field] = value;
      }
    }
    return uow.run<{
      coverage: CatalogPin['coverage'];
      source: CatalogPin | null;
      items: readonly unknown[];
      next: string | null;
    }>(async (tx) => {
      const pin = await catalog.pin(tx, market, bundle.value);
      if (!pin) return ok({ coverage: 'unavailable', source: null, items: [], next: null });
      const values = await catalog.page(tx, {
        kind,
        bundleId: pin.bundleId,
        market,
        filters: filters as FactFilters<FactKind>,
        page: page.value,
      });
      return ok({ coverage: pin.coverage, source: pin, ...values });
    });
  };
}
