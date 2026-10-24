import {
  id,
  revision,
  instant,
  money,
  quantity,
  tireSize,
  known,
  unknown,
  ok,
  invalid,
  type Result,
  type Money,
  type TireSize,
} from '../../domain/src/values/index.ts';
import type { ReportHead } from '../../domain/src/entities/report.ts';
export interface IntegrityError {
  readonly code: 'invalid_stored_data';
  readonly field: string;
}
export type StorageRow = Readonly<Record<string, unknown>>;
function integrity(field: string): Result<never, IntegrityError> {
  return { ok: false, error: { code: 'invalid_stored_data', field } };
}
function timestamp(value: unknown) {
  return instant(
    value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value,
  );
}
export function moneyFromRow(
  row: StorageRow,
  currencies: readonly string[],
): Result<Money, IntegrityError> {
  const parsed = money(row.unit_price_minor, row.currency, currencies);
  return parsed.ok ? parsed : integrity('price');
}
export function moneyToRow(value: Money): Readonly<{ unit_price_minor: string; currency: string }> {
  return Object.freeze({ unit_price_minor: value.minor.toString(), currency: value.currency });
}
export function tireSizeFromRow(row: StorageRow): Result<TireSize, IntegrityError> {
  const width = row.width_mm === null ? ok(unknown('not_supplied')) : quantity(row.width_mm, 'mm');
  const aspect =
    row.aspect_ratio === null ? ok(unknown('not_supplied')) : quantity(row.aspect_ratio, 'percent');
  const rim = quantity(row.rim_inches, 'inch');
  if (!width.ok || !aspect.ok || !rim.ok || typeof row.size_code !== 'string')
    return integrity('tire_size');
  const result = tireSize({
    code: row.size_code,
    width: 'unit' in width.value ? known(width.value) : width.value,
    aspect: 'unit' in aspect.value ? known(aspect.value) : aspect.value,
    rim: rim.value,
  });
  return result.ok ? result : integrity('tire_size');
}
export function reportHeadFromRow(row: StorageRow): Result<ReportHead, IntegrityError> {
  const report = id('report', row.id),
    owner = id('subject', row.owner_subject_id),
    rev = revision(row.revision),
    expires = timestamp(row.expires_at);
  const version = row.current_version;
  if (
    !report.ok ||
    !owner.ok ||
    !rev.ok ||
    !expires.ok ||
    !(
      version === null ||
      (typeof version === 'number' &&
        Number.isInteger(version) &&
        version > 0 &&
        version <= 2147483647)
    )
  )
    return integrity('report_head');
  const common = {
    id: report.value,
    ownerId: owner.value,
    revision: rev.value,
    expiresAt: expires.value,
  };
  if (row.status === 'active' && version !== null)
    return ok(Object.freeze({ ...common, status: 'active', currentVersion: version }));
  if (row.status === 'draft' || row.status === 'pending_deletion')
    return ok(Object.freeze({ ...common, status: row.status, currentVersion: version }));
  return integrity('report_state');
}
export function schemaVersion(value: unknown): Result<1> {
  return value === 1 ? ok(1) : invalid('schema_version');
}
