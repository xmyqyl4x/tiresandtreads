import type { Id, Instant, Revision } from '../values/core.ts';
export interface CsvColumn {
  readonly name: string;
  readonly type: 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'https_url';
  readonly required: boolean;
  readonly unit?: 'none' | 'mm' | 'inch' | 'minor_currency' | 'percent';
}
export interface CsvTemplate {
  readonly id: Id<'csv_template'>;
  readonly key: string;
  readonly version: number;
  readonly sourceKind: string;
  readonly schemaVersion: string;
  readonly mappingVersion: string;
  readonly parserRevision: string;
  readonly definitionHash: string;
  readonly columns: readonly CsvColumn[];
  readonly maxBytes: number;
  readonly maxRows: number;
  readonly state: 'draft' | 'active' | 'retired';
}
export interface CsvWorkflow {
  readonly id: Id<'csv_intake'>;
  readonly runId: Id<'import_run'>;
  readonly templateId: Id<'csv_template'>;
  readonly status: string;
  readonly accepted: bigint;
  readonly rejected: bigint;
  readonly jobState: string;
  readonly expiresAt: Instant;
  readonly current: boolean;
}
export interface CsvReview {
  readonly id: Id<'csv_review'>;
  readonly intakeId: Id<'csv_intake'>;
  readonly runRevision: Revision;
  readonly fence: bigint;
  readonly expectedHead: bigint;
  readonly diffId: Id<'import_artifact'>;
  readonly validationId: Id<'import_artifact'>;
  readonly reviewerId: Id<'staff'>;
  readonly roleRevision: Revision;
  readonly decision: 'approved' | 'rejected';
  readonly reason: string;
}
