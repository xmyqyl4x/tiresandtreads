import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import {
  decodeImportFact,
  parseImportManifest,
  openImportSnapshot,
} from '../../packages/integrations/src/import-files.ts';
import {
  parseHead,
  parseImportPlan,
  runImportCommand,
} from '../../packages/integrations/src/import-commands.ts';
import { createImportRuntime } from '../../packages/integrations/src/import-runtime.ts';
import type { createImportService } from '../../packages/application/src/services/ingestion.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-10-24T00:00:00.000Z';
const manifest = {
  id: uuid,
  providerId: uuid,
  licenseId: uuid,
  kind: 'catalog',
  externalVersion: '1',
  checksum: 'a'.repeat(64),
  effectiveAt: stamp,
  fetchedAt: stamp,
  upstreamRunKey: '1',
  schemaVersion: '1',
  mappingVersion: '1',
  semantics: 'complete_snapshot',
  expectedRows: 0,
  expectedBytes: 0,
};
it('strictly decodes versioned metadata and rejects incremental, extra fields and invalid identities', () => {
  expect(parseImportManifest(manifest)).toEqual(manifest);
  for (const x of [
    null,
    [],
    { ...manifest, extra: true },
    { ...manifest, id: 'bad' },
    { ...manifest, semantics: 'incremental' },
    { ...manifest, expectedRows: 100001 },
    { ...manifest, kind: '' },
    { ...manifest, checksum: 'bad' },
  ])
    expect(() => parseImportManifest(x)).toThrow();
});
it('decodes typed facts and rejects unknown kinds, fields, missing values and unsafe URLs', () => {
  const fact = {
    kind: 'tireModels',
    record: {
      id: uuid,
      brand: 'Synthetic',
      model: 'Test',
      category: 'touring',
      seasonalClass: 'all_season',
      sourceRecordKey: 'model',
    },
  };
  expect(decodeImportFact(fact).ok).toBe(true);
  for (const x of [
    null,
    [],
    {},
    { ...fact, kind: 'sql' },
    { ...fact, extra: 1 },
    { ...fact, record: [] },
    { ...fact, record: { ...fact.record, model: 1 } },
    { ...fact, record: { ...fact.record, extra: 1 } },
    {
      kind: 'adviceFactSources',
      record: {
        id: uuid,
        factId: uuid,
        sourceUrl: 'http://invalid.test',
        providerId: uuid,
        licenseId: uuid,
        locator: null,
        retrievedAt: stamp,
        contentHash: 'a'.repeat(64),
      },
    },
  ])
    expect(decodeImportFact(x).ok).toBe(false);
});
it('requires exact UTF-8 bytes, newline framing, checksum and row counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-import-'));
  const data = join(dir, 'data.jsonl'),
    meta = join(dir, 'manifest.json');
  async function read(bytes: Buffer, overrides = {}) {
    await writeFile(data, bytes);
    await writeFile(
      meta,
      JSON.stringify({
        ...manifest,
        expectedRows: 1,
        expectedBytes: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        ...overrides,
      }),
    );
    const source = await openImportSnapshot(meta, data);
    const frames = [];
    for await (const frame of source.frames()) frames.push(frame);
    return frames;
  }
  try {
    expect(await read(Buffer.from('{}\n'))).toEqual([{ row: {} }, { end: true }]);
    for (const bytes of [
      Buffer.from('{}'),
      Buffer.from('\n'),
      Buffer.from('\uFEFF{}\n'),
      Buffer.from([0xff, 10]),
      Buffer.from(' '.repeat(16385) + '\n'),
    ])
      await expect(read(bytes)).rejects.toThrow();
    await expect(read(Buffer.from('{}\n'), { checksum: 'b'.repeat(64) })).rejects.toThrow();
    await expect(read(Buffer.from('{}\n'), { expectedBytes: 9 })).rejects.toThrow();
    await expect(read(Buffer.from('{}\n'), { expectedRows: 0 })).rejects.toThrow();
    await expect(read(Buffer.from('{}\n'), { expectedRows: 2 })).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('validates command plans, expected revisions and the fixed command allowlist', async () => {
  const base = {
    bundleId: uuid,
    market: 'US',
    actorId: uuid,
    approvalId: uuid,
    expectedHead: { bundleId: uuid, revision: '1' },
  };
  expect(parseImportPlan(base, true).expectedHead?.revision).toBe(1n);
  expect(
    parseImportPlan(
      { ...base, runId: uuid, members: [{ key: 'catalog', kind: 'catalog', datasetId: uuid }] },
      false,
    ),
  ).toHaveProperty('runId', uuid);
  for (const x of [
    null,
    {},
    { ...base, expectedHead: null },
    { ...base, market: 'us' },
    { ...base, extra: 1 },
  ])
    expect(() => parseImportPlan(x, true)).toThrow();
  for (const x of [
    undefined,
    {},
    { bundleId: uuid, revision: '0' },
    { bundleId: 'bad', revision: '1' },
  ])
    expect(() => parseHead(x)).toThrow();
  const service = {} as ReturnType<typeof createImportService>;
  for (const args of [
    [],
    ['fetch'],
    ['status', '--run', 'bad'],
    ['status', '--sql', 'x'],
    ['diff', '--run', uuid, '--run', uuid],
    ['diff', '--run', uuid, '--against', 'bad'],
  ])
    await expect(runImportCommand(args, service)).rejects.toThrow();
});
it('rejects missing, privileged, mismatched or unbounded runtime configuration before connecting', async () => {
  for (const env of [
    {},
    {
      INGEST_DATABASE_URL: 'postgres://postgres:secret@localhost/db',
      PUBLISH_DATABASE_URL: 'postgres://postgres:secret@localhost/db',
    },
    {
      INGEST_DATABASE_URL: 'postgres://tt_ingest_runtime:secret@localhost/a',
      PUBLISH_DATABASE_URL: 'postgres://tt_publish_runtime:secret@localhost/b',
    },
    {
      INGEST_DATABASE_URL: 'postgres://tt_ingest_runtime:secret@localhost/a',
      PUBLISH_DATABASE_URL: 'postgres://tt_publish_runtime:secret@localhost/a',
      IMPORT_DB_RESERVE: '1',
    },
  ])
    await expect(createImportRuntime(env)).rejects.toThrow();
});
