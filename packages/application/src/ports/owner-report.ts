import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { ReportHead } from '../../../domain/src/entities/report.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Page, PageRequest } from './pagination.ts';
import type {
  Owner,
  KeyDigest,
  Version,
  ReportItem,
  Draft,
  Comparison,
  CompareItem,
  Quote,
  JsonObject,
  SharedVersion,
  AssetGrant,
} from './private-records.ts';
export interface OwnerRepository {
  create(
    tx: Tx,
    input: Readonly<{ owner: Owner; key: KeyDigest; expiresAt: Instant }>,
  ): Promise<Owner>;
  resolve(tx: Tx, keys: readonly KeyDigest[]): Promise<Owner | null>;
  rotate(
    tx: Tx,
    owner: Owner,
    input: Readonly<{ sessionId: Id<'owner_session'>; key: KeyDigest; expiresAt: Instant }>,
  ): Promise<Owner>;
  revoke(tx: Tx, owner: Owner): Promise<void>;
}
export interface ReportRepository {
  touch(tx: Tx, owner: Owner, reportId: Id<'report'>): Promise<void>;
  items(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    version: number,
  ): Promise<readonly ReportItem[]>;
  create(
    tx: Tx,
    owner: Owner,
    input: Readonly<{ id: Id<'report'>; market: string; locale: string; expiresAt: Instant }>,
  ): Promise<ReportHead>;
  head(tx: Tx, owner: Owner, reportId: Id<'report'>): Promise<ReportHead | null>;
  list(tx: Tx, owner: Owner, page: PageRequest): Promise<Page<ReportHead>>;
  version(tx: Tx, owner: Owner, reportId: Id<'report'>, version: number): Promise<Version | null>;
  publish(
    tx: Tx,
    owner: Owner,
    expectedRevision: Revision,
    version: Version,
    items: readonly ReportItem[],
  ): Promise<ReportHead>;
  draft(tx: Tx, owner: Owner, reportId: Id<'report'>): Promise<Draft | null>;
  saveDraft(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    expectedRevision: Revision | null,
    draft: Omit<Draft, 'revision'>,
  ): Promise<Draft>;
  compare(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    version: number,
    expectedRevision: Revision | null,
    scenario: JsonObject,
    items: readonly CompareItem[],
  ): Promise<Comparison>;
  comparison(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    version: number,
    revision: Revision,
  ): Promise<Comparison | null>;
  saveQuote(
    tx: Tx,
    owner: Owner,
    expectedRevision: Revision | null,
    quote: Quote,
  ): Promise<Revision>;
  quotes(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    page: PageRequest,
  ): Promise<Page<Quote & { readonly revision: Revision }>>;
}
export interface CapabilityRepository {
  share(
    tx: Tx,
    owner: Owner,
    input: Readonly<{
      id: Id<'report_capability'>;
      reportId: Id<'report'>;
      version: number | null;
      comparisonRevision?: Revision | null;
      key: KeyDigest;
      expiresAt: Instant;
    }>,
  ): Promise<void>;
  resolveShare(tx: Tx, keys: readonly KeyDigest[]): Promise<SharedVersion | null>;
  revokeShare(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    capabilityId: Id<'report_capability'>,
  ): Promise<void>;
  asset(
    tx: Tx,
    owner: Owner,
    input: Readonly<{
      assetId: Id<'asset'>;
      reportId: Id<'report'>;
      version: number;
      comparisonRevision: Revision | null;
      rendererVersion: string;
      locale: string;
      scope: 'owner' | 'shared';
      renderKey: string;
    }>,
  ): Promise<void>;
  grant(
    tx: Tx,
    authority: Readonly<{ owner: Owner }> | Readonly<{ shareKeys: readonly KeyDigest[] }>,
    input: Readonly<{
      id: Id<'download_grant'>;
      assetId: Id<'asset'>;
      reportId: Id<'report'>;
      version: number;
      scope: 'owner' | 'shared';
      key: KeyDigest;
      expiresAt: Instant;
    }>,
  ): Promise<void>;
  download(tx: Tx, keys: readonly KeyDigest[]): Promise<AssetGrant | null>;
}
