import type { Id, Instant } from '../../../domain/src/values/index.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Page, PageRequest } from './pagination.ts';
export interface SeoPage {
  readonly id: Id<'seo_page'>;
  readonly path: string;
  readonly canonical: string;
  readonly status: string;
  readonly reviewDue: Instant;
}
export interface OperationsRepository {
  pages(tx: Tx, page: PageRequest): Promise<Page<SeoPage>>;
  staff(
    tx: Tx,
    id: Id<'staff'>,
  ): Promise<{ readonly active: boolean; readonly roles: readonly string[] } | null>;
  configuration(
    tx: Tx,
    key: string,
  ): Promise<{ readonly version: number; readonly status: string } | null>;
  affiliate(
    tx: Tx,
    key: string,
    market: string,
  ): Promise<{ readonly destination: string; readonly checkedAt: Instant } | null>;
  slots(
    tx: Tx,
    route: string,
  ): Promise<readonly { readonly key: string; readonly active: boolean }[]>;
  search(
    tx: Tx,
    page: Id<'seo_page'>,
    day: string,
    source: 'search_console' | 'bing_webmaster',
  ): Promise<{
    readonly clicks: bigint;
    readonly impressions: bigint;
    readonly positionSum: string | null;
  } | null>;
  ads(
    tx: Tx,
    account: Id<'ad_account'>,
    day: string,
    dimension: string,
    currency: string,
    status: 'estimated' | 'finalized',
  ): Promise<{
    readonly impressions: bigint;
    readonly eligibleRequests: bigint | null;
    readonly revenueMinor: bigint;
    readonly sourceRevision: string;
  } | null>;
  metric(
    tx: Tx,
    day: string,
    metric: 'events' | 'sessions',
    market: string,
    dimension: string,
  ): Promise<{
    readonly value: bigint;
    readonly generation: bigint;
    readonly pending: boolean;
    readonly computedAt: Instant;
  } | null>;
}
