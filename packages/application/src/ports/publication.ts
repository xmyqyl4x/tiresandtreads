import type { Id, Instant } from '../../../domain/src/values/index.ts';
import type { TransactionContext as Tx } from './transactions.ts';

export interface ContentKey {
  readonly key: string;
  readonly locale: string;
  readonly market: string;
}
// Public text only. Rendering/sanitizing rich editorial documents belongs to the publication service.
export interface PublicContent {
  readonly title: string;
  readonly summary: string;
  readonly paragraphs: readonly string[];
}
export interface ContentPublication extends ContentKey {
  readonly generation: bigint;
  readonly cmsRevision: string;
  readonly publishedAt: Instant;
  readonly expiresAt: Instant;
  readonly content: PublicContent | null;
}
export interface PublicConfiguration {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly analytics: boolean;
  readonly advertising: boolean;
}
export interface ConfigurationSnapshot {
  readonly value: PublicConfiguration;
  readonly checksum: string;
}
export interface PublicationRepository {
  publish(tx: Tx, input: ContentPublication): Promise<void>;
  configure(
    tx: Tx,
    value: PublicConfiguration,
    reviewer: Id<'staff'>,
  ): Promise<ConfigurationSnapshot>;
}
export interface PublicReadRepository {
  content(tx: Tx, key: ContentKey): Promise<PublicContent | null>;
  configuration(tx: Tx): Promise<ConfigurationSnapshot | null>;
}
// Composition supplies a credentialed S3 GetObject transport. No URL, bucket or credential comes from UI input.
export interface PublicObjectReader {
  get(
    key: string,
    options: { readonly maxBytes: number; readonly signal: AbortSignal },
  ): Promise<Uint8Array>;
}
