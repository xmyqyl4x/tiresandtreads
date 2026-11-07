import { it, expect, vi } from 'vitest';
import { createStructuredGenericProvider } from '../../packages/integrations/src/generic-analysis-provider.ts';
import type {
  GenericAnalysisProvider,
  GenericAnalysisTransport,
} from '../../packages/application/src/ports/generic-analysis.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';
const input = () => ({
  packet: {
    schema: 'generic-evidence-v1' as const,
    definition: '11111111-1111-4111-8111-111111111111',
    parameters: { market: 'US' },
    fact: {
      id: '22222222-2222-4222-8222-222222222222',
      source: '33333333-3333-4333-8333-333333333333',
      text: 'Ask the installer to verify fitment.',
      validUntil: '2026-11-07T12:00:00.000Z',
    },
  },
  configuration: {
    policyId: '44444444-4444-4444-8444-444444444444' as Id<'ai_policy'>,
    provider: 'synthetic',
    model: 'no-provider-call',
    prompt: 'generic-local-v1',
    schema: 'generic-selection-v1',
    validator: 'generic-validator-v1',
    canonical: 'generic-c14n-v1',
    configurationHash: 'a'.repeat(64),
  },
  deadlineMs: 100,
  attempt: '55555555-5555-4555-8555-555555555555' as Id<'ai_attempt'>,
});
const reply = () => ({
  state: 'complete' as const,
  output: { schema: 1, factIds: [input().packet.fact.id], questions: [] as string[] },
  providerRequestId: 'synthetic',
  inputTokens: 1n,
  outputTokens: 1n,
  costMinor: 5n,
});
it('uses strict bounded no-tool/store-false contracts and copies the output', async () => {
  const source = reply(),
    send = vi.fn<GenericAnalysisTransport['send']>(async (x) => {
      expect(x).toMatchObject({
        strict: true,
        store: false,
        tools: [],
        maxInputTokens: 65536,
        maxOutputTokens: 512,
      });
      return source;
    });
  const out = await createStructuredGenericProvider({ send }).analyze(input());
  expect(out.state).toBe('complete');
  if (out.state !== 'complete') throw Error('Expected complete synthetic output');
  source.output.questions.push('verify_fitment');
  expect(out.output).toMatchObject({ questions: [] as string[] });
});
it.each(['refused', 'incomplete'] as const)('keeps known charges on %s', async (state) =>
  expect(
    await createStructuredGenericProvider({ send: async () => ({ ...reply(), state }) }).analyze(
      input(),
    ),
  ).toMatchObject({ state, costMinor: 5n }),
);
it('retains known charge facts when output bytes exceed the contract', async () =>
  expect(
    await createStructuredGenericProvider({
      send: async () => ({ ...reply(), output: { text: 'x'.repeat(9000) } }),
    }).analyze(input()),
  ).toMatchObject({ state: 'invalid_output', costMinor: 5n }));
it('aborts a stalled transport under its real deadline', async () => {
  let signal: AbortSignal | undefined;
  const out = await createStructuredGenericProvider({
    send: async (x) => {
      signal = x.signal;
      return new Promise(() => {});
    },
  }).analyze({ ...input(), deadlineMs: 5 });
  expect(out).toMatchObject({ state: 'unavailable', costMinor: null });
  expect(signal?.aborted).toBe(true);
});
it('redacts provider errors and retains uncertainty', async () => {
  const out = await createStructuredGenericProvider({
    send: async () => {
      throw Error('private provider key');
    },
  }).analyze(input());
  expect(out).toMatchObject({ state: 'unavailable', costMinor: null });
  expect(JSON.stringify(out)).not.toContain('private');
});
it.each([0, 25001, 1.5])('refuses invalid deadline %s before transport', async (deadlineMs) => {
  const send = vi.fn<GenericAnalysisTransport['send']>(async () => reply());
  expect(
    (await createStructuredGenericProvider({ send }).analyze({ ...input(), deadlineMs })).state,
  ).toBe('unavailable');
  expect(send).not.toHaveBeenCalled();
});
it.each(['schema', 'validator', 'configurationHash'] as const)(
  'refuses an unevaluated %s contract',
  async (field) => {
    const x = input();
    x.configuration[field] = 'invalid';
    const send = vi.fn<GenericAnalysisTransport['send']>(async () => reply());
    expect((await createStructuredGenericProvider({ send }).analyze(x)).state).toBe('unavailable');
    expect(send).not.toHaveBeenCalled();
  },
);
it('refuses negative usage instead of treating it as a refund', async () =>
  expect(
    await createStructuredGenericProvider({
      send: async () => ({ ...reply(), costMinor: -1n }),
    }).analyze(input()),
  ).toMatchObject({ state: 'unavailable', costMinor: null }));
it('refuses an overlarge evidence packet before dispatch', async () => {
  const x: Parameters<GenericAnalysisProvider['analyze']>[0] = {
    ...input(),
    packet: { ...input().packet, fact: { ...input().packet.fact, text: 'x'.repeat(9000) } },
  };
  const send = vi.fn<GenericAnalysisTransport['send']>(async () => reply());
  expect((await createStructuredGenericProvider({ send }).analyze(x)).state).toBe('unavailable');
  expect(send).not.toHaveBeenCalled();
});
