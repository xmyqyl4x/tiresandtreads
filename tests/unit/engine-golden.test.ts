import { it, expect } from 'vitest';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { engineFixture, uuid } from '../fixtures/engine/base.ts';
import { goldenScenarios } from '../fixtures/engine/scenarios.ts';
it.each(goldenScenarios.map((s, i) => ({ ...s, id: 'G' + String(i + 1).padStart(3, '0') })))(
  '$id $name',
  (scenario) => {
    const f = engineFixture();
    scenario.change(f);
    const input = normalizeAssessment(f.request);
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    const result = evaluate(input.value, f.snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.value.decisions.find((d) => d.id === uuid(101))!;
    const status = scenario.status ?? 'eligible';
    expect(first.status).toBe(status);
    if (scenario.reason) expect(first.reasons).toContain(scenario.reason);
    expect(first.scoreBp).toBe(
      status === 'eligible' ? (scenario.score === undefined ? 7000 : scenario.score) : null,
    );
    expect(result.value.picks).toEqual(
      scenario.picks ?? (status === 'eligible' ? [uuid(101)] : []),
    );
    expect(result.value.issuanceAuthorized).toBe(false);
    if (scenario.reason === 'RECALL_MATCHED') expect(first.recallReferences).toContain(uuid(70));
  },
);
