import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type { CommercialPolicy } from '../../../domain/src/commercial-policy.ts';
import type { StaffPermission } from './commercial.ts';
import type { CatalogPin } from './catalog.ts';
import type { Page, PageRequest } from './pagination.ts';
import type { SeoPage } from './operations.ts';
export interface ReportTriage {
  readonly id: Id<'report'>;
  readonly state: 'draft' | 'active' | 'pending_deletion';
  readonly updatedAt: Instant;
}
export interface SourceHealthRow {
  readonly key: string;
  readonly kind: string;
  readonly enabled: boolean;
  readonly hasError: boolean;
  readonly lastRunState: string | null;
  readonly lastAttemptAt: Instant | null;
  readonly lastSucceededAt: Instant | null;
  readonly nextDueAt: Instant | null;
}
export interface StaffConsoleReads {
  findings(page: PageRequest): Promise<
    Page<{
      readonly id: string;
      readonly pageId: string;
      readonly rule: string;
      readonly severity: string;
      readonly state: string;
      readonly detectedAt: Instant;
    }>
  >;
  reports(page: PageRequest): Promise<Page<ReportTriage>>;
  sources(page: PageRequest): Promise<Page<SourceHealthRow>>;
  bundle(): Promise<CatalogPin | null>;
  strategy(page: PageRequest): Promise<Page<SeoPage>>;
  configuration(): Promise<{
    readonly version: number;
    readonly policy: CommercialPolicy;
    readonly networkReady: boolean;
  } | null>;
}
export interface StaffConsoleAuthority {
  require(actor: Id<'staff'>, permission: StaffPermission): Promise<void>;
}
