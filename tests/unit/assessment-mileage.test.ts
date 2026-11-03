import { it, expect } from 'vitest';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
it('retains optional annual mileage as context without inventing a fitment or ranking rule', () => {
  const raw = { ...engineFixture().request, annualMiles: 12000 };
  const result = normalizeAssessment(raw);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.annualMiles).toBe(12000);
});
it.each([-1, 200001, 1.5, '12000'])('refuses invalid annual mileage %j', (annualMiles) => {
  expect(normalizeAssessment({ ...engineFixture().request, annualMiles }).ok).toBe(false);
});
it.each([0, 200000, null])('accepts the explicit boundary/unknown mileage %j', (annualMiles) => {
  const r = normalizeAssessment({ ...engineFixture().request, annualMiles });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.annualMiles).toBe(annualMiles);
});
