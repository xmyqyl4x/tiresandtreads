import { createHash } from 'node:crypto';
import type { SourceSpec, SourceIdentity } from '../../../application/src/ports/sources.ts';
import type { ImportFact } from '../../../application/src/ports/import-service.ts';
export function sourceObject(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('Source schema');
  return x as Record<string, unknown>;
}
export function sourceText(x: unknown, max = 200) {
  if (typeof x !== 'string' || !x.trim() || x.length > max || x.includes('\0'))
    throw Error('Source schema');
  return x.trim();
}
function sourceNumber(x: unknown) {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 1 || x > 1000000000)
    throw Error('Source schema');
  return x;
}
export function vpicEnvelope(input: unknown) {
  const x = sourceObject(input);
  if (
    !Array.isArray(x.Results) ||
    typeof x.Count !== 'number' ||
    !Number.isSafeInteger(x.Count) ||
    x.Count !== x.Results.length ||
    x.Count > 50000 ||
    typeof x.Message !== 'string' ||
    !/results returned successfully/i.test(x.Message)
  )
    throw Error('Source incomplete');
  return x.Results as unknown[];
}
export function* vpicFacts(
  spec: SourceSpec,
  rows: readonly unknown[],
  identity: SourceIdentity,
): Generator<ImportFact> {
  const seen = new Map<string, string>();
  function* entity(
    key: string,
    kind: 'company' | 'brand' | 'plant' | 'vehicle_make' | 'vehicle_model',
    name: string,
    namespace: string,
    externalId: string,
  ): Generator<ImportFact> {
    if (seen.has(key)) {
      if (seen.get(key) !== name) throw Error('Source identity conflict');
      return;
    }
    seen.set(key, name);
    const entityId = identity.entity(key);
    yield {
      kind: 'domainEntityVersions',
      identities: [{ id: entityId, kind, stableKey: key }],
      record: {
        id: identity.record('domain_entity_version', 'name:' + key),
        entityId,
        displayName: name,
        countryCode: null,
        officialUrl: null,
        validFrom: null,
        validTo: null,
        reviewStatus: 'unreviewed',
        sourceRecordKey: 'name:' + key,
      },
    };
    yield {
      kind: 'domainIdentifiers',
      record: {
        id: identity.record('domain_identifier', 'identifier:' + key),
        entityId,
        namespace,
        externalId,
        validFrom: null,
        validTo: null,
        sourceRecordKey: 'identifier:' + key,
      },
    };
  }
  for (const raw of rows) {
    const row = sourceObject(raw);
    if (spec.type === 'vpic-models') {
      const make = sourceNumber(row.Make_ID),
        model = sourceNumber(row.Model_ID),
        makeName = sourceText(row.Make_Name),
        modelName = sourceText(row.Model_Name);
      if (
        make !== spec.makeId ||
        sourceNumber(row.VehicleTypeId) !== (spec.vehicleType === 'truck' ? 3 : 2) ||
        sourceText(row.VehicleTypeName).toLowerCase() !== spec.vehicleType
      )
        throw Error('Source scope mismatch');
      const makeKey = `nhtsa:make:${make}`,
        modelKey = `nhtsa:model:${make}:${model}`,
        key = `lookup:${make}:${model}:${spec.year}:${spec.vehicleType.replaceAll(' ', '_')}`;
      yield* entity(makeKey, 'vehicle_make', makeName, 'nhtsa:make_id', String(make));
      yield* entity(modelKey, 'vehicle_model', modelName, 'nhtsa:model_id', String(model));
      yield {
        kind: 'domainRelationships',
        record: {
          id: identity.record('domain_relationship', 'relationship:' + modelKey),
          fromEntityId: identity.entity(modelKey),
          toEntityId: identity.entity(makeKey),
          kind: 'model_of_make',
          validFrom: null,
          validTo: null,
          sourceUrl: 'https://vpic.nhtsa.dot.gov/api/',
          reviewStatus: 'unreviewed',
          sourceRecordKey: 'relationship:' + modelKey,
        },
      };
      yield {
        kind: 'vehicleLookupOptions',
        record: {
          id: identity.record('vehicle_lookup_option', key),
          makeEntityId: identity.entity(makeKey),
          modelEntityId: identity.entity(modelKey),
          modelYear: spec.year,
          vehicleType: spec.vehicleType,
          market: 'US',
          sourceTrim: null,
          sourceRecordKey: key,
        },
      };
    } else if (spec.type === 'vpic-manufacturers') {
      const mfr = sourceNumber(row.Mfr_ID),
        name = sourceText(row.Mfr_Name),
        key = `nhtsa:manufacturer:${mfr}`;
      if (
        !Array.isArray(row.VehicleTypes) ||
        !(row.Country === null || typeof row.Country === 'string') ||
        !(row.Mfr_CommonName === null || typeof row.Mfr_CommonName === 'string')
      )
        throw Error('Source schema');
      yield* entity(key, 'company', name, 'nhtsa:mfr_id', String(mfr));
      if (typeof row.Mfr_CommonName === 'string' && row.Mfr_CommonName.trim()) {
        const alias = sourceText(row.Mfr_CommonName);
        yield {
          kind: 'domainAliases',
          record: {
            id: identity.record('domain_alias', key + ':common'),
            entityId: identity.entity(key),
            locale: 'en-US',
            normalizedAlias: alias.toLowerCase(),
            aliasKind: 'source_common_name',
            sourceRecordKey: 'alias:' + key,
          },
        };
      }
    } else if (spec.type === 'vpic-plants') {
      const code = sourceText(row.DOTCode, 3),
        name = sourceText(row.Name),
        status = sourceText(row.Status);
      if (
        !/^[A-Z0-9]{2,3}$/.test(code) ||
        !['Active', 'Closed'].includes(status) ||
        !(row.OldDotCode === null || typeof row.OldDotCode === 'string')
      )
        throw Error('Source schema');
      for (const key of ['Address', 'City', 'Country', 'StateProvince', 'PostalCode'])
        if (row[key] !== null && typeof row[key] !== 'string') throw Error('Source schema');
      // A code alone is not a universal historical plant identity.
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            code,
            name,
            row.Address,
            row.City,
            row.Country,
            row.StateProvince,
            row.PostalCode,
          ]),
        )
        .digest('hex');
      const key = `nhtsa:plant:${spec.equipmentType}:${fingerprint}`;
      yield* entity(key, 'plant', name, 'nhtsa:plant_record', fingerprint);
      for (const [value, historical] of [
        [code, false],
        [row.OldDotCode, true],
      ] as const) {
        if (!value) continue;
        if (typeof value !== 'string' || !/^[A-Z0-9]{2,3}$/.test(value))
          throw Error('Source schema');
        yield {
          kind: 'manufacturingPlantCodes',
          record: {
            id: identity.record('manufacturing_plant_code', key + ':' + value),
            plantEntityId: identity.entity(key),
            authority: 'NHTSA',
            equipmentType: String(spec.equipmentType),
            code: value,
            validFrom: null,
            validTo: null,
            sourceYear: spec.year,
            status: historical ? 'historical' : status === 'Active' ? 'active' : 'inactive',
            sourceRecordKey: key + ':code:' + value,
          },
        };
      }
    } else throw Error('Unsupported source');
  }
}
