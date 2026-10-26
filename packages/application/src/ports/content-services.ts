import type { Id, Instant } from '../../../domain/src/values/index.ts';
import type { PublicPage, RedirectRule } from '../../../domain/src/public-policy.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { ContentKey, ConfigurationSnapshot, PublicConfiguration } from './publication.ts';
export interface CmsRef {
  readonly collection: 'articles' | 'glossary-terms';
  readonly id: Id<'cms_document'>;
  readonly revision: number;
}
export interface CmsSource extends CmsRef, ContentKey {
  readonly title: string;
  readonly body: unknown;
  readonly published: boolean;
  readonly approved: boolean;
  readonly reviewerId: Id<'staff'> | null;
  readonly reviewedAt: Instant | null;
  readonly modifiedAt: Instant;
  readonly expiresAt: Instant | null;
  readonly sourceUrl: string | null;
}
export interface ContentPacket extends ContentKey {
  readonly schemaVersion: 1;
  readonly ref: CmsRef;
  readonly generation: string;
  readonly publishedAt: Instant;
  readonly expiresAt: Instant;
  readonly publisherId: Id<'staff'>;
  readonly reviewerId: Id<'staff'>;
  readonly page: PublicPage | null;
}
export interface CmsLease {
  readonly id: Id<'cms_work'>;
  readonly token: Id<'lease'>;
  readonly generation: bigint;
  readonly packet: ContentPacket;
}
export interface EditorialRepository {
  source(tx: Tx, ref: CmsRef): Promise<CmsSource | null>;
  enqueue(tx: Tx, packet: ContentPacket): Promise<Id<'cms_work'>>;
  lease(tx: Tx, id: Id<'cms_work'>): Promise<CmsLease | null>;
  current(tx: Tx, lease: CmsLease): Promise<boolean>;
  finish(tx: Tx, lease: CmsLease, status: 'published' | 'cancelled'): Promise<void>;
  fail(tx: Tx, lease: CmsLease): Promise<void>;
  pending(tx: Tx): Promise<readonly Id<'cms_work'>[]>;
}
export interface RedirectSnapshot {
  readonly revision: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly rules: readonly RedirectRule[];
}
export interface SearchDay {
  readonly day: string;
  readonly clicks: bigint;
  readonly impressions: bigint;
  readonly positionSum: string | null;
}
export interface RegisteredPage {
  readonly id: Id<'seo_page'>;
  readonly page: PublicPage;
}
export interface ContentServiceRepository {
  authorize(
    tx: Tx,
    actor: Id<'staff'>,
    permission: 'content.publish' | 'seo.publish',
  ): Promise<void>;
  apply(tx: Tx, packet: ContentPacket): Promise<'published' | 'stale'>;
  configure(
    tx: Tx,
    value: PublicConfiguration,
    reviewer: Id<'staff'>,
  ): Promise<ConfigurationSnapshot>;
  redirects(
    tx: Tx,
    value: RedirectSnapshot,
    checksum: string,
    reviewer: Id<'staff'>,
  ): Promise<void>;
  currentRedirects(tx: Tx): Promise<Readonly<{ value: RedirectSnapshot; checksum: string }> | null>;
  page(tx: Tx, path: string, locale: string, market: string): Promise<RegisteredPage | null>;
  pages(
    tx: Tx,
    locale: string,
    market: string,
    after: string | null,
    limit: number,
  ): Promise<readonly RegisteredPage[]>;
  translations(tx: Tx, key: string): Promise<readonly PublicPage[]>;
  known(tx: Tx, path: string): Promise<boolean>;
  path(tx: Tx, id: Id<'seo_page'>): Promise<string | null>;
  audit(
    tx: Tx,
    id: Id<'seo_audit'>,
    pages: readonly { readonly id: Id<'seo_page'>; readonly findings: readonly string[] }[],
    complete: boolean,
  ): Promise<void>;
  search(
    tx: Tx,
    page: Id<'seo_page'>,
    rows: readonly SearchDay[],
    fetchedAt: Instant,
    revision: string,
  ): Promise<void>;
  metrics(
    tx: Tx,
    page: Id<'seo_page'>,
    day: string,
  ): Promise<(SearchDay & { readonly fetchedAt: Instant }) | null>;
}
export interface PublicSnapshots {
  put(key: string, bytes: Uint8Array): Promise<void>;
}
export interface ContentIdentity {
  id<K extends string>(kind: K): Id<K>;
  checksum(value: unknown): string;
}
export interface CrawlObservation {
  readonly status: number;
  readonly title: string | null;
  readonly description: string | null;
  readonly canonical: string | null;
  readonly robots: string | null;
  readonly links: readonly string[];
}
export interface PublicCrawler {
  observe(path: string): Promise<CrawlObservation>;
}
export interface SearchProvider {
  readonly enabled: boolean;
  daily(path: string, start: string, end: string): Promise<readonly SearchDay[]>;
  notify(paths: readonly string[]): Promise<'received' | 'pending_key' | 'disabled'>;
}
