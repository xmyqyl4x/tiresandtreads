import { it, expect } from 'vitest';
import { validateP2Routes } from '../../packages/integrations/src/http/phase2-response-contracts.ts';
import { analysisApiContracts } from '../../packages/contracts/src/phase2-analysis.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import {
  HttpSuccess,
  type HttpRoute,
  type HttpContext,
} from '../../packages/integrations/src/http/core.ts';
const contract = analysisApiContracts.find((c) => c.operationId === 'p2PhotoCapture')!;
const context = {} as HttpContext;
const id = '9b15f99b-c50a-45d0-a7a4-172a6ad8a715';
it('rejects duplicated, unknown and drifted private contracts before serving', () => {
  const r: HttpRoute = { ...contract, handle: async () => ok({ batchId: id }) };
  expect(() => validateP2Routes([r, r])).toThrow();
  expect(() => validateP2Routes([{ ...r, operationId: 'p2Unknown' }])).toThrow();
  expect(() => validateP2Routes([{ ...r, access: 'public' }])).toThrow();
});
it('preserves P1 routes and application failures exactly', async () => {
  const error = fail(failure('forbidden')),
    r: HttpRoute = { ...contract, handle: async () => error };
  expect(await validateP2Routes([r])[0]!.handle(context)).toBe(error);
  const p1 = { ...r, operationId: 'existingP1' };
  expect(validateP2Routes([p1])[0]).toBe(p1);
});
it('strips future private fields before they can reach the wire', async () => {
  const r: HttpRoute = {
    ...contract,
    handle: async () => ok({ batchId: id, providerRequestId: 'PRIVATE' }),
  };
  expect(await validateP2Routes([r])[0]!.handle(context)).toEqual(ok({ batchId: id }));
});
it('rejects malformed or oversized private replies with an opaque unavailable error', async () => {
  for (const data of [
    { batchId: 'PRIVATE' },
    { batchId: id, privateText: 'x'.repeat(2097153) },
    { bigint: 1n },
    undefined,
  ]) {
    const r: HttpRoute = { ...contract, handle: async () => ok(data) };
    await expect(validateP2Routes([r])[0]!.handle(context)).rejects.toMatchObject({
      status: 503,
      code: 'unavailable',
    });
  }
});
it('preserves asynchronous deletion status while validating its opaque receipt', async () => {
  const r: HttpRoute = {
    ...analysisApiContracts.find((c) => c.operationId === 'p2PhotoDelete')!,
    handle: async () =>
      ok(new HttpSuccess(202, { id, jobId: id, cleanupPending: true, objectKey: 'PRIVATE' })),
  };
  const result = await validateP2Routes([r])[0]!.handle(context);
  expect(result).toEqual(ok(new HttpSuccess(202, { id, jobId: id, cleanupPending: true })));
});
