import type { KeyDigest } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export interface QuotaPrincipal {
  readonly policy: string;
  readonly version: string;
  readonly keys: readonly KeyDigest[];
}
export type QuotaDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };
export interface LimiterRepository {
  // Run in its own short unit of work; an accepted attempt survives downstream command failure.
  consume(tx: Tx, principals: readonly QuotaPrincipal[]): Promise<QuotaDecision>;
  cleanup(tx: Tx, limit: number): Promise<number>;
}
