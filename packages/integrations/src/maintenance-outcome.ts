import { maintenanceActions } from '../../application/src/ports/service-maintenance.ts';
// A successful HTTP callback must not turn a failed/busy business action into a cached successful step.
export function completeMaintenance(input: unknown) {
  const invalid = (): never => {
    throw Error('Maintenance incomplete');
  };
  if (
    !input ||
    typeof input !== 'object' ||
    !('ok' in input) ||
    input.ok !== true ||
    !('value' in input)
  )
    return invalid();
  const value = input.value;
  if (
    !value ||
    typeof value !== 'object' ||
    !('status' in value) ||
    value.status !== 'completed' ||
    !('results' in value) ||
    !Array.isArray(value.results) ||
    value.results.length < 1 ||
    value.results.length > 4
  )
    return invalid();
  const seen = new Set<string>();
  const results = value.results.map((r: unknown) => {
    if (
      !r ||
      typeof r !== 'object' ||
      !('action' in r) ||
      typeof r.action !== 'string' ||
      !maintenanceActions.some((a) => a === r.action) ||
      seen.has(r.action) ||
      !('status' in r) ||
      (r.status !== 'completed' && r.status !== 'disabled')
    )
      return invalid();
    seen.add(r.action);
    if (r.status === 'disabled') return { action: r.action, status: 'disabled' as const };
    if (
      !('processed' in r) ||
      typeof r.processed !== 'number' ||
      !Number.isSafeInteger(r.processed) ||
      r.processed < 0 ||
      r.processed > 1000
    )
      return invalid();
    return { action: r.action, status: 'completed' as const, processed: r.processed };
  });
  return { ok: true as const, value: { status: 'completed' as const, results } };
}
