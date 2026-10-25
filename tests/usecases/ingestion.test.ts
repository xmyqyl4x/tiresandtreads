import { expect, it, vi } from 'vitest';
import { createImportService } from '../../packages/application/src/services/ingestion.ts';
import { fail, ok } from '../../packages/domain/src/values/core.ts';
import {
  failure,
  type UnitOfWork,
  type TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';
import type {
  IngestionRepository,
  PublicationRepository,
  RunState,
} from '../../packages/application/src/ports/ingestion.ts';
import type {
  ImportOperations,
  Registration,
  ImportFact,
  FactDecoder,
} from '../../packages/application/src/ports/import-service.ts';

const tx = {} as TransactionContext;
const registration = { expectedRows: 0, semantics: 'complete_snapshot' } as Registration;
function fixture() {
  const state = {
    id: 'run',
    fence: 1n,
    throughRow: 0n,
    accepted: 0n,
    rejected: 0n,
    status: 'registered',
  } as RunState;
  const ingest = {
    dataset: vi.fn(),
    register: vi.fn(async () => state),
    lease: vi.fn(async () => state),
    batch: vi.fn(async (_tx, _lease, rows) => {
      staged = rows;
      return state;
    }),
    staged: vi.fn(async () => staged),
    append: vi.fn(),
  } as unknown as IngestionRepository;
  let staged: Parameters<IngestionRepository['batch']>[2] = [];
  const publish = { validate: vi.fn() } as unknown as PublicationRepository;
  const operations = {
    release: vi.fn(),
    status: vi.fn(async () => state),
    renew: vi.fn(),
  } as unknown as ImportOperations;
  const uow: UnitOfWork = {
    run: async (work) => {
      try {
        return await work(tx);
      } catch {
        return fail(failure('conflict'));
      }
    },
  };
  const decode = vi.fn<FactDecoder>(() => fail(failure('invalid_input')));
  const service = createImportService({
    ingest,
    publish,
    operations,
    publicationOperations: operations,
    ingestUow: uow,
    publishUow: uow,
    publisher: ingest,
    decode,
    expires: vi.fn(),
  });
  return { service, publish, operations, ingest, uow, decode, state };
}
it('refuses truncated snapshots and releases the fenced lease without validation', async () => {
  const f = fixture();
  const r = await f.service.prepare({ registration, frames: async function* () {} });
  expect(r).toEqual(fail(failure('integrity')));
  expect(f.publish.validate).not.toHaveBeenCalled();
  expect(f.operations.release).toHaveBeenCalledWith(tx, 'run', 1n);
});
it('rejects unsupported counts/semantics before registration and never steals an active lease', async () => {
  for (const expectedRows of [-1, 100001, NaN]) {
    const f = fixture();
    expect(
      (
        await f.service.prepare({
          registration: { ...registration, expectedRows },
          frames: async function* () {},
        })
      ).ok,
    ).toBe(false);
    expect(f.ingest.register).not.toHaveBeenCalled();
  }
  const f = fixture();
  vi.spyOn(f.uow, 'run').mockResolvedValueOnce(fail(failure('unavailable')));
  expect(await f.service.prepare({ registration, frames: async function* () {} })).toMatchObject({
    error: { code: 'unavailable' },
  });
  const g = fixture();
  vi.mocked(g.ingest.lease).mockRejectedValueOnce(Error('busy'));
  expect(await g.service.prepare({ registration, frames: async function* () {} })).toMatchObject({
    error: { code: 'conflict' },
  });
  expect(g.operations.release).not.toHaveBeenCalled();
});
it('requires one terminal marker and the exact declared number of rows', async () => {
  for (const frames of [
    async function* () {
      yield { end: true as const };
      yield { end: true as const };
    },
    async function* () {
      yield { row: {} };
    },
  ]) {
    const f = fixture();
    expect((await f.service.prepare({ registration, frames })).ok).toBe(false);
    expect(f.publish.validate).not.toHaveBeenCalled();
  }
  const f = fixture();
  expect(
    (
      await f.service.prepare({
        registration: { ...registration, expectedRows: 1 },
        frames: async function* () {
          yield { end: true };
        },
      })
    ).ok,
  ).toBe(false);
});
it('stops at SQL batch failure and still releases its own fence, for full and partial batches', async () => {
  for (const size of [1, 25]) {
    const f = fixture();
    vi.mocked(f.ingest.batch).mockRejectedValueOnce(Error('write conflict'));
    const r = await f.service.prepare({
      registration: { ...registration, expectedRows: size },
      frames: async function* () {
        for (let n = 0; n < size; n++) yield { row: {} };
        yield { end: true };
      },
    });
    expect(r).toMatchObject({ error: { code: 'conflict' } });
    expect(f.publish.validate).not.toHaveBeenCalled();
    expect(f.operations.release).toHaveBeenCalled();
  }
});
it('returns validation failures and handles parser outages without leaking source errors', async () => {
  const f = fixture();
  vi.mocked(f.publish.validate).mockRejectedValueOnce(Error('critical reject'));
  expect(
    await f.service.prepare({
      registration,
      frames: async function* () {
        yield { end: true };
      },
    }),
  ).toMatchObject({ error: { code: 'conflict' } });
  const g = fixture();
  expect(
    await g.service.prepare({
      registration,
      frames: async function* () {
        yield { end: true };
        throw Error('private source');
      },
    }),
  ).toEqual(fail(failure('invalid_input')));
});
it('normalizes child-row identity and exact bigint values while preserving kind ordering', async () => {
  const f = fixture();
  const uuid = '11111111-1111-4111-8111-111111111111';
  f.decode.mockImplementation((row) => ok(row as ImportFact));
  const record = {
    id: uuid,
    priceId: uuid,
    kind: 'shipping',
    basis: 'per_tire',
    amountKind: 'fixed',
    lowMinor: 1n,
    highMinor: null,
    rate: null,
    included: false,
    sourceNote: null,
  };
  const rows = [
    { kind: 'priceComponents', record },
    {
      kind: 'tireModels',
      record: {
        id: uuid,
        brand: 'Synthetic',
        model: 'Test',
        category: 'touring',
        seasonalClass: 'all_season',
        sourceRecordKey: 'model',
      },
    },
  ];
  expect(
    (
      await f.service.prepare({
        registration: { ...registration, expectedRows: 2 },
        frames: async function* () {
          for (const row of rows) yield { row };
          yield { end: true };
        },
      })
    ).ok,
  ).toBe(true);
  expect(f.ingest.append).toHaveBeenCalledTimes(2);
  expect(vi.mocked(f.ingest.batch).mock.calls[0]![2][0]!.normalized).toMatchObject({
    record: { lowMinor: '1' },
  });
});
it('splits wide normalized records before the SQL payload bound while retaining exact checkpoints', async () => {
  const f = fixture();
  f.decode.mockImplementation((row) => ok(row as ImportFact));
  const rows = Array.from({ length: 20 }, (_, n) => ({
    kind: 'tireModels',
    record: {
      id: '11111111-1111-4111-8111-111111111111',
      brand: 'Synthetic',
      model: 'x'.repeat(11000),
      category: 'touring',
      seasonalClass: 'all_season',
      sourceRecordKey: 'wide-' + n,
    },
  }));
  expect(
    (
      await f.service.prepare({
        registration: { ...registration, expectedRows: rows.length },
        frames: async function* () {
          for (const row of rows) yield { row };
          yield { end: true };
        },
      })
    ).ok,
  ).toBe(true);
  expect(f.ingest.batch).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(f.ingest.batch).mock.calls;
  expect(calls.flatMap((c) => c[2]).map((r) => r.rowNumber)).toEqual(
    Array.from({ length: 20 }, (_, n) => BigInt(n + 1)),
  );
});
it('validates a verified empty complete snapshot, never publishing during dry-run', async () => {
  const f = fixture();
  expect(
    (
      await f.service.prepare({
        registration,
        frames: async function* () {
          yield { end: true };
        },
      })
    ).ok,
  ).toBe(true);
  expect(f.publish.validate).toHaveBeenCalledWith(tx, { runId: 'run', fence: 1n }, 0n, true);
});
