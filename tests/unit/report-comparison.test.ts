import { it, expect } from 'vitest';
import { evidenceFixture } from '../fixtures/reports/evidence.ts';
import {
  buildComparison,
  parsePrivateQuote,
} from '../../packages/application/src/services/report-comparison.ts';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { json } from '../../packages/application/src/services/report-records.ts';
import { uuid } from '../fixtures/engine/base.ts';
import type { Version, Quote } from '../../packages/application/src/ports/private-records.ts';
async function fixture() {
  const f = evidenceFixture(),
    answers = normalizeAssessment(f.e.request);
  if (!answers.ok) throw Error('fixture');
  const p = await f.service.prepare(answers.value, f.asOf);
  if (!p.ok) throw Error('fixture');
  const r = evaluate(answers.value, p.value.snapshot);
  if (!r.ok) throw Error('fixture');
  const v = {
    reportId: uuid(990),
    version: 1,
    baseVersion: null,
    bundleId: f.pin.bundleId,
    ruleVersionId: f.rule.id,
    engineVersion: '1.0.0',
    schemaVersion: 1,
    input: json(answers.value),
    output: { evidence: json(p.value.snapshot) },
  } as unknown as Version;
  return { ...f, p: p.value, result: r.value, v };
}
function quote(skuId: string | null = null, basis = 'installed_set', quantity = 4): Quote {
  const raw = {
    id: null,
    expectedRevision: null,
    skuId,
    productText: 'Unverified',
    shopName: null,
    currency: 'USD',
    totalMinor: '74900',
    quantity,
    basis,
    observedOn: '2026-10-25',
    taxContextConfirmed: true,
    taxIncluded: true,
    components: ['mounting', 'balancing', 'tpms_valve', 'disposal', 'tax'].map((kind) => ({
      kind,
      included: true,
      basis: 'per_order',
      minor: null,
    })),
  };
  const parsed = parsePrivateQuote(raw);
  return {
    ...parsed,
    id: uuid(991),
    reportId: uuid(990),
    sourceKey: uuid(991),
    expiresAt: '2026-11-01T00:00:00.000Z',
    currency: 'USD',
  } as unknown as Quote;
}
it('keeps known-but-wrong-size quotes separate from unverified products and missing prices', async () => {
  const f = await fixture(),
    plan = f.p.snapshot.plans[0]!,
    q = quote(plan.front.id);
  const r = buildComparison(
    f.v,
    f.p,
    f.result,
    [q],
    [
      { kind: 'catalog', key: plan.id },
      { kind: 'quote', key: q.id },
    ],
    f.crypto,
  );
  expect(r.items[1]!.snapshot).toMatchObject({
    productKnown: true,
    fit: 'blocked',
    scoreBp: null,
    verdict: { relation: 'not_comparable' },
  });
  expect(r.items[1]!.snapshot.reasons).toContain('SIZE_MISMATCH');
  const unknown = buildComparison(
    f.v,
    f.p,
    f.result,
    [quote()],
    [{ kind: 'quote', key: q.id }],
    f.crypto,
  );
  expect(unknown.items[0]!.snapshot).toMatchObject({
    fit: 'unverified',
    verdict: { relation: 'not_comparable', evidenceMissing: true },
  });
  const legacy = { ...quote(), components: [] };
  expect(
    buildComparison(f.v, f.p, f.result, [legacy], [{ kind: 'quote', key: q.id }], f.crypto)
      .items[0]!.snapshot.price,
  ).toBeNull();
});
it('retains declared quantities and qualifies malformed legacy, stale or inconsistent quote metadata', async () => {
  const f = await fixture();
  for (const [basis, quantity] of [
    ['per_tire', 1],
    ['set', 2],
    ['installed_set', 4],
  ] as const) {
    const q = quote(null, basis, quantity),
      r = buildComparison(f.v, f.p, f.result, [q], [{ kind: 'quote', key: q.id }], f.crypto);
    expect(r.items[0]!.snapshot.price).toMatchObject({ quantity });
  }
  const q = quote();
  Object.assign(q.components[1]!, { minor: 'invalid', included: false });
  expect(
    buildComparison(f.v, f.p, f.result, [q], [{ kind: 'quote', key: q.id }], f.crypto).items[0]!
      .snapshot.price,
  ).toBeNull();
  const declared = quote(f.p.snapshot.plans[0]!.front.id);
  Object.assign(declared.components[0]!, { sizeCode: '999/99R99' });
  expect(
    buildComparison(f.v, f.p, f.result, [declared], [{ kind: 'quote', key: declared.id }], f.crypto)
      .items[0]!.snapshot.fit,
  ).toBe('blocked');
  expect(() =>
    buildComparison(f.v, f.p, f.result, [], [{ kind: 'quote', key: q.id }], f.crypto),
  ).toThrow();
  expect(() =>
    buildComparison(f.v, f.p, f.result, [], [{ kind: 'catalog', key: uuid(999) }], f.crypto),
  ).toThrow();
});
