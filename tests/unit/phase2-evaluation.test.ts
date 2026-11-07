import { it, expect } from 'vitest';
import { evaluateSyntheticBatch, wilsonInterval } from '../../scripts/verify/phase2-evaluation.ts';
import { syntheticEvaluationBatch } from '../fixtures/phase2/evaluation-cases.ts';
it('measures installed validators against fixed synthetic expectations without accepting a model or gate', () => {
  const r = evaluateSyntheticBatch(syntheticEvaluationBatch());
  expect(r.cases).toBe(8);
  expect(r.measured).toBe(8);
  expect(r.expectationMismatches).toBe(0);
  expect(r.accepted).toBe(false);
  expect(r.actualModelEvaluation).toBe(false);
  expect(r.actualRepresentativeImages).toBe(0);
  expect(r.actualSpecialistExplanationLabels).toBe(0);
  expect(r.pending).toContain('50-specialist-explanation-cases');
  expect(r.pending).toContain('50-representative-labeled-images');
  expect(r.gatesClosed).toBe(0);
});
it('keeps missing outputs separate from rejection and blocks an incomplete run', () => {
  const b = syntheticEvaluationBatch();
  b.cases[0]!.output = null;
  const r = evaluateSyntheticBatch(b);
  expect(r.measured).toBe(7);
  expect(r.unmeasured).toBe(1);
  expect(r.localExpectationsMet).toBe(false);
  expect(r.accepted).toBe(false);
});
it('reports incorrect predictions, per-field precision and abstention with actual denominators', () => {
  const b = syntheticEvaluationBatch();
  const c = b.cases.find((c) => c.family === 'photo' && c.expected === 'accepted')!;
  c.output = {
    schema: 1,
    fields: [
      {
        field: 'tire_size',
        rawText: '235/65R17',
        value: '235/65R17',
        quality: 'clear',
        unknownReason: null,
        region: { x: 0, y: 0, w: 1, h: 1 },
      },
    ],
  };
  const r = evaluateSyntheticBatch(b);
  expect(r.fields.find((f) => f.field === 'tire_size')).toMatchObject({
    emitted: 1,
    correct: 0,
    precision: 0,
  });
  expect(r.localExpectationsMet).toBe(false);
  expect(r.cohorts.length).toBeGreaterThan(0);
});
it('retains unknown rates as null when no measured predictions exist', () => {
  const b = syntheticEvaluationBatch();
  b.cases = b.cases.filter((c) => c.family === 'explanation');
  const r = evaluateSyntheticBatch(b);
  expect(r.fields.every((f) => f.precision === null && f.precisionInterval === null)).toBe(true);
});
it.each(['refused', 'malformed'])(
  'counts measured %s photo output in field abstention and missed-value denominators',
  (mode) => {
    const b = syntheticEvaluationBatch(),
      c = b.cases.find((c) => c.family === 'photo' && c.cohort === 'clear')!;
    c.output =
      mode === 'refused' ? { refused: true } : { schema: 1, fields: [], condition: 'safe' };
    c.expected = mode === 'refused' ? 'unavailable' : 'rejected';
    b.cases = [c];
    const r = evaluateSyntheticBatch(b);
    expect(r.measured).toBe(1);
    expect(r.fields.every((f) => f.labeled === 1 && f.abstained === 1 && f.emitted === 0)).toBe(
      true,
    );
    expect(r.fields.find((f) => f.field === 'tire_size')).toMatchObject({
      missedValues: 1,
      abstentionRate: 1,
      precision: null,
    });
    expect(r.expectationMismatches).toBe(1);
    expect(r.localExpectationsMet).toBe(false);
    expect(r.accepted).toBe(false);
  },
);
it('returns only aggregate measurements without raw inputs, labels, output text or identifiers', () => {
  const b = syntheticEvaluationBatch(),
    r = evaluateSyntheticBatch(b),
    text = JSON.stringify(r);
  for (const c of b.cases) {
    expect(text).not.toContain(c.id);
    expect(text).not.toContain(c.group);
  }
  expect(text).not.toContain('rawText');
  expect(text).not.toContain('225/65R17');
});
it.each([
  'duplicate-id',
  'duplicate-input',
  'cross-split-group',
  'actual-mode',
  'extra-key',
  'oversize',
  'invalid-label',
  'invalid-time',
  'undefined-output',
  'family-object',
  'expected-object',
  'split-object',
  'cohort-object',
])('refuses malformed or misleading synthetic inputs: %s', (mode) => {
  const b = syntheticEvaluationBatch();
  if (mode === 'duplicate-id') b.cases[1]!.id = b.cases[0]!.id;
  if (mode === 'duplicate-input') b.cases[1]!.inputSha256 = b.cases[0]!.inputSha256;
  if (mode === 'cross-split-group') {
    b.cases[1]!.group = b.cases[0]!.group;
    b.cases[1]!.split = b.cases[0]!.split === 'heldout' ? 'development' : 'heldout';
  }
  if (mode === 'actual-mode') Object.assign(b, { synthetic: false });
  if (mode === 'extra-key') Object.assign(b, { apiKey: 'private' });
  if (mode === 'oversize') b.cases = Array(1001).fill(b.cases[0]);
  if (mode === 'invalid-label') {
    const c = b.cases.find((c) => c.family === 'photo')!;
    Object.assign(c.labels, { condition: 'safe' });
  }
  if (mode === 'invalid-time') b.now = 'yesterday';
  if (mode === 'undefined-output') b.cases[0]!.output = undefined;
  for (const key of ['family', 'expected', 'split', 'cohort'] as const)
    if (mode === key + '-object') Object.assign(b.cases[0]!, { [key]: Object(b.cases[0]![key]) });
  expect(() => evaluateSyntheticBatch(b)).toThrow();
});
it('calculates a bounded Wilson interval and refuses invalid denominators', () => {
  expect(wilsonInterval(0, 0)).toBeNull();
  const r = wilsonInterval(10, 10)!;
  expect(r.lower).toBeGreaterThan(0.7);
  expect(r.upper).toBe(1);
  expect(() => wilsonInterval(2, 1)).toThrow();
});
