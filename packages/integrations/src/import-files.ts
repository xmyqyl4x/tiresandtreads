import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { id, instant, ok, fail } from '../../domain/src/values/core.ts';
import { failure } from '../../application/src/ports/transactions.ts';
import type {
  FactDecoder,
  ImportFact,
  ImportSnapshot,
  Registration,
} from '../../application/src/ports/import-service.ts';
import { spec, value, encode } from '../../db/src/repositories/codec.ts';
import { facts } from '../../db/src/repositories/facts.ts';
import type { FactKind } from '../../application/src/ports/catalog-records.ts';

export const decodeImportFact: FactDecoder = (input) => {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error();
    const row = input as Record<string, unknown>;
    if (
      !['kind,record', 'identities,kind,record'].includes(Object.keys(row).sort().join(',')) ||
      typeof row.kind !== 'string' ||
      !Object.hasOwn(facts, row.kind) ||
      !row.record ||
      typeof row.record !== 'object' ||
      Array.isArray(row.record)
    )
      throw Error();
    const kind = row.kind as FactKind,
      fields = spec(kind).fields;
    const raw = row.record as Record<string, unknown>;
    if (Object.keys(raw).sort().join(',') !== Object.keys(fields).sort().join(',')) throw Error();
    const record = Object.fromEntries(
      Object.entries(fields).map(([key, field]) => {
        const v = value(field, raw[key], true);
        if (
          /Url$/.test(key) &&
          v !== null &&
          (typeof v !== 'string' ||
            !/^https:\/\//.test(v) ||
            new URL(v).username ||
            new URL(v).password)
        )
          throw Error();
        return [key, v];
      }),
    );
    // Every field was decoded against the exhaustive, typed storage contract.
    let identities:
      | Parameters<
          import('../../application/src/ports/ingestion.ts').IngestionRepository['entity']
        >[1][]
      | undefined;
    if (Object.hasOwn(row, 'identities')) {
      if (!Array.isArray(row.identities) || row.identities.length < 1 || row.identities.length > 4)
        throw Error();
      identities = row.identities.map((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          Object.keys(item).sort().join(',') !== 'id,kind,stableKey'
        )
          throw Error();
        const entity = id('domain_entity', item.id);
        if (
          !entity.ok ||
          !['company', 'brand', 'plant', 'vehicle_make', 'vehicle_model'].includes(item.kind) ||
          typeof item.stableKey !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(item.stableKey)
        )
          throw Error();
        return { id: entity.value, kind: item.kind, stableKey: item.stableKey };
      });
    }
    const fact = { kind, record, ...(identities ? { identities } : {}) } as unknown as ImportFact;
    encode(kind, fact.record);
    return ok(fact);
  } catch {
    return fail(failure('invalid_input'));
  }
};

export function parseImportManifest(
  input: unknown,
): Registration & { readonly expectedBytes: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid import manifest');
  const x = input as Record<string, unknown>;
  const keys = [
    'id',
    'providerId',
    'licenseId',
    'kind',
    'externalVersion',
    'checksum',
    'effectiveAt',
    'fetchedAt',
    'upstreamRunKey',
    'schemaVersion',
    'mappingVersion',
    'semantics',
    'expectedRows',
    'expectedBytes',
  ];
  if (
    Object.keys(x).sort().join(',') !== keys.sort().join(',') ||
    !id('dataset', x.id).ok ||
    !id('provider', x.providerId).ok ||
    !id('license', x.licenseId).ok ||
    !instant(x.effectiveAt).ok ||
    !instant(x.fetchedAt).ok ||
    x.schemaVersion !== '1' ||
    x.mappingVersion !== '1' ||
    x.semantics !== 'complete_snapshot' ||
    typeof x.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(x.checksum)
  )
    throw Error('Invalid import manifest');
  for (const [key, max] of [
    ['kind', 80],
    ['externalVersion', 200],
    ['upstreamRunKey', 200],
  ] as const)
    if (
      typeof x[key] !== 'string' ||
      x[key].length < 1 ||
      x[key].length > max ||
      (x[key] as string).includes('\0')
    )
      throw Error('Invalid import manifest');
  if (
    !Number.isSafeInteger(x.expectedRows) ||
    (x.expectedRows as number) < 0 ||
    (x.expectedRows as number) > 100000 ||
    !Number.isSafeInteger(x.expectedBytes) ||
    (x.expectedBytes as number) < 0 ||
    (x.expectedBytes as number) > 20 * 1024 * 1024
  )
    throw Error('Invalid import manifest');
  return Object.freeze(x) as unknown as Registration & { readonly expectedBytes: number };
}

export async function openImportSnapshot(
  manifestPath: string,
  dataPath: string,
): Promise<ImportSnapshot> {
  const info = await stat(manifestPath);
  if (!info.isFile() || info.size > 16384) throw Error('Invalid import manifest');
  const manifest = parseImportManifest(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(manifestPath))),
  );
  return {
    registration: manifest,
    async *frames() {
      const sourceInfo = await stat(dataPath);
      if (!sourceInfo.isFile() || sourceInfo.size !== manifest.expectedBytes)
        throw Error('Import byte count mismatch');
      const stream = createReadStream(dataPath, { highWaterMark: 16384 });
      const hash = createHash('sha256');
      let pending = Buffer.alloc(0),
        bytes = 0,
        rows = 0;
      try {
        for await (const chunk of stream) {
          const b = Buffer.from(chunk);
          bytes += b.length;
          if (bytes > manifest.expectedBytes) throw Error('Import byte count mismatch');
          hash.update(b);
          pending = Buffer.concat([pending, b]);
          let newline: number;
          while ((newline = pending.indexOf(10)) !== -1) {
            if (newline > 16384 || ++rows > manifest.expectedRows) throw Error('Import row limit');
            const line = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
              pending.subarray(0, newline),
            );
            if (!line.trim() || line.charCodeAt(0) === 0xfeff) throw Error('Invalid import row');
            yield { row: JSON.parse(line) };
            pending = pending.subarray(newline + 1);
          }
          if (pending.length > 16384) throw Error('Import row limit');
        }
        if (
          pending.length ||
          rows !== manifest.expectedRows ||
          bytes !== manifest.expectedBytes ||
          hash.digest('hex') !== manifest.checksum
        )
          throw Error('Incomplete or changed import snapshot');
        yield { end: true };
      } finally {
        stream.destroy();
      }
    },
  };
}
