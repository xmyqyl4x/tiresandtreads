import type {
  CsvTemplate,
  CsvWorkflow,
  CsvReview,
  CsvColumn,
} from '../../../domain/src/entities/csv-review.ts';
import {
  decode,
  uid,
  word,
  choice,
  num,
  big,
  bool,
  hash,
  revisionValue,
  at,
  frozen,
  type Row,
} from './analysis-values.ts';
import { reject, boundedJson } from './bounds.ts';
export function columns(value: unknown): readonly CsvColumn[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return reject();
  const result = value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return reject();
    const c = item as Row;
    if (Object.keys(c).some((k) => !['name', 'type', 'required', 'unit'].includes(k)))
      return reject();
    const name = word(c.name, 64);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) return reject();
    return {
      name,
      type: choice(c.type, ['text', 'integer', 'decimal', 'boolean', 'date', 'https_url']),
      required: bool(c.required),
      ...(c.unit === undefined
        ? {}
        : { unit: choice(c.unit, ['none', 'mm', 'inch', 'minor_currency', 'percent']) }),
    };
  });
  if (new Set(result.map((c) => c.name)).size !== result.length) return reject();
  boundedJson(result, 65536);
  return frozen(result);
}
export const csvTemplateFromRow = (r: Row) =>
  decode<CsvTemplate>('csv_template', () => {
    const key = word(r.template_key, 64),
      parserRevision = word(r.parser_revision, 40);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !/^[a-f0-9]{40}$/.test(parserRevision))
      return reject();
    return {
      id: uid('csv_template', r.id),
      key,
      version: num(r.version, 1),
      sourceKind: word(r.source_kind, 80),
      schemaVersion: word(r.schema_version, 80),
      mappingVersion: word(r.mapping_version, 80),
      parserRevision,
      definitionHash: hash(r.definition_hash),
      columns: columns(r.columns),
      maxBytes: num(r.max_bytes, 1, 20971520),
      maxRows: num(r.max_rows, 1, 100000),
      state: choice(r.state, ['draft', 'active', 'retired']),
    };
  });
export const csvWorkflowFromRow = (r: Row) =>
  decode<CsvWorkflow>('csv_workflow', () => ({
    id: uid('csv_intake', r.id),
    runId: uid('import_run', r.run_id),
    templateId: uid('csv_template', r.template_id),
    status: choice(r.status, [
      'registered',
      'fetching',
      'staging',
      'publishing',
      'validated',
      'rejected',
      'published',
      'failed',
      'cancelled',
    ]),
    accepted: big(r.accepted_count),
    rejected: big(r.rejected_count),
    jobState: choice(r.validation_job_state, [
      'pending',
      'running',
      'completed',
      'manual_review',
      'failed',
      'cancelled',
    ]),
    expiresAt: at(r.expires_at),
    current: bool(r.current),
  }));
export const csvReviewFromRow = (r: Row) =>
  decode<CsvReview>('csv_review', () => ({
    id: uid('csv_review', r.id),
    intakeId: uid('csv_intake', r.intake_id),
    runRevision: revisionValue(r.run_revision),
    fence: big(r.run_fence),
    expectedHead: big(r.expected_head_revision),
    diffId: uid('import_artifact', r.diff_artifact_id),
    validationId: uid('import_artifact', r.validation_artifact_id),
    reviewerId: uid('staff', r.reviewer_id),
    roleRevision: revisionValue(r.reviewer_role_revision),
    decision: choice(r.decision, ['approved', 'rejected']),
    reason: word(r.reason_code, 64),
  }));
