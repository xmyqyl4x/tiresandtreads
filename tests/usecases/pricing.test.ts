import { it, expect, vi } from 'vitest';
import { createPricingService } from '../../packages/application/src/services/pricing.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { quoteFixture, asOf, uuid, usd } from '../fixtures/pricing/base.ts';
const request = () => ({
  quoteId: uuid(400),
  planId: uuid(101),
  regionKey: ' synthetic_us ',
  includeAlignment: false,
});
it('uses one explicit clock and the trusted quote compiler for every channel', async () => {
  const load = vi.fn(async () => ok(quoteFixture()));
  const r = await createPricingService({ now: () => asOf, evidence: { load } }).estimate(request());
  expect(r).toMatchObject({ ok: true, value: { installed: usd(74900n) } });
  expect(load).toHaveBeenCalledWith({ ...request(), regionKey: 'SYNTHETIC_US' }, asOf);
});
it('refuses malformed or commercially extended requests before any quote access', async () => {
  const load = vi.fn(),
    service = createPricingService({ now: () => asOf, evidence: { load } });
  for (const r of [
    null,
    [],
    {},
    { ...request(), bid: 1 },
    { ...request(), quoteId: 'bad' },
    { ...request(), planId: 'bad' },
    { ...request(), regionKey: 0 },
    { ...request(), regionKey: 'invalid region!' },
    { ...request(), includeAlignment: 1 },
  ])
    expect(await service.estimate(r)).toMatchObject({ error: { code: 'invalid_input' } });
  expect(load).not.toHaveBeenCalled();
});
it('accepts a null plan for private quote analysis without resolving a fabricated tire', async () => {
  const q = quoteFixture();
  q.planId = null;
  expect(
    await createPricingService({ now: () => asOf, evidence: { load: async () => ok(q) } }).estimate(
      { ...request(), planId: null },
    ),
  ).toMatchObject({ ok: true });
});
it('propagates denied access, invalid clocks and inconsistent resolver scope without leaking source data', async () => {
  const r = request();
  expect(
    await createPricingService({
      now: () => asOf,
      evidence: { load: async () => fail(failure('forbidden')) },
    }).estimate(r),
  ).toMatchObject({ error: { code: 'forbidden' } });
  expect(
    await createPricingService({
      now: () => 'bad',
      evidence: { load: async () => ok(quoteFixture()) },
    }).estimate(r),
  ).toMatchObject({ error: { code: 'internal' } });
  for (const field of ['id', 'planId', 'regionKey', 'asOf'] as const) {
    const q = quoteFixture();
    q[field] = 'wrong';
    expect(
      await createPricingService({
        now: () => asOf,
        evidence: { load: async () => ok(q) },
      }).estimate(r),
    ).toMatchObject({ error: { code: 'integrity' } });
  }
  const q = quoteFixture();
  q.includeAlignment = true;
  expect(
    await createPricingService({ now: () => asOf, evidence: { load: async () => ok(q) } }).estimate(
      r,
    ),
  ).toMatchObject({ error: { code: 'integrity' } });
});
it('redacts resolver exceptions and rejects invalid monetary source records', async () => {
  expect(
    await createPricingService({
      now: () => asOf,
      evidence: {
        load: async () => {
          throw Error('private owner quote');
        },
      },
    }).estimate(request()),
  ).toEqual({ ok: false, error: failure('unavailable') });
  const q = quoteFixture();
  q.lines[0]!.value = usd(-1n);
  expect(
    await createPricingService({ now: () => asOf, evidence: { load: async () => ok(q) } }).estimate(
      request(),
    ),
  ).toMatchObject({ error: { code: 'integrity' } });
});
