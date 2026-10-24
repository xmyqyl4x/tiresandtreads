import type { Id, Instant, Revision } from '../values/index.ts';
export type ReportHead = Readonly<{
  id: Id<'report'>;
  ownerId: Id<'subject'>;
  revision: Revision;
  expiresAt: Instant;
}> &
  (
    | Readonly<{ status: 'active'; currentVersion: number }>
    | Readonly<{ status: 'draft' | 'pending_deletion'; currentVersion: number | null }>
  );
export interface ReportVersionRef {
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly bundleId: Id<'bundle'>;
  readonly ruleVersionId: Id<'rule'>;
  readonly engineVersion: string;
  readonly schemaVersion: 1;
}
