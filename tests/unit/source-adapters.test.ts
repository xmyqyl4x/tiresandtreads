import { it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fixtureServer } from '../setup.ts';
import { recallLine, zipFixture } from '../fixtures/sources/zip.ts';
import { recallArchive } from '../../packages/integrations/src/sources/archive.ts';
import { recallFacts } from '../../packages/integrations/src/sources/recalls.ts';
import { sourceIdentity, sourceUuid } from '../../packages/integrations/src/sources/identity.ts';
import {
  createNhtsaAdapter,
  sourceLocation,
} from '../../packages/integrations/src/sources/nhtsa.ts';
import {
  createSourceHttp,
  SourceNetworkError,
} from '../../packages/integrations/src/sources/http.ts';
import { vpicFacts, vpicEnvelope } from '../../packages/integrations/src/sources/vpic.ts';
import type { SourceLease, SourceSpec } from '../../packages/application/src/ports/sources.ts';
import { probeSource } from '../../packages/integrations/src/sources/probe.ts';
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
async function collect<T>(input: AsyncIterable<T> | Iterable<T>) {
  const rows: T[] = [];
  for await (const row of input) rows.push(row);
  return rows;
}
const identity = sourceIdentity('test');
export function sourceLease(spec: SourceSpec): SourceLease {
  return {
    id: sourceUuid('source_connector', 'test'),
    providerId: sourceUuid('provider', 'test'),
    licenseId: sourceUuid('license', 'test'),
    token: sourceUuid('lease', 'test'),
    fence: 1n,
    forceFull: true,
    previous: null,
    spec,
    ...sourceLocation(spec),
  };
}
it('retains unresolved recalls, missing narratives, dates, exact counts and advisory unknowns', async () => {
  const facts = await collect(
    recallFacts(
      (async function* () {
        yield recallLine({ 19: '' }).replace(/\n$/, '');
        yield recallLine({ 0: '2', 27: 'No', 28: 'Yes', 19: '' }).replace(/\n$/, '');
      })(),
      identity,
    ),
  );
  expect(facts).toHaveLength(3);
  expect(facts[0]).toMatchObject({
    kind: 'recalls',
    record: {
      summary: null,
      affectedCount: 100n,
      status: 'reported',
      announcedOn: null,
      reportReceivedOn: '2026-10-01',
    },
  });
  expect(facts[1]).toMatchObject({
    kind: 'recallSourceTargets',
    record: {
      matchStatus: 'unresolved',
      doNotDrive: true,
      parkOutside: null,
      dotPattern: null,
      sizeText: null,
    },
  });
  expect(facts[2]).toMatchObject({ record: { doNotDrive: false, parkOutside: true } });
});
it('rejects truncated schemas, duplicate targets, conflicting campaigns and invalid safety values', async () => {
  for (const rows of [
    ['bad'],
    [recallLine(), recallLine()],
    [recallLine(), recallLine({ 0: '2', 19: 'different' })],
    [recallLine({ 27: 'maybe' })],
    [recallLine({ 15: '20260230' })],
    [recallLine({ 8: '20250101', 9: '20240101' })],
    [recallLine({ 11: '-1' })],
    [recallLine({ 10: 'Z' })],
    [recallLine({ 10: 'V' })],
  ])
    await expect(
      collect(
        recallFacts(
          (async function* () {
            for (const row of rows) yield row.replace(/\n$/, '');
          })(),
          identity,
        ),
      ),
    ).rejects.toThrow();
});
it('streams only the expected ZIP entry and verifies CRC, paths, ratio, framing and UTF-8', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-archive-')),
    path = join(dir, 'test.zip');
  try {
    await writeFile(path, zipFixture('FLAT_RCL_PRE_2010.txt', recallLine()));
    expect(await collect(recallArchive(path, 'PRE', AbortSignal.timeout(1000)))).toEqual([
      recallLine().replace(/\n$/, ''),
    ]);
    for (const bytes of [
      zipFixture('../escape.txt', recallLine()),
      zipFixture('wrong.txt', recallLine()),
      zipFixture('FLAT_RCL_PRE_2010.txt', recallLine(), { crc: 1 }),
      zipFixture('FLAT_RCL_PRE_2010.txt', recallLine(), { external: 0xa1ff0000 }),
      zipFixture('FLAT_RCL_PRE_2010.txt', 'x'.repeat(100000) + '\n'),
      zipFixture('FLAT_RCL_PRE_2010.txt', 'partial'),
      zipFixture('FLAT_RCL_PRE_2010.txt', recallLine(), { count: 2 }),
    ]) {
      await writeFile(path, bytes);
      await expect(
        collect(recallArchive(path, 'PRE', AbortSignal.timeout(1000))),
      ).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('maps manufacturer and plant identities conservatively and keeps old DOT codes historical', () => {
  const mfr = [
    ...vpicFacts(
      { type: 'vpic-manufacturers' },
      [
        {
          Mfr_ID: 1,
          Mfr_Name: 'Synthetic Company',
          Mfr_CommonName: 'Synthetic',
          Country: 'Unknown',
          VehicleTypes: [],
        },
      ],
      identity,
    ),
  ];
  expect(mfr).toHaveLength(3);
  expect(mfr[0]).toMatchObject({ record: { countryCode: null } });
  const plant = {
    DOTCode: '1AB',
    Name: 'Synthetic Plant',
    OldDotCode: 'AB',
    Status: 'Closed',
    Address: null,
    City: null,
    Country: null,
    StateProvince: null,
    PostalCode: null,
  };
  const facts = [
    ...vpicFacts({ type: 'vpic-plants', year: 2024, equipmentType: 1 }, [plant], identity),
  ];
  expect(
    facts.filter((f) => f.kind === 'manufacturingPlantCodes').map((f) => f.record.status),
  ).toEqual(['inactive', 'historical']);
  expect(() => [
    ...vpicFacts(
      { type: 'vpic-plants', year: 2024, equipmentType: 16 },
      [{ ...plant, Status: 'Unknown' }],
      identity,
    ),
  ]).toThrow();
  expect(() =>
    vpicEnvelope({ Count: 2, Message: 'Results returned successfully', Results: [] }),
  ).toThrow();
});
it('uses bounded, allowlisted HTTP with retry-after and rejects redirects/unbased 304s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-http-')),
    url = 'https://static.nhtsa.gov/test.zip',
    wait = vi.fn(async () => {});
  let calls = 0;
  try {
    fixtureServer.use(
      http.get(url, () =>
        ++calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } })
          : new HttpResponse('payload', { headers: { etag: '"v1"' } }),
      ),
    );
    const result = await createSourceHttp(wait)(
      url,
      join(dir, 'ok'),
      32,
      AbortSignal.timeout(1000),
    );
    expect(result.modified && result.checksum).toBe(hash('payload'));
    expect(wait).toHaveBeenCalled();
    expect(await readFile(join(dir, 'ok'), 'utf8')).toBe('payload');
    fixtureServer.use(http.get(url, () => new HttpResponse(null, { status: 304 })));
    await expect(
      createSourceHttp(wait)(url, join(dir, 'none'), 32, AbortSignal.timeout(1000)),
    ).rejects.toThrow();
    expect(
      await createSourceHttp(wait)(url, join(dir, 'none'), 32, AbortSignal.timeout(1000), {
        etag: '"v1"',
        modified: null,
      }),
    ).toMatchObject({ modified: false });
    fixtureServer.use(
      http.get(
        url,
        () => new HttpResponse(null, { status: 503, headers: { 'Retry-After': '60' } }),
      ),
    );
    await expect(
      createSourceHttp(wait)(url, join(dir, 'none'), 32, AbortSignal.timeout(1000)),
    ).rejects.toBeInstanceOf(SourceNetworkError);
    await expect(
      createSourceHttp(wait)(
        'https://evil.test/feed',
        join(dir, 'none'),
        32,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
    fixtureServer.use(
      http.get(url, () => new HttpResponse('long', { headers: { 'Content-Length': '4' } })),
    );
    await expect(
      createSourceHttp(wait)(url, join(dir, 'large'), 2, AbortSignal.timeout(1000)),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('checks all manufacturer pages twice and rejects duplicate or unstable pagination', async () => {
  const spec = { type: 'vpic-manufacturers' } as const,
    wait = async () => {};
  fixtureServer.use(
    http.get('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllManufacturers', () =>
      HttpResponse.json({
        Count: 1,
        Message: 'Results returned successfully',
        Results: [
          {
            Mfr_ID: 1,
            Mfr_Name: 'Synthetic Company',
            Mfr_CommonName: null,
            Country: null,
            VehicleTypes: [],
          },
        ],
      }),
    ),
  );
  const r = await createNhtsaAdapter(createSourceHttp(wait)).pull(sourceLease(spec));
  expect(r.ok).toBe(true);
  if (r.ok && r.value.changed) {
    try {
      expect((await collect(r.value.snapshot.frames())).length).toBe(3);
    } finally {
      await r.value.cleanup();
    }
  }
  let n = 0;
  fixtureServer.use(
    http.get('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllManufacturers', () =>
      HttpResponse.json({
        Count: 1,
        Message: 'Results returned successfully',
        Results: [
          {
            Mfr_ID: ++n,
            Mfr_Name: 'Changed',
            Mfr_CommonName: null,
            Country: null,
            VehicleTypes: [],
          },
        ],
      }),
    ),
  );
  expect(await createNhtsaAdapter(createSourceHttp(wait)).pull(sourceLease(spec))).toMatchObject({
    ok: false,
    error: { code: 'integrity' },
  });
});
it('requires both recall archives and the reviewed dictionary; a new download cannot reuse a missing 304 archive', async () => {
  const dictionary = 'synthetic 29-field dictionary',
    digest = hash(dictionary),
    base = 'https://static.nhtsa.gov/odi/ffdd/rcl/';
  let mode = 'full';
  fixtureServer.use(
    http.get(base + 'RCL.txt', () => new HttpResponse(dictionary)),
    http.get(base + 'FLAT_RCL_PRE_2010.zip', () =>
      mode === 'full'
        ? new HttpResponse(zipFixture('FLAT_RCL_PRE_2010.txt', recallLine()))
        : new HttpResponse(null, { status: 304 }),
    ),
    http.get(base + 'FLAT_RCL_POST_2010.zip', () =>
      mode === 'none'
        ? new HttpResponse(null, { status: 304 })
        : new HttpResponse(zipFixture('FLAT_RCL_POST_2010.txt', recallLine({ 0: '2' }))),
    ),
  );
  const adapter = createNhtsaAdapter(
      createSourceHttp(async () => {}),
      digest,
    ),
    lease = sourceLease({ type: 'nhtsa-tire-recalls' }),
    r = await adapter.pull(lease);
  expect(r.ok).toBe(true);
  if (!r.ok || !r.value.changed) return;
  const receipt = {
    checksum: r.value.checksum,
    datasetId: r.value.snapshot.registration.id,
    runId: sourceUuid('import_run', 'test'),
    validators: {
      'FLAT_RCL_PRE_2010.zip': { etag: '"pre"', modified: null },
      'FLAT_RCL_POST_2010.zip': { etag: '"post"', modified: null },
    },
  };
  await r.value.cleanup();
  mode = 'none';
  expect(await adapter.pull({ ...lease, forceFull: false, previous: receipt })).toMatchObject({
    ok: true,
    value: { changed: false, full: false },
  });
  mode = 'mixed';
  expect(await adapter.pull({ ...lease, forceFull: false, previous: receipt })).toMatchObject({
    ok: false,
  });
  expect(
    await createNhtsaAdapter(
      createSourceHttp(async () => {}),
      '0'.repeat(64),
    ).pull(lease),
  ).toMatchObject({ ok: false });
});
it('supports exact model and plant scopes and recognizes full-body no-change checks', async () => {
  const modelSpec = {
    type: 'vpic-models',
    makeId: 474,
    year: 2024,
    vehicleType: 'passenger car',
  } as const;
  const plantSpec = { type: 'vpic-plants', year: 2024, equipmentType: 1 } as const;
  fixtureServer.use(
    http.get(
      'https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeIdYear/makeId/474/modelyear/2024/vehicletype/passenger%20car',
      () =>
        HttpResponse.json({
          Count: 1,
          Message: 'Results returned successfully',
          Results: [
            {
              Make_ID: 474,
              Make_Name: 'Synthetic',
              Model_ID: 1,
              Model_Name: 'Test',
              VehicleTypeId: 2,
              VehicleTypeName: 'Passenger Car',
            },
          ],
        }),
    ),
    http.get('https://vpic.nhtsa.dot.gov/api/vehicles/GetEquipmentPlantCodes', () =>
      HttpResponse.json({
        Count: 1,
        Message: 'Results returned successfully',
        Results: [
          {
            DOTCode: '1AB',
            Name: 'Synthetic',
            OldDotCode: '',
            Status: 'Active',
            Address: null,
            City: null,
            Country: null,
            StateProvince: null,
            PostalCode: null,
          },
        ],
      }),
    ),
  );
  for (const spec of [modelSpec, plantSpec]) {
    const adapter = createNhtsaAdapter(createSourceHttp(async () => {})),
      lease = sourceLease(spec),
      r = await adapter.pull(lease);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.changed) {
      const value = r.value;
      await value.cleanup();
      expect(
        await adapter.pull({
          ...lease,
          previous: {
            checksum: value.checksum,
            datasetId: value.snapshot.registration.id,
            runId: sourceUuid('import_run', 'test'),
            validators: {},
          },
        }),
      ).toMatchObject({ ok: true, value: { changed: false, full: true } });
    }
  }
});
it('offers a read-only compatibility probe that reports scalar counts and cleans private snapshots', async () => {
  fixtureServer.use(
    http.get('https://vpic.nhtsa.dot.gov/api/vehicles/GetAllManufacturers', () =>
      HttpResponse.json({
        Count: 1,
        Message: 'Results returned successfully',
        Results: [
          {
            Mfr_ID: 1,
            Mfr_Name: 'Synthetic',
            Mfr_CommonName: null,
            Country: null,
            VehicleTypes: [],
          },
        ],
      }),
    ),
  );
  const result = await probeSource(
    { type: 'vpic-manufacturers' },
    createNhtsaAdapter(createSourceHttp(async () => {})),
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      rows: 2,
      families: { domainEntityVersions: 1, domainIdentifiers: 1 },
      unknownSummaries: 0,
    },
  });
  expect(result.ok && result.value.scope).toContain('no database import');
});
