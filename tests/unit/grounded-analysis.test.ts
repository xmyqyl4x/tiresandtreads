import { it, expect } from 'vitest';
import {
  buildAnalysisPacket,
  validateAnalysisSelection,
  renderAnalysisSelection,
} from '../../packages/domain/src/analysis-policy.ts';
const now = '2026-11-06T12:00:00.000Z';
function evidence() {
  return {
    market: 'US',
    locale: 'en-US',
    snapshotHash: 'a'.repeat(64),
    bundleId: '11111111-1111-4111-8111-111111111111',
    ruleVersion: '22222222-2222-4222-8222-222222222222',
    engineVersion: '1.0.0',
    input: {
      strategy: 'year_round',
      winterUse: 'snow',
      priorities: ['wet'],
      regionKey: 'PRIVATE_ZIP',
      email: 'omit@synthetic.example',
      ownerToken: 'never-send',
    },
    output: {
      result: {
        picks: ['option-a'],
        decisions: [
          {
            id: 'option-a',
            status: 'eligible',
            reasons: ['FITMENT_VERIFIED', 'PREFERENCE_SCORE'],
            sourceIds: ['33333333-3333-4333-8333-333333333333'],
            scoreBp: 8123,
            budget: 'within',
          },
        ],
      },
    },
    sources: [
      { id: '33333333-3333-4333-8333-333333333333', validUntil: '2026-11-07T12:00:00.000Z' },
    ],
  };
}
function packet() {
  const p = buildAnalysisPacket(evidence(), now);
  if (!p.ok) throw Error('fixture');
  return p.value;
}
function selection() {
  return {
    schema: 1,
    summary: 'report_facts',
    claims: [{ id: 'option-1', citations: ['33333333-3333-4333-8333-333333333333'] }],
    limitations: ['source_limits'],
    questions: ['verify_fitment', 'confirm_total'],
  };
}
it('minimizes private input and copies an immutable versioned packet', () => {
  const input = evidence(),
    p = buildAnalysisPacket(input, now);
  expect(p.ok).toBe(true);
  if (!p.ok) return;
  expect(JSON.stringify(p.value)).not.toMatch(/PRIVATE_ZIP|omit@|never-send|regionKey|ownerToken/);
  expect(p.value).toMatchObject({
    schema: 'analysis-packet-v1',
    market: 'US',
    locale: 'en-US',
    authoritativeHash: 'a'.repeat(64),
  });
  input.output.result.decisions[0]!.scoreBp = 0;
  expect(p.value.claims[0]!.scoreBp).toBe(8123);
  expect(Object.isFrozen(p.value.claims[0])).toBe(true);
});
it('accepts only grounded selection codes and renders authoritative numbers', () => {
  const p = packet(),
    s = validateAnalysisSelection(p, selection());
  expect(s.ok).toBe(true);
  if (!s.ok) return;
  const r = renderAnalysisSelection(p, s.value);
  expect(r.claims[0]).toMatchObject({
    rank: 1,
    scoreBasisPoints: 8123,
    reasonCodes: ['FITMENT_VERIFIED', 'PREFERENCE_SCORE'],
  });
  expect(r.limitations).toContain('physical_inspection_required');
  expect(r.limitations).toContain('deterministic_authority');
  expect(JSON.stringify(r)).not.toMatch(/<|javascript:|option-a/);
});
it.each([
  { summary: 'safe to drive' },
  { html: '<script>attack</script>' },
  { prices: [1] },
  { rankings: [2, 1] },
  { claims: [{ id: 'unknown', citations: [] }] },
  { claims: [{ id: 'option-1', citations: ['unknown'] }] },
  { claims: [{ id: 'option-1', citations: [] }] },
  {
    claims: [
      { id: 'option-1', citations: ['33333333-3333-4333-8333-333333333333'], text: '100 dollars' },
    ],
  },
  { limitations: ['no_limits'] },
  { questions: ['drive_faster'] },
  { schema: 2 },
  { claims: Array(6).fill(selection().claims[0]) },
  { questions: ['verify_fitment', 'verify_fitment'] },
  { summary: 1 },
  { claims: null },
  { limitations: null },
])(
  'refuses unsupported facts, claims, citations, numbers and unknown output fields %#',
  (change) => {
    expect(validateAnalysisSelection(packet(), { ...selection(), ...change }).ok).toBe(false);
  },
);
it.each(['market', 'locale', 'snapshotHash', 'bundleId', 'ruleVersion', 'engineVersion'] as const)(
  'refuses malformed %s evidence',
  (field) => {
    expect(buildAnalysisPacket({ ...evidence(), [field]: '<untrusted>' }, now).ok).toBe(false);
  },
);
it.each(['2026-11-06T12:00:00.000Z', '2026-11-05T12:00:00.000Z', 'invalid'])(
  'refuses expired or invalid evidence at %s',
  (validUntil) => {
    const e = evidence();
    e.sources[0]!.validUntil = validUntil;
    expect(buildAnalysisPacket(e, now).ok).toBe(false);
  },
);
it.each(['safe', 'condition_ok', 'roadworthy', '<script>'])(
  'refuses unknown deterministic reason %s',
  (reason) => {
    const e = evidence();
    e.output.result.decisions[0]!.reasons = [reason];
    expect(buildAnalysisPacket(e, now).ok).toBe(false);
  },
);
it('refuses a missing selected decision or unavailable supporting source', () => {
  const a = evidence();
  a.output.result.picks = ['missing'];
  expect(buildAnalysisPacket(a, now).ok).toBe(false);
  const b = evidence();
  b.sources = [];
  expect(buildAnalysisPacket(b, now).ok).toBe(false);
});
it('rejects overlarge source/decision sets instead of truncating evidence', () => {
  const e = evidence();
  e.sources = Array(65).fill(e.sources[0]);
  expect(buildAnalysisPacket(e, now).ok).toBe(false);
});
it('rejects duplicate selections and does not allow the model to reorder the report', () => {
  const p = packet(),
    s = selection();
  s.claims.push(s.claims[0]!);
  expect(validateAnalysisSelection(p, s).ok).toBe(false);
});

it('preserves validated size codes and null scores without copying arbitrary size properties', () => {
  const e = evidence();
  const raw = {
    ...e,
    input: { ...e.input, sizes: { front: 'P225/55R17', rear: 'LT245/75R16', private: 'omit' } },
  };
  const r = buildAnalysisPacket(raw, now);
  expect(r.ok).toBe(true);
  if (r.ok)
    expect(r.value.parameters).toMatchObject({ frontSize: 'P225/55R17', rearSize: 'LT245/75R16' });
  const other = buildAnalysisPacket(
    {
      ...e,
      output: {
        result: {
          ...e.output.result,
          decisions: [{ ...e.output.result.decisions[0], scoreBp: null }],
        },
      },
    },
    now,
  );
  expect(other.ok).toBe(true);
});
it.each([
  null,
  [],
  { ...evidence(), sources: [...evidence().sources, ...evidence().sources] },
  { ...evidence(), input: { ...evidence().input, sizes: { front: 'unsafe' } } },
  { ...evidence(), input: { ...evidence().input, priorities: ['wet', 'wet'] } },
  {
    ...evidence(),
    output: {
      result: {
        ...evidence().output.result,
        decisions: [...evidence().output.result.decisions, ...evidence().output.result.decisions],
      },
    },
  },
  {
    ...evidence(),
    output: {
      result: {
        picks: ['option-a'],
        decisions: [{ ...evidence().output.result.decisions[0], scoreBp: 10001 }],
      },
    },
  },
])('refuses ambiguous or structurally invalid evidence %#', (raw) =>
  expect(buildAnalysisPacket(raw, now).ok).toBe(false),
);
it('permits empty deterministic picks and still renders fixed safety limitations', () => {
  const e = evidence();
  e.output.result.picks = [];
  e.output.result.decisions = [];
  const p = buildAnalysisPacket(e, now);
  expect(p.ok).toBe(true);
  if (!p.ok) return;
  const s = validateAnalysisSelection(p.value, {
    ...selection(),
    claims: [],
    limitations: ['physical_inspection_required', 'deterministic_authority', 'no_recall_clearance'],
  });
  expect(s.ok).toBe(true);
  if (s.ok) expect(renderAnalysisSelection(p.value, s.value).limitations).toHaveLength(3);
});
it('renders selections in deterministic rank order despite model selection order', () => {
  const e = evidence();
  e.output.result.picks.push('second');
  e.output.result.decisions.push({ ...e.output.result.decisions[0]!, id: 'second' });
  const p = buildAnalysisPacket(e, now);
  if (!p.ok) throw Error('fixture');
  const s = validateAnalysisSelection(p.value, {
    ...selection(),
    claims: [{ ...selection().claims[0], id: 'option-2' }, selection().claims[0]],
  });
  expect(s.ok).toBe(true);
  if (s.ok)
    expect(renderAnalysisSelection(p.value, s.value).claims.map((c) => c.rank)).toEqual([1, 2]);
});

it('minimizes a supported thirty-plan engine snapshot larger than64KiB', async () => {
  const { engineFixture, uuid, asOf } = await import('../fixtures/engine/base.ts');
  const { evaluate } = await import('../../packages/engine/src/evaluate.ts');
  const { normalizeAssessment } = await import('../../packages/engine/src/input.ts');
  const { json } = await import('../../packages/application/src/services/service-records.ts');
  const f = engineFixture(),
    first = f.snapshot.plans[0]!;
  f.snapshot.plans = Array.from({ length: 30 }, (_, n) => ({
    ...structuredClone(first),
    id: uuid(2000 + n),
  }));
  const normalized = normalizeAssessment(f.request);
  if (!normalized.ok) throw Error('fixture');
  const result = evaluate(normalized.value, f.snapshot);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const output = json({ result: result.value, evidence: f.snapshot });
  expect(Buffer.byteLength(JSON.stringify(output))).toBeGreaterThan(65536);
  expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(524288);
  const built = buildAnalysisPacket(
    {
      market: 'US',
      locale: 'en-US',
      snapshotHash: 'a'.repeat(64),
      bundleId: f.snapshot.bundleId,
      ruleVersion: f.snapshot.policy.id,
      engineVersion: '1.0.0',
      input: f.request,
      output,
      sources: f.snapshot.sources.map((s) => ({ id: s.datasetId, validUntil: s.validUntil })),
    },
    asOf,
  );
  expect(built.ok).toBe(true);
  if (built.ok) expect(Buffer.byteLength(JSON.stringify(built.value))).toBeLessThan(32768);
});

it.each([
  { code: '31X10.50R15', sent: '31X10.50R15' },
  { code: '35X12.50R17LT', sent: '35X12.50R17LT' },
  { code: '195R15C', sent: '195R15C' },
  { code: '235/80R17.5', sent: '235/80R17.5' },
  { code: '7.50R16', sent: null },
])(
  'preserves deterministic engine support for $code without sending unknown optional size formats',
  async ({ code, sent }) => {
    const { engineFixture, asOf } = await import('../fixtures/engine/base.ts'),
      { evaluate } = await import('../../packages/engine/src/evaluate.ts'),
      { normalizeAssessment } = await import('../../packages/engine/src/input.ts'),
      { json } = await import('../../packages/application/src/services/service-records.ts');
    const f = engineFixture(),
      input = { ...f.request, sizes: { front: code, rear: code } },
      rim = /R([0-9]{2}(?:\.[05])?)/.exec(code)![1]!;
    for (const a of f.snapshot.fitment!.axles) {
      a.sizeCode = code;
      a.rimInches = rim;
    }
    for (const p of f.snapshot.plans) {
      p.front.sizeCode = code;
      p.rear.sizeCode = code;
      p.front.rimInches = rim;
      p.rear.rimInches = rim;
    }
    const normalized = normalizeAssessment(input);
    if (!normalized.ok) throw Error('Normalization fixture');
    const result = evaluate(normalized.value, f.snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.picks).toHaveLength(1);
    const built = buildAnalysisPacket(
      {
        market: 'US',
        locale: 'en-US',
        snapshotHash: 'a'.repeat(64),
        bundleId: f.snapshot.bundleId,
        ruleVersion: f.snapshot.policy.id,
        engineVersion: '1.0.0',
        input,
        output: json({ result: result.value, evidence: f.snapshot }),
        sources: f.snapshot.sources.map((s) => ({ id: s.datasetId, validUntil: s.validUntil })),
      },
      asOf,
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.parameters).toMatchObject({ frontSize: sent, rearSize: sent });
  },
);
