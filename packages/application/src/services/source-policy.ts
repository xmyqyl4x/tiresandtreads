import { ok, fail } from '../../../domain/src/values/core.ts';
import { failure } from '../ports/transactions.ts';
import type { SourceSpec } from '../ports/sources.ts';
export function parseSourceSpec(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail(failure('invalid_input'));
  const x = input as Record<string, unknown>,
    keys = Object.keys(x).sort().join(',');
  if (x.type === 'vpic-manufacturers' && keys === 'type') return ok<SourceSpec>({ type: x.type });
  if (x.type === 'nhtsa-tire-recalls' && keys === 'type') return ok<SourceSpec>({ type: x.type });
  if (
    x.type === 'vpic-plants' &&
    keys === 'equipmentType,type,year' &&
    typeof x.year === 'number' &&
    Number.isInteger(x.year) &&
    x.year >= 2016 &&
    x.year <= 2200 &&
    (x.equipmentType === 1 || x.equipmentType === 16)
  )
    return ok<SourceSpec>({ type: x.type, year: x.year, equipmentType: x.equipmentType });
  if (
    x.type === 'vpic-models' &&
    keys === 'makeId,type,vehicleType,year' &&
    typeof x.makeId === 'number' &&
    Number.isSafeInteger(x.makeId) &&
    x.makeId > 0 &&
    x.makeId <= 1000000000 &&
    typeof x.year === 'number' &&
    Number.isInteger(x.year) &&
    x.year >= 1996 &&
    x.year <= 2200 &&
    (x.vehicleType === 'passenger car' || x.vehicleType === 'truck')
  )
    return ok<SourceSpec>({
      type: x.type,
      makeId: x.makeId,
      year: x.year,
      vehicleType: x.vehicleType,
    });
  return fail(failure('invalid_input'));
}
export function sourceKey(spec: SourceSpec) {
  switch (spec.type) {
    case 'vpic-models':
      return `nhtsa_models_${spec.makeId}_${spec.year}_${spec.vehicleType.replaceAll(' ', '_')}`;
    case 'vpic-plants':
      return `nhtsa_plants_${spec.equipmentType}_${spec.year}`;
    case 'vpic-manufacturers':
      return 'nhtsa_manufacturers';
    case 'nhtsa-tire-recalls':
      return 'nhtsa_tire_recalls';
  }
}
export function sourceInterval(spec: SourceSpec) {
  return spec.type === 'vpic-plants' || spec.type === 'vpic-manufacturers' ? 604800 : 86400;
}
