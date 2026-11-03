import { it, expect } from 'vitest';
import { assessmentAnswers, blankAssessment } from '../../apps/web/src/assessment/model.ts';
const valid = {
  ...blankAssessment,
  mode: 'manual' as const,
  region: ' synthetic_us ',
  wheelPackage: 'Placard',
  front: '225/45r18',
  rear: '255/40r18',
  confirmed: true,
};
it('normalizes explicit manual answers, exact cents and optional mileage without claiming a configuration', () => {
  const r = assessmentAnswers({ ...valid, budget: '800.09', annualMiles: '12000' });
  expect(r.ok).toBe(true);
  if (r.ok)
    expect(r.input).toMatchObject({
      configurationId: null,
      regionKey: 'SYNTHETIC_US',
      sizes: { front: '225/45R18', rear: '255/40R18' },
      budget: { ceilingMinor: '80009', basis: 'installed' },
      annualMiles: 12000,
    });
});
it('preserves unknown budget and mileage rather than adding defaults', () => {
  const r = assessmentAnswers(valid);
  expect(r.ok && r.input.budget).toBeNull();
  expect(r.ok && r.input.annualMiles).toBeNull();
});
it.each([
  ['region', '<unknown>'],
  ['front', ''],
  ['rear', '225 45 18'],
  ['wheelPackage', ''],
  ['confirmed', false],
  ['replace', []],
  ['replace', ['front_left', 'front_right', 'rear_left']],
  ['priorities', ['wet', 'wet']],
  ['priorities', ['wet', 'noise', 'comfort', 'value']],
  ['budget', '1.009'],
  ['budget', '1e3'],
  ['annualMiles', '-1'],
  ['annualMiles', '200001'],
  ['annualMiles', '12000.5'],
])('identifies an invalid %s without discarding entered values', (key, value) => {
  const f = { ...valid, [key]: value },
    r = assessmentAnswers(f);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors[key]).toBeTruthy();
  expect(f.front).toBe(key === 'front' ? value : valid.front);
});
it('requires an explicit wheel package in vehicle mode', () => {
  const r = assessmentAnswers({ ...valid, mode: 'vehicle', configuration: '' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.configuration).toBeTruthy();
});
