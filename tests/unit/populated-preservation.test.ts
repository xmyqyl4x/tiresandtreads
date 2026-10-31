import { it, expect } from 'vitest';
import {
  admitBaseline,
  compare,
  phase,
  sourceDigest,
  type Baseline,
} from '../fixtures/populated-preservation/contract.ts';
const project = 'tt-test-' + '1'.repeat(16),
  generation = '2'.repeat(32);
function baseline(): Baseline {
  return {
    version: 1,
    phase,
    project,
    generation,
    sourceDigest: sourceDigest(),
    observations: [0, 1].flatMap((slot) =>
      (['app', 'cms'] as const).map((kind) => ({
        slot,
        kind,
        catalog: 'a'.repeat(64),
        rows: 'b'.repeat(64),
        sequences: 'c'.repeat(64),
        security: 'd'.repeat(64),
        history: 'e'.repeat(64),
        populated: true,
        historiesValid: true,
        quarantined: true,
        tables: 5,
      })),
    ),
  };
}
it('accepts a declared complete populated fixture without turning it into authority', () => {
  const b = baseline();
  const admitted = admitBaseline(JSON.stringify(b), project, generation);
  expect(compare(admitted, structuredClone(b.observations))).toEqual([]);
  b.observations[0]!.rows = 'f'.repeat(64);
  expect(admitted.observations[0]!.rows).toBe('b'.repeat(64));
});
for (const fault of [
  'phase',
  'project',
  'generation',
  'sourceDigest',
  'observations',
  'extra',
] as const)
  it(`refuses ${fault} baseline substitution`, () => {
    const b = baseline() as unknown as Record<string, unknown>;
    if (fault === 'observations') (b.observations as unknown[]).reverse();
    else b[fault] = 'wrong';
    expect(() => admitBaseline(JSON.stringify(b), project, generation)).toThrow();
  });
for (const field of ['catalog', 'rows', 'sequences', 'security', 'history'] as const)
  it(`detects ${field} drift on the actual observation`, () => {
    const b = baseline(),
      observed = structuredClone(b.observations);
    observed[2]![field] = 'f'.repeat(64);
    expect(compare(b, observed)).toContain(`1/app:${field}`);
  });
for (const field of ['populated', 'historiesValid', 'quarantined'] as const)
  it(`refuses a baseline with ${field} false`, () => {
    const b = baseline();
    b.observations[0]![field] = false;
    expect(() => admitBaseline(JSON.stringify(b), project, generation)).toThrow();
  });
it('refuses a partial pair', () => {
  const b = baseline();
  expect(() => compare(b, b.observations.slice(0, 3))).toThrow();
});
it('refuses duplicated observed endpoints', () => {
  const b = baseline(),
    o = structuredClone(b.observations);
  o[3] = o[2]!;
  expect(() => compare(b, o)).toThrow();
});
it('refuses over-budget baseline bytes', () => {
  expect(() => admitBaseline(' '.repeat(16385), project, generation)).toThrow();
});
it('refuses an invalid component digest', () => {
  const b = baseline();
  b.observations[0]!.rows = 'invalid';
  expect(() => admitBaseline(JSON.stringify(b), project, generation)).toThrow();
});
it('refuses an excessive table count', () => {
  const b = baseline();
  b.observations[0]!.tables = 201;
  expect(() => admitBaseline(JSON.stringify(b), project, generation)).toThrow();
});
