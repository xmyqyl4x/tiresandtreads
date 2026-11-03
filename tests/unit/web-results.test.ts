import { it, expect } from 'vitest';
import {
  ownerReport,
  publicReport,
} from '../../packages/application/src/services/report-records.ts';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import {
  money,
  range,
  when,
  confidence,
  reason,
  showDollarInput,
  parseDollarInput,
} from '../../apps/web/src/results/presentation.ts';
import {
  assessmentSignature,
  reportRoute,
  reportUrl,
} from '../../apps/web/src/results/controller.ts';
function raw() {
  const f = engineFixture(),
    input = normalizeAssessment(f.request);
  if (!input.ok) throw Error('fixture');
  const result = evaluate(input.value, f.snapshot);
  if (!result.ok) throw Error('fixture');
  return JSON.parse(
    JSON.stringify(
      {
        result: result.value,
        evidence: f.snapshot,
        prices: [],
        products: [],
        secret: 'not-public',
      },
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    ),
  );
}
it('adds owner evidence/confidence/budget without expanding the redacted share projection', () => {
  const r = raw(),
    owner = ownerReport(r),
    shared = publicReport(r);
  expect(
    (owner.result as { decisions: { confidence: number; budget: string }[] }).decisions[0],
  ).toMatchObject({ confidence: 3, budget: 'not_requested' });
  expect(owner.sources).toHaveLength(5);
  expect(owner.followUp).toMatchObject({ maintenance: 'not_assessed', questions: [] });
  expect(JSON.stringify(owner)).not.toContain('not-public');
  expect(JSON.stringify(shared)).not.toMatch(/confidence|budget|sources|followUp|secret/);
});
it('keeps unavailable legacy metadata null instead of inventing confidence or completeness', () => {
  const r = raw();
  delete r.result.decisions[0].confidence;
  delete r.result.decisions[0].suitability;
  delete r.result.decisions[0].budget;
  delete r.result.exclusions;
  delete r.evidence.sources;
  const v = ownerReport(r);
  expect((v.result as { decisions: unknown[]; exclusions: unknown }).exclusions).toBeNull();
  expect((v.result as { decisions: unknown[] }).decisions[0]).toMatchObject({
    confidence: null,
    suitability: null,
    budget: null,
  });
  expect(v.sources).toEqual([]);
});
it.each([
  ['0', '$0.00'],
  ['80009', '$800.09'],
  ['900719925474099312', '$9,007,199,254,740,993.12'],
])('formats exact stored cents %s without floating point loss', (v, label) => {
  expect(money(v)).toBe(label);
  expect(showDollarInput(v)).toBe(label.replace(/[$,]/g, ''));
});
it('renders unknowns and explicit bounds without false precision', () => {
  expect(money('1.5')).toBe('Unavailable');
  expect(range(null)).toBe('Unavailable');
  expect(range({ low: '100', high: '200', currency: 'USD' })).toBe('$1.00–$2.00 USD');
  expect(range({ low: '100', high: '100', currency: 'USD' })).toBe('$1.00 USD');
  expect(when('bad')).toBe('Date unavailable');
  expect(when('2026-11-03T00:00:00.000Z')).toContain('UTC');
  expect([0, 1, 2, 3, null].map(confidence)).toEqual([
    'Unknown',
    'Low',
    'Medium',
    'High',
    'Unknown',
  ]);
  expect(reason('RECALL_STALE')).toContain('stale');
  expect(reason('future-code')).toContain('review');
  expect(parseDollarInput('800.09')).toBe('80009');
  expect(parseDollarInput('')).toBeNull();
  expect(parseDollarInput('1e3')).toBe(false);
});
it.each([
  '?report=bad',
  '?report=10000000-0000-4000-8000-000000000001&version=0',
  '?report=10000000-0000-4000-8000-000000000001&version=1.5',
  '?report=10000000-0000-4000-8000-000000000001&version=99999999999',
])('refuses invalid private report routes %s', (search) => expect(reportRoute(search)).toBeNull());
it('preserves explicit historical versions in private links', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  expect(reportRoute('?report=' + id + '&version=2')).toEqual({ id, version: 2 });
  expect(reportUrl(id, 2)).toBe('/preview/report?report=' + id + '&version=2');
  expect(() => reportUrl('evil')).toThrow();
});

it.each([0, NaN])('rejects an explicitly invalid generated version %s', (version) =>
  expect(() => reportUrl('10000000-0000-4000-8000-000000000001', version)).toThrow(),
);

it('retains owner price provenance and excludes private price fields from both projections', () => {
  const r = raw();
  r.prices = [
    {
      planId: 'synthetic-plan',
      reasons: ['MISSING_TAX'],
      assumptionVersion: 'v1',
      merchandise: { low: '100', high: '200', currency: 'USD' },
      installed: null,
      secret: 'private-price',
    },
  ];
  const v = ownerReport(r);
  expect(v.prices).toMatchObject([
    {
      planId: 'synthetic-plan',
      assumptionVersion: 'v1',
      reasons: ['MISSING_TAX'],
      installed: null,
      merchandise: { low: '100' },
    },
  ]);
  expect(JSON.stringify(v)).not.toContain('private-price');
  expect(JSON.stringify(publicReport(r))).not.toContain('planId');
  delete r.evidence;
  delete r.prices;
  r.result.decisions[0].confidence = 8;
  r.result.decisions[0].reasons = [];
  expect(ownerReport(r)).toMatchObject({
    prices: [],
    sources: [],
    followUp: { questions: [] },
    result: { decisions: [{ confidence: null }] },
  });
});

it('recognizes identical draft values regardless of nested currency property ordering', () => {
  const input = {
    ...engineFixture().request,
    budget: { basis: 'installed' as const, currency: 'USD' as const, ceilingMinor: '80009' },
  };
  const reordered = {
    ...input,
    budget: { basis: 'installed' as const, ceilingMinor: '80009', currency: 'USD' as const },
  };
  expect(assessmentSignature(input)).toBe(assessmentSignature(reordered));
  expect(assessmentSignature({ ...input, annualMiles: -1 })).not.toBe(assessmentSignature(input));
});
