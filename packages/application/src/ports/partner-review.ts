import type { Id, Revision } from '../../../domain/src/values/core.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export type ReviewKind = 'businesses' | 'offers';
export interface ReviewCursor {
  readonly org: Id<'organization'>;
  readonly offer: Id<'partner_offer'> | null;
  readonly version: number | null;
}
export interface ReviewQueueRow {
  readonly org: Id<'organization'>;
  readonly resource: string;
  readonly version: number | null;
  readonly title: string;
  readonly state: string;
  readonly revision: Revision | null;
}
export interface ReviewAsset {
  readonly id: Id<'asset'>;
  readonly purpose: 'agreement' | 'verification';
  readonly state: string;
  readonly expiresAt: string;
}
export interface ReviewContext {
  readonly assets: readonly ReviewAsset[];
  readonly agreements: readonly {
    kind: string;
    version: string;
    status: string;
    expiresAt: string;
  }[];
  readonly locations: readonly { id: string; key: string; region: string; status: string }[];
  readonly truncated: boolean;
}
export interface PartnerReviewRepository {
  queue(
    tx: Tx,
    kind: ReviewKind,
    after: ReviewCursor | null,
    limit: number,
  ): Promise<readonly ReviewQueueRow[]>;
  context(tx: Tx, org: Id<'organization'>): Promise<ReviewContext>;
  targets(
    tx: Tx,
    org: Id<'organization'>,
    offer: Id<'partner_offer'>,
    version: number,
  ): Promise<
    readonly {
      strategy: string;
      value: string | null;
      sku: string | null;
      model: string | null;
      brand: string | null;
      location: string | null;
      rim: string | null;
      radius: string | null;
    }[]
  >;
}
