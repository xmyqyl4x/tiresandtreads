import { it, expect } from 'vitest';
import { evidenceFixture } from '../fixtures/reports/evidence.ts';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { json } from '../../packages/application/src/services/report-records.ts';
import { uuid } from '../fixtures/engine/base.ts';
const input = (f: ReturnType<typeof evidenceFixture>) => {
  const r = normalizeAssessment(f.e.request);
  if (!r.ok) throw Error('fixture');
  return r.value;
};
it('compiles one pinned repository graph, prices and the actual recall check timestamp without inferring clearance', async () => {
  const f = evidenceFixture(),
    r = await f.service.prepare(input(f), f.asOf);
  expect(r).toMatchObject({ ok: true });
  if (!r.ok) return;
  expect(r.value.snapshot.plans).toHaveLength(1);
  expect(r.value.prices[0]?.installed).toMatchObject({ low: 68200n, high: 68200n });
  expect(r.value.snapshot.recall.checkedAt).toBe(f.asOf);
  expect(r.value.snapshot.plans[0]?.front.recall.state).toBe('unknown');
  expect(r.value.products).toHaveLength(2);
  expect(evaluate(input(f), r.value.snapshot)).toMatchObject({
    ok: true,
    value: { issuanceAuthorized: false, picks: [] },
  });
  expect(await f.service.current(r.value)).toEqual({ ok: true, value: true });
  const v = {
    reportId: uuid(950),
    version: 1,
    baseVersion: null,
    bundleId: f.pin.bundleId,
    ruleVersionId: f.rule.id,
    engineVersion: '1.0.0',
    schemaVersion: 1,
    input: json(input(f)),
    output: json({ evidence: r.value.snapshot }),
  };
  expect(await f.service.overlay(v as never, f.asOf)).toMatchObject({
    value: { status: 'review_required', unresolved: true },
  });
  f.facts.recallTargets = [
    {
      fact: {
        id: uuid(951),
        skuId: r.value.snapshot.plans[0]!.front.id,
        modelId: null,
        matchStatus: 'matched',
        sourceTargetId: uuid(952),
      },
      source: f.pin.components.find((c) => c.key === 'recall')!.source,
    },
  ];
  expect(await f.service.overlay(v as never, f.asOf)).toMatchObject({
    value: { matched: [uuid(952)] },
  });
  f.recalls.checkedAt.mockResolvedValue(null);
  const historical = {
    ...v,
    output: {
      evidence: json({
        ...r.value.snapshot,
        plans: r.value.snapshot.plans.map((p) => ({
          ...p,
          front: {
            ...p.front,
            recall: { ...p.front.recall, state: 'matched', targetRefs: [uuid(953)] },
          },
        })),
      }),
    },
  };
  expect(await f.service.overlay(historical as never, f.asOf)).toMatchObject({
    value: { status: 'unavailable', matched: [uuid(953)] },
  });
  expect(await f.service.current(r.value)).toEqual({ ok: true, value: false });
  expect(await f.service.overlay(v as never, f.asOf)).toMatchObject({
    value: { status: 'unavailable' },
  });
});
const adverse: [string, (f: ReturnType<typeof evidenceFixture>) => void][] = [
  [
    'missing snapshot rights',
    (f) => {
      Object.assign(f.pin.components[0]!.source.rights, { snapshot: false });
    },
  ],
  [
    'expired source window',
    (f) => {
      Object.assign(f.pin.components[0]!.source, {
        expiresAt: { state: 'known', value: '2026-01-01T00:00:00.000Z' },
      });
    },
  ],
  [
    'partial bundle',
    (f) => {
      Object.assign(f.pin, { coverage: 'partial' });
    },
  ],
  [
    'missing policy',
    (f) => {
      f.policies.published.mockResolvedValue(null as never);
    },
  ],
  [
    'expired review',
    (f) => {
      f.doc.reviewDueAt = '2026-01-01T00:00:00.000Z';
    },
  ],
  [
    'future reviewer time',
    (f) => {
      f.rule.reviewedAt = '2027-01-01T00:00:00.000Z';
    },
  ],
  [
    'unknown source role',
    (f) => {
      (f.doc.componentKinds as Record<string, unknown>).catalog = 'unknown';
    },
  ],
  [
    'missing source ttl',
    (f) => {
      (f.doc.freshnessSeconds as Record<string, unknown>).catalog = null;
    },
  ],
  [
    'unavailable region profile',
    (f) => {
      f.facts.climateProfiles = [];
    },
  ],
  [
    'expired regional guidance',
    (f) => {
      f.facts.marketRules![0]!.fact.effectiveTo = '2025-01-01T00:00:00.000Z';
    },
  ],
  [
    'missing recall component',
    (f) => {
      f.pin.components.splice(
        f.pin.components.findIndex((c) => c.key === 'recall'),
        1,
      );
    },
  ],
  [
    'duplicate configuration',
    (f) => {
      f.facts.fitmentConfigurations!.push(f.facts.fitmentConfigurations![0]!);
    },
  ],
  [
    'unbounded page',
    (f) => {
      f.catalog.page.mockResolvedValue({ items: [], next: 'more' });
    },
  ],
  [
    'missing recall check',
    (f) => {
      f.recalls.checkedAt.mockResolvedValue(null);
    },
  ],
  [
    'invalid engine policy',
    (f) => {
      f.doc.weights = { wet: 10001 };
    },
  ],
  [
    'duplicate evidence metrics',
    (f) => {
      const row = f.facts.evidence![0]!;
      for (let i = 0; i < 10; i++)
        f.facts.evidence!.push({ ...row, fact: { ...row.fact, id: uuid(980 + i) } });
    },
  ],
  [
    'overlarge portfolio',
    (f) => {
      for (let i = 1; i < 11; i++)
        for (const row of f.facts.tireSkus!.slice(0, 2))
          f.facts.tireSkus!.push({
            ...row,
            fact: {
              ...row.fact,
              id: uuid(1000 + i + (row.fact.sizeCode === '225/45R18' ? 0 : 20)),
            },
          });
    },
  ],
];
it.each(adverse)(
  'fails closed for %s without an invented source contract',
  async (_name, change) => {
    const f = evidenceFixture();
    change(f);
    expect(await f.service.prepare(input(f), f.asOf)).toMatchObject({ ok: false });
  },
);
it('keeps absent configurations, availability, models and measurement values explicit', async () => {
  const f = evidenceFixture();
  f.facts.tireModels = [];
  f.facts.marketAvailability = [];
  f.facts.evidence![0]!.fact.numericValue = null;
  const r = await f.service.prepare(input(f), f.asOf);
  expect(r).toMatchObject({ ok: true });
  if (!r.ok) return;
  expect(r.value.snapshot.plans[0]!.front).toMatchObject({
    season: null,
    available: null,
    availabilityUntil: null,
  });
  expect(await f.service.prepare(input(f), 'bad')).toMatchObject({ error: { code: 'integrity' } });
  const before = await f.service.overlay({ input: {}, output: {} } as never, f.asOf);
  expect(before).toMatchObject({ value: { status: 'unavailable' } });
  const request = {
    ...f.e.request,
    configurationId: null,
    sizes: { front: '225/45R18', rear: '255/40R18' },
  };
  const parsed = normalizeAssessment(request);
  if (!parsed.ok) throw Error('fixture');
  expect(await f.service.prepare(parsed.value, f.asOf)).toMatchObject({
    ok: true,
    value: { snapshot: { fitment: null, plans: [] } },
  });
});
it('does not attach ambiguous retailer, timestamp, quantity or fee assumptions to a hard budget', async () => {
  for (const change of [
    (f: ReturnType<typeof evidenceFixture>) => {
      f.facts.prices![0]!.fact.quantityBasis = 'per_set';
    },
    (f: ReturnType<typeof evidenceFixture>) => {
      f.facts.prices![0]!.fact.retailerId = uuid(981);
    },
    (f: ReturnType<typeof evidenceFixture>) => {
      f.facts.prices![0]!.fact.observedAt = '2026-10-25T11:59:59.000Z';
    },
  ]) {
    const f = evidenceFixture();
    change(f);
    const r = await f.service.prepare(input(f), f.asOf);
    expect(r).toMatchObject({ ok: true, value: { prices: [] } });
  }
  const f = evidenceFixture();
  f.facts.priceComponents![0]!.fact.basis = 'per_order';
  f.facts.priceComponents![1]!.fact.amountKind = 'unknown';
  const r = await f.service.prepare(input(f), f.asOf);
  expect(r).toMatchObject({ ok: true });
  if (!r.ok) return;
  expect(r.value.prices[0]!.installed).toBeNull();
  expect(r.value.snapshot.plans[0]!.cost).toBeNull();
});
it('refuses changed policy, bundle, rights and health on the final current-data check', async () => {
  const f = evidenceFixture(),
    r = await f.service.prepare(input(f), f.asOf);
  if (!r.ok) throw Error('fixture');
  const previous = f.rule.id;
  f.rule.id = uuid(998);
  expect(await f.service.current(r.value)).toEqual({ ok: true, value: false });
  f.rule.id = previous;
  f.catalog.pin.mockRejectedValueOnce(Error('private database details'));
  expect(await f.service.current(r.value)).toMatchObject({ error: { code: 'unavailable' } });
  f.catalog.pin.mockResolvedValueOnce(null as never);
  expect(
    await f.service.overlay(
      { input: json(input(f)), output: { evidence: json(r.value.snapshot) } } as never,
      f.asOf,
    ),
  ).toMatchObject({ value: { status: 'unavailable' } });
});
