import { it, expect } from 'vitest';
import {
  estimateAnalysisReservation,
  normalizeSharedParameters,
  analysisRetry,
  validateGenericSelection,
  renderGenericSelection,
} from '../../packages/domain/src/analysis-reuse-policy.ts';
const rates = {
  inputCeiling: '32768',
  outputCeiling: '4096',
  inputPerMillionMinor: '250',
  outputPerMillionMinor: '1000',
};
it('rounds a reviewed maximum token charge upward with integer arithmetic', () =>
  expect(estimateAnalysisReservation(rates)).toEqual({ ok: true, value: 13n }));
it.each([
  { ...rates, inputCeiling: '0' },
  { ...rates, outputCeiling: '4097' },
  { ...rates, inputPerMillionMinor: '1.5' },
  { ...rates, inputPerMillionMinor: '9223372036854775808' },
  { ...rates, extra: true },
])('refuses unsupported/overflow pricing %#', (r) =>
  expect(estimateAnalysisReservation(r).ok).toBe(false),
);
it('keeps zero-priced configurations conservatively reservable without asserting free billing', () =>
  expect(
    estimateAnalysisReservation({
      ...rates,
      inputPerMillionMinor: '0',
      outputPerMillionMinor: '0',
    }),
  ).toEqual({ ok: true, value: 1n }));
it('canonicalizes reviewed generic enums and explicit missing values', () => {
  expect(normalizeSharedParameters({ market: 'US' }, ['market', 'usage'])).toEqual({
    ok: true,
    value: { market: 'US', usage: null },
  });
  expect(normalizeSharedParameters({ usage: null, market: 'US' }, ['usage', 'market'])).toEqual(
    normalizeSharedParameters({ market: 'US' }, ['market', 'usage']),
  );
});
it.each([
  { region: '90210' },
  { owner: 'private' },
  { market: 'CA' },
  { usage: 'drive safely' },
  { market: 'US', image: null },
  [],
  null,
])('refuses private/freeform/unsupported shared parameters %#', (raw) =>
  expect(normalizeSharedParameters(raw, ['market', 'usage']).ok).toBe(false),
);
it.each([{ allow: [] }, { allow: ['owner'] }, { allow: ['market', 'market'] }])(
  'refuses unreviewed allowlists %#',
  ({ allow }) => expect(normalizeSharedParameters({}, allow).ok).toBe(false),
);
it('allows at most two known-cost incomplete retries within the original deadline', () => {
  expect(analysisRetry('incomplete', 5n, 1, 120000)).toEqual({ attempt: 2, delayMs: 2000 });
  expect(analysisRetry('incomplete', 5n, 2, 120000)).toEqual({ attempt: 3, delayMs: 4000 });
  expect(analysisRetry('incomplete', 5n, 3, 120000)).toBeNull();
});
it.each([
  ['timeout', null],
  ['unavailable', 5n],
  ['incomplete', null],
  ['refused', 0n],
  ['invalid_output', 1n],
] as const)('does not blindly retry %s or uncertain billing', (state, cost) =>
  expect(analysisRetry(state, cost, 1, 120000)).toBeNull(),
);
it('refuses a retry too close to the total job deadline', () =>
  expect(analysisRetry('incomplete', 5n, 1, 30000)).toBeNull());
const packet = {
  schema: 'generic-evidence-v1' as const,
  definition: '11111111-1111-4111-8111-111111111111',
  parameters: { market: 'US' },
  fact: {
    id: '22222222-2222-4222-8222-222222222222',
    text: 'Ask the installer to verify fitment.',
    source: '33333333-3333-4333-8333-333333333333',
    validUntil: '2026-11-07T12:00:00.000Z',
  },
};
it('renders only the reviewed generic fact, never provider prose or invented numbers', () => {
  const r = validateGenericSelection(packet, {
    schema: 1,
    factIds: [packet.fact.id],
    questions: ['verify_fitment'],
  });
  expect(r.ok).toBe(true);
  if (r.ok)
    expect(renderGenericSelection(packet, r.value)).toMatchObject({
      kind: 'reviewed_generic_explanation',
      claims: [{ text: packet.fact.text, sourceId: packet.fact.source }],
    });
});
it.each([
  { schema: 2 },
  { factIds: ['invented'] },
  { factIds: [] },
  { questions: ['safe_to_drive'] },
  { text: 'tread is 8 mm' },
  { factIds: [packet.fact.id, packet.fact.id] },
])('refuses fabricated generic output %#', (raw) =>
  expect(
    validateGenericSelection(packet, {
      schema: 1,
      factIds: [packet.fact.id],
      questions: [],
      ...raw,
    }).ok,
  ).toBe(false),
);
