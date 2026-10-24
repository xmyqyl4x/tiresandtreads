import { invalid, ok, type Result } from '../../../domain/src/values/core.ts';
declare const pageSize: unique symbol;
export type PageSize = number & { readonly [pageSize]: 'page_size' };
export interface PageRequest {
  readonly limit: PageSize;
  readonly after: string | null;
}
export function pageRequest(limit: unknown, after: unknown = null): Result<PageRequest> {
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !(after === null || (typeof after === 'string' && after.length > 0 && after.length <= 512))
  )
    return invalid('page');
  return ok(Object.freeze({ limit: limit as PageSize, after }));
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}
