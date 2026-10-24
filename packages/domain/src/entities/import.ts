import type { Id, Instant, Revision } from '../values/index.ts';
export interface ImportIdentity {
  readonly providerId: Id<'provider'>;
  readonly kind: string;
  readonly upstreamRunKey: string;
  readonly checksum: string;
  readonly schemaVersion: string;
  readonly mappingVersion: string;
}
export interface ImportRun {
  readonly id: Id<'import_run'>;
  readonly identity: ImportIdentity;
  readonly revision: Revision;
  readonly status:
    | 'registered'
    | 'fetching'
    | 'staging'
    | 'validated'
    | 'rejected'
    | 'publishing'
    | 'published'
    | 'failed'
    | 'cancelled';
  readonly startedAt: Instant;
  readonly datasetId: Id<'dataset'> | null;
}
