import { it, expect } from 'vitest';
import { createStructuredAnalysisProvider } from '../../packages/integrations/src/analysis-provider.ts';
import type {
  AnalysisConfiguration,
  StructuredAnalysisTransport,
} from '../../packages/application/src/ports/report-analysis.ts';
import type { AnalysisPacket } from '../../packages/domain/src/analysis-policy.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';
const configuration: AnalysisConfiguration = {
  policyId: '11111111-1111-4111-8111-111111111111' as Id<'ai_policy'>,
  provider: 'synthetic',
  model: 'no-network',
  prompt: 'p1',
  schema: 'grounded-selection-v1',
  validator: 'grounded-validator-v1',
  canonical: 'v1',
  configurationHash: 'a'.repeat(64),
};
const packet = Object.freeze({
  schema: 'analysis-packet-v1',
  claims: [],
}) as unknown as AnalysisPacket;
const request = () => ({
  packet,
  configuration,
  deadlineMs: 100,
  attempt: '22222222-2222-4222-8222-222222222222' as Id<'ai_attempt'>,
});
const usage = {
  providerRequestId: 'synthetic-only',
  inputTokens: 1n,
  outputTokens: 2n,
  costMinor: 3n,
};
it('enforces server-only strict schema, no tools, no storage and bounded output', async () => {
  let observed: Parameters<StructuredAnalysisTransport['send']>[0] | null = null;
  const p = createStructuredAnalysisProvider({
    async send(x) {
      observed = x;
      return { ...usage, state: 'complete', output: { schema: 1 } };
    },
  });
  expect(await p.analyze(request())).toMatchObject({
    state: 'complete',
    output: { schema: 1 },
    costMinor: 3n,
  });
  expect(observed).toMatchObject({
    store: false,
    strict: true,
    tools: [],
    maxOutputTokens: 4096,
    schema: { additionalProperties: false },
  });
});
it.each(['refused', 'incomplete'] as const)(
  'handles %s without treating output as accepted',
  async (state) => {
    const p = createStructuredAnalysisProvider({
      async send() {
        return { ...usage, state, output: { danger: 'ignored' } };
      },
    });
    const r = await p.analyze(request());
    expect(r).toMatchObject({ state, costMinor: 3n });
    expect(r).not.toHaveProperty('output');
  },
);
it('redacts transport exceptions and retains uncertain charge', async () => {
  const p = createStructuredAnalysisProvider({
    async send() {
      throw Error('secret payload');
    },
  });
  const r = await p.analyze(request());
  expect(r).toMatchObject({ state: 'unavailable', costMinor: null });
  expect(JSON.stringify(r)).not.toContain('secret');
});
it('bounds a stalled provider and aborts its actual signal', async () => {
  let signal: AbortSignal | null = null;
  const p = createStructuredAnalysisProvider({
    send(x) {
      signal = x.signal;
      return new Promise(() => {});
    },
  });
  expect(await p.analyze({ ...request(), deadlineMs: 5 })).toMatchObject({
    state: 'timeout',
    costMinor: null,
  });
  expect(signal!.aborted).toBe(true);
});
it.each([0, -1, 30001, Infinity, NaN])(
  'refuses invalid deadline %s before dispatch',
  async (deadlineMs) => {
    let calls = 0;
    const p = createStructuredAnalysisProvider({
      async send() {
        calls++;
        return { ...usage, state: 'complete', output: {} };
      },
    });
    expect((await p.analyze({ ...request(), deadlineMs })).state).toBe('unavailable');
    expect(calls).toBe(0);
  },
);
it.each(['<html>', null, [], { text: 'x'.repeat(20000) }])(
  'refuses nonobject/oversized output %#',
  async (output) => {
    const p = createStructuredAnalysisProvider({
      async send() {
        return { ...usage, state: 'complete', output };
      },
    });
    expect((await p.analyze(request())).state).toBe('invalid_output');
  },
);
it.each([
  { costMinor: -1n },
  { inputTokens: -1n },
  { outputTokens: 2n ** 64n },
  { providerRequestId: 'x'.repeat(301) },
])('refuses invalid usage %#', async (change) => {
  const p = createStructuredAnalysisProvider({
    async send() {
      return { ...usage, ...change, state: 'complete', output: {} };
    },
  });
  expect((await p.analyze(request())).state).toBe('unavailable');
});
