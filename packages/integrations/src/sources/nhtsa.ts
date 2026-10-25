import { mkdtemp, open, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ok, fail, instant } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type {
  SourceAdapter,
  SourceSpec,
  SourceReceipt,
} from '../../../application/src/ports/sources.ts';
import { sourceKey } from '../../../application/src/services/source-policy.ts';
import { sourceIdentity, sourceUuid } from './identity.ts';
import { vpicEnvelope, vpicFacts, sourceObject } from './vpic.ts';
import { recallFacts } from './recalls.ts';
import { recallArchive } from './archive.ts';
import { createSourceHttp, SourceNetworkError } from './http.ts';
import { decodeImportFact, openImportSnapshot } from '../import-files.ts';
export function sourceLocation(spec: SourceSpec) {
  return spec.type === 'nhtsa-tire-recalls'
    ? { origin: 'https://static.nhtsa.gov', path: '/odi/ffdd/rcl/' }
    : { origin: 'https://vpic.nhtsa.dot.gov', path: '/api/vehicles/' };
}
function endpoint(spec: SourceSpec, page = 1) {
  const root = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
  switch (spec.type) {
    case 'vpic-models':
      return (
        root +
        `GetModelsForMakeIdYear/makeId/${spec.makeId}/modelyear/${spec.year}/vehicletype/${encodeURIComponent(spec.vehicleType)}?format=json`
      );
    case 'vpic-manufacturers':
      return root + `GetAllManufacturers?format=json&page=${page}`;
    case 'vpic-plants':
      return (
        root +
        `GetEquipmentPlantCodes?equipmentType=${spec.equipmentType}&format=json&reportType=all&year=${spec.year}`
      );
    case 'nhtsa-tire-recalls':
      throw Error('Source scope');
  }
}
export function createNhtsaAdapter(
  download = createSourceHttp(),
  dictionaryChecksum = '3438cc7e4131efa401dfe6437dbe035607e092c129155dfb411d459d58802203',
): SourceAdapter {
  return {
    async pull(lease) {
      const dir = await mkdtemp(join(tmpdir(), 'tt-source-')),
        cleanup = () => rm(dir, { recursive: true, force: true });
      const signal = AbortSignal.timeout(600000),
        validators: Record<string, SourceReceipt['validators'][string]> = {};
      try {
        const location = sourceLocation(lease.spec);
        if (lease.origin !== location.origin || lease.path !== location.path)
          throw Error('Source registry origin');
        const parts: string[] = [],
          hashes: string[] = [];
        let rows: unknown[] = [];
        if (lease.spec.type === 'nhtsa-tire-recalls') {
          const dictionary = await download(
            location.origin + location.path + 'RCL.txt',
            join(dir, 'RCL.txt'),
            16384,
            signal,
          );
          if (!dictionary.modified || dictionary.checksum !== dictionaryChecksum)
            throw Error('Source dictionary changed');
          const results = [];
          for (const part of ['PRE', 'POST'] as const) {
            const key = `FLAT_RCL_${part}_2010.zip`,
              path = join(dir, key),
              url = location.origin + location.path + key;
            const result = await download(
              url,
              path,
              67108864,
              signal,
              !lease.forceFull ? lease.previous?.validators[key] : undefined,
            );
            results.push({ part, key, path, url, result });
            validators[key] = result.validators;
          }
          if (results.every((x) => !x.result.modified)) {
            await cleanup();
            return ok({ changed: false, full: false, validators });
          }
          for (const item of results) {
            const result = item.result.modified
              ? item.result
              : await download(item.url, item.path, 67108864, signal);
            if (!result.modified) throw Error('Incomplete source');
            parts.push(item.path);
            hashes.push(result.checksum);
            validators[item.key] = result.validators;
          }
        } else {
          let previousPass: string | null = null;
          for (let pass = 0; pass < (lease.spec.type === 'vpic-manufacturers' ? 2 : 1); pass++) {
            rows = [];
            const passHashes: string[] = [];
            const keys = new Set<number>();
            let finished = false,
              totalBytes = 0;
            for (let page = 1; page <= 512; page++) {
              const path = join(dir, `page-${pass}-${page}.json`),
                result = await download(endpoint(lease.spec, page), path, 4194304, signal);
              if (!result.modified) throw Error('Incomplete source');
              totalBytes += result.bytes;
              if (totalBytes > 67108864) throw Error('Source byte bound');
              const pageRows = vpicEnvelope(
                JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))),
              );
              await unlink(path);
              passHashes.push(result.checksum);
              if (lease.spec.type === 'vpic-manufacturers')
                for (const row of pageRows) {
                  const mfr = sourceObject(row).Mfr_ID;
                  if (typeof mfr !== 'number' || keys.has(mfr))
                    throw Error('Duplicate manufacturer page');
                  keys.add(mfr);
                }
              rows.push(...pageRows);
              if (rows.length > 50000) throw Error('Source row bound');
              if (lease.spec.type !== 'vpic-manufacturers' || pageRows.length < 100) {
                finished = true;
                break;
              }
              if (pageRows.length !== 100) throw Error('Source pagination');
            }
            if (!finished || !rows.length) throw Error('Source coverage');
            const passHash = createHash('sha256').update(JSON.stringify(passHashes)).digest('hex');
            if (previousPass && previousPass !== passHash)
              throw Error('Unstable source pagination');
            previousPass = passHash;
          }
          hashes.push(previousPass!);
        }
        const checksum = createHash('sha256')
          .update(JSON.stringify([lease.spec, hashes, 'mapping-v1-rcl-29']))
          .digest('hex');
        if (checksum === lease.previous?.checksum) {
          await cleanup();
          return ok({ changed: false, full: true, validators });
        }
        const datasetId = sourceUuid(
            'dataset',
            [lease.providerId, lease.licenseId, sourceKey(lease.spec), checksum].join(':'),
          ),
          identity = sourceIdentity(datasetId),
          dataPath = join(dir, 'normalized.jsonl'),
          file = await open(dataPath, 'wx', 0o600),
          hash = createHash('sha256');
        let count = 0,
          bytes = 0;
        async function* lines() {
          for (let n = 0; n < parts.length; n++)
            yield* recallArchive(parts[n]!, n === 0 ? 'PRE' : 'POST', signal);
        }
        const facts =
          lease.spec.type === 'nhtsa-tire-recalls'
            ? recallFacts(lines(), identity)
            : vpicFacts(lease.spec, rows, identity);
        try {
          for await (const fact of facts) {
            signal.throwIfAborted();
            const checked = decodeImportFact(fact);
            if (!checked.ok) throw Error('Normalized source schema');
            const line = Buffer.from(
              JSON.stringify(fact, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n',
            );
            if (line.length > 16385 || ++count > 100000 || (bytes += line.length) > 20971520)
              throw Error('Normalized source bound');
            hash.update(line);
            await file.writeFile(line);
          }
        } finally {
          await file.close();
        }
        if (!count) throw Error('Source coverage');
        const stamp = instant(new Date().toISOString());
        if (!stamp.ok) throw Error('Source clock');
        const metadata = {
          id: datasetId,
          providerId: lease.providerId,
          licenseId: lease.licenseId,
          kind: sourceKey(lease.spec),
          externalVersion: checksum,
          checksum: hash.digest('hex'),
          effectiveAt: stamp.value,
          fetchedAt: stamp.value,
          upstreamRunKey: sourceKey(lease.spec) + ':' + checksum,
          schemaVersion: '1',
          mappingVersion: '1',
          semantics: 'complete_snapshot',
          expectedRows: count,
          expectedBytes: bytes,
        };
        const manifest = join(dir, 'manifest.json'),
          out = await open(manifest, 'wx', 0o600);
        try {
          await out.writeFile(JSON.stringify(metadata));
        } finally {
          await out.close();
        }
        return ok({
          changed: true,
          checksum,
          snapshot: await openImportSnapshot(manifest, dataPath),
          validators,
          cleanup,
        });
      } catch (error) {
        await cleanup();
        return fail(failure(error instanceof SourceNetworkError ? 'unavailable' : 'integrity'));
      }
    },
  };
}
