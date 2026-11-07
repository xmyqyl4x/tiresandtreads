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
describe('frozen AI delivery selection', () => {
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
