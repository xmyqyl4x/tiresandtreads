import { createPublicCommerceQuery } from '../../../application/src/queries/public-commerce.ts';
import type { createCommercialServices } from '../../../application/src/services/commercial.ts';
import {
  publicCommerceView,
  affiliateView,
  adsTxtView,
} from '../../../contracts/src/public-commerce.ts';
import { ok, fail } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type { HttpRoute } from './core.ts';
export function publicCommerceRoutes(d: {
  readonly commercial: Pick<
    ReturnType<typeof createCommercialServices>,
    'placements' | 'resolveAffiliate' | 'adsTxt'
  >;
  readonly content: (path: string) => Promise<number | null>;
}): readonly HttpRoute[] {
  const q = createPublicCommerceQuery(d.commercial, d.content);
  const route = (suffix: string, handle: HttpRoute['handle']): HttpRoute => ({
    operationId: 'localCommerce' + suffix.replace(/\W/g, ''),
    path: '/api/v1/public-commerce/' + suffix,
    method: 'GET',
    access: 'public',
    command: false,
    handle,
  });
  return [
    route('inventory', async (c) => {
      if (
        [...c.query.keys()].some((k) => k !== 'path') ||
        c.query.getAll('path').length !== 1 ||
        (c.query.get('path')?.length ?? 0) > 500
      )
        return fail(failure('invalid_input'));
      return ok(publicCommerceView.parse(await q.inventory(c.query.get('path')!)));
    }),
    route('affiliate/:key', async (c) => {
      if (c.query.size) return fail(failure('invalid_input'));
      const a = await q.affiliate(c.params.key!);
      return a ? ok(affiliateView.parse(a)) : fail(failure('not_found'));
    }),
    route('ads-txt', async (c) => {
      if (c.query.size) return fail(failure('invalid_input'));
      const r = await q.adsTxt();
      return r.ok ? ok(adsTxtView.parse(r.value)) : r;
    }),
  ];
}
