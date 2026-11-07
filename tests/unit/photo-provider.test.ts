import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createPhotoExtractionProvider } from '../../packages/integrations/src/photo-provider.ts';
import type {
  PhotoExtractionProvider,
  PhotoExtractionTransport,
} from '../../packages/application/src/ports/photo-services.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';
const input = (): Parameters<PhotoExtractionProvider['extract']>[0] => {
  const bytes = new Uint8Array([255, 216, 255, 0]);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    configuration: {
      policyId: '11111111-1111-4111-8111-111111111111' as Id<'ai_policy'>,
      provider: 'synthetic',
      model: 'no-provider-call',
      prompt: 'photo-local-v1',
      schema: 'photo-selection-v1',
      validator: 'photo-fields-v1',
      canonical: 'photo-c14n-v1',
      configurationHash: 'a'.repeat(64),
    },
    attempt: '22222222-2222-4222-8222-222222222222' as Id<'ai_attempt'>,
    deadlineMs: 100,
  };
};
const reply = () => ({
  state: 'complete' as const,
  output: { schema: 1, fields: [] as string[] },
  providerRequestId: 'synthetic',
  inputTokens: 1n,
  outputTokens: 1n,
  costMinor: 5n,
});
it('sends only copied sanitized bytes with a strict no-tool/store-false contract', async () => {
  const source = reply(),
    original = input(),
    send = vi.fn<PhotoExtractionTransport['send']>(async (x) => {
      expect(x).toMatchObject({
        mime: 'image/jpeg',
        strict: true,
        store: false,
        tools: [],
        maxInputTokens: 1048576,
        maxOutputTokens: 1024,
      });
      expect(Object.keys(x).sort()).toEqual([
        'attempt',
        'bytes',
        'configuration',
        'maxInputTokens',
        'maxOutputTokens',
        'mime',
        'schema',
        'signal',
        'store',
        'strict',
        'tools',
      ]);
      x.bytes[3] = 20;
      return source;
    }),
    out = await createPhotoExtractionProvider({ send }).extract(original);
  expect(original.bytes[3]).toBe(0);
  if (out.state !== 'complete') throw Error('Expected complete synthetic output');
  source.output.fields.push('mutated');
  expect(out.output).toEqual({ schema: 1, fields: [] });
});
it.each(['refused', 'incomplete'] as const)('preserves known billing on %s', async (state) =>
  expect(
    await createPhotoExtractionProvider({ send: async () => ({ ...reply(), state }) }).extract(
      input(),
    ),
  ).toMatchObject({ state, costMinor: 5n }),
);
it('bounds output bytes without losing known charge facts', async () =>
  expect(
    await createPhotoExtractionProvider({
      send: async () => ({ ...reply(), output: { text: 'x'.repeat(9000) } }),
    }).extract(input()),
  ).toMatchObject({ state: 'invalid_output', costMinor: 5n }));
it('redacts provider errors and retains charge uncertainty', async () =>
  expect(
    await createPhotoExtractionProvider({
      async send() {
        throw Error('private provider token');
      },
    }).extract(input()),
  ).toMatchObject({ state: 'unavailable', costMinor: null }));
it('actually aborts a stalled provider transport at the server deadline', async () => {
  let signal: AbortSignal | undefined;
  const out = await createPhotoExtractionProvider({
    async send(x) {
      signal = x.signal;
      return new Promise(() => {});
    },
  }).extract({ ...input(), deadlineMs: 5 });
  expect(out.state).toBe('unavailable');
  expect(signal?.aborted).toBe(true);
});
it.each([
  { deadlineMs: 0 },
  { deadlineMs: 25001 },
  { deadlineMs: NaN },
  { sha256: 'b'.repeat(64) },
  { bytes: new Uint8Array(10485761) },
])('rejects out-of-contract input before dispatch %#', async (patch) => {
  const send = vi.fn<PhotoExtractionTransport['send']>(async () => reply());
  expect(
    (await createPhotoExtractionProvider({ send }).extract({ ...input(), ...patch })).state,
  ).toBe('unavailable');
  expect(send).not.toHaveBeenCalled();
});
it('does not accept invalid usage/billing metadata', async () =>
  expect(
    await createPhotoExtractionProvider({
      send: async () => ({ ...reply(), inputTokens: -1n }),
    }).extract(input()),
  ).toMatchObject({ state: 'unavailable', costMinor: null }));
