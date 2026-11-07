import { describe, expect, it } from 'vitest';
import {
  freezeAnalysis,
  analysisDeliveryText,
} from '../../packages/domain/src/analysis-delivery.ts';

const selection = () => ({
  schema: 1,
  mode: 'artifact',
  attachmentRevision: '2',
  artifactHash: 'a'.repeat(64),
  output: {
    schema: 1,
    kind: 'ai_assisted_selection',
    summary: 'These explanations refer only to facts recorded in the deterministic report.',
    claims: [],
    limitations: ['deterministic_authority', 'physical_inspection_required', 'no_recall_clearance'],
    questions: ['verify_fitment', 'verify_dot'],
  },
});
const generic = () => ({
  ...selection(),
  output: {
    schema: 1,
    kind: 'reviewed_generic_explanation',
    claims: [
      {
        text: 'Reviewed source provenance, not model prose.',
        adviceId: '11111111-1111-4111-8111-111111111111',
        sourceId: '22222222-2222-4222-8222-222222222222',
      },
    ],
    limitations: ['deterministic_authority', 'physical_inspection_required', 'no_recall_clearance'],
    questions: ['verify_fitment'],
  },
});
describe('frozen AI delivery selection', () => {
  it('freezes reviewed shared generic provenance and presents fixed general questions without raw artifact prose', () => {
    const input = generic(),
      frozen = freezeAnalysis(input);
    if (frozen.mode !== 'artifact') throw Error('Selected generic artifact required');
    input.output.claims[0]!.text = 'Changed after capture';
    expect(frozen.output).toMatchObject({
      kind: 'reviewed_generic_explanation',
      claims: [{ text: 'Reviewed source provenance, not model prose.' }],
    });
    const text = analysisDeliveryText(frozen).join('\n');
    expect(text).toContain('Reviewed general installer questions');
    expect(text).not.toContain('Reviewed source provenance');
    expect(text).toContain('physical inspection');
  });
  it.each([
    'owner_claim',
    'multiple_claims',
    'invalid_text',
    'invalid_advice',
    'invalid_source',
    'owner_summary',
  ])('refuses malformed shared generic provenance: %s', (mode) => {
    const x: Record<string, unknown> = generic(),
      o = x.output as Record<string, unknown>,
      c = (o.claims as Record<string, unknown>[])[0]!;
    if (mode === 'owner_claim') o.claims = [{ rank: 1 }];
    if (mode === 'multiple_claims') o.claims = [c, c];
    if (mode === 'invalid_text') c.text = 1;
    if (mode === 'invalid_advice') c.adviceId = 'bad';
    if (mode === 'invalid_source') c.sourceId = 'bad';
    if (mode === 'owner_summary') o.summary = 'Your tires are safe';
    expect(() => freezeAnalysis(x)).toThrow();
  });
  it('copies a selected immutable revision without consulting a provider or latest analysis', () => {
    const source = selection(),
      frozen = freezeAnalysis(source);
    source.output.questions.push('confirm_total');
    expect(frozen).toMatchObject({
      attachmentRevision: '2',
      output: { questions: ['verify_fitment', 'verify_dot'] },
    });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(analysisDeliveryText(frozen).join(' ')).toContain('installer');
  });
  it.each(['not_requested', 'unavailable', 'declined', 'expired'])(
    'captures the explicit %s fallback without a later automatic upgrade',
    (fallback) => {
      const f = freezeAnalysis({ schema: 1, mode: 'none', fallback });
      expect(f).toEqual({ schema: 1, mode: 'none', fallback });
      expect(analysisDeliveryText(f).join(' ')).toContain('deterministic report');
    },
  );
  it.each([
    { ...selection(), attachmentRevision: '0' },
    { ...selection(), attachmentRevision: '1.5' },
    { ...selection(), artifactHash: 'bad' },
    { ...selection(), mode: 'photo' },
    { ...selection(), fallback: 'unavailable' },
    { ...selection(), output: { ...selection().output, kind: 'photo' } },
    { ...selection(), output: { ...selection().output, summary: 'Your tires are safe' } },
    {
      ...selection(),
      output: { ...selection().output, questions: ['<img src=x onerror=alert(1)>'] },
    },
    { ...selection(), output: { ...selection().output, limitations: ['safe_to_drive'] } },
    {
      ...selection(),
      output: { ...selection().output, questions: ['verify_fitment', 'verify_fitment'] },
    },
    { ...selection(), output: { ...selection().output, claims: new Array(6).fill({}) } },
    { schema: 1, mode: 'none', fallback: 'auto' },
    { schema: 1, mode: 'none', fallback: 'expired', output: {} },
    null,
    [],
    { schema: 2, mode: 'none', fallback: 'expired' },
  ])('refuses malformed, unsafe or ambiguous frozen selection %#', (input) =>
    expect(() => freezeAnalysis(input)).toThrow(),
  );
  it('renders reviewed questions and safety limitations as plain fixed copy', () => {
    const text = analysisDeliveryText(freezeAnalysis(selection())).join('\n');
    expect(text).toContain('fitment');
    expect(text).toContain('DOT');
    expect(text).toContain('physical inspection');
    expect(text).not.toMatch(/safe to drive|https?:|<|owner|prompt/);
  });
});
