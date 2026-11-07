import { it, expect } from 'vitest';
import { createAnalysisErasureServices } from '../../packages/application/src/analysis/analysis-lifecycle.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { randomUUID } from 'node:crypto';
const keys = [{ keyVersion: 'local', digest: 'a'.repeat(64) }],
  scope = randomUUID(),
  crypto = createPrivacyCrypto('local', { local: new Uint8Array(32).fill(25) });
function services() {
  let effects = 0;
  const forbidden = async () => {
      effects++;
      throw Error('Invalid input reached an effect');
    },
    d = {
      crypto,
      now: () => new Date().toISOString(),
      uow: { run: forbidden },
      ownerUow: { run: forbidden },
      encryption: { encrypt: forbidden, decrypt: forbidden },
    } as unknown as Parameters<typeof createAnalysisErasureServices>[0];
  return { s: createAnalysisErasureServices(d), effects: () => effects };
}
it.each([null, [], {}, 'https://example.invalid/a', 1, 'bad-uuid'])(
  'rejects invalid erasure targets before work %#',
  async (raw) => {
    const { s, effects } = services();
    expect((await s.removeScope(keys, raw, 'command_1234567890123')).ok).toBe(false);
    expect(effects()).toBe(0);
  },
);
it.each([
  [],
  [{ keyVersion: 'local', digest: 'bad' }],
  [{ keyVersion: 'bad key', digest: 'a'.repeat(64) }],
  new Array(5).fill(keys[0]),
])('rejects malformed or oversized owner evidence %#', async (input) => {
  const { s, effects } = services();
  expect((await s.removeScope(input, scope, 'command_1234567890123')).ok).toBe(false);
  expect(effects()).toBe(0);
});
it.each(['https://provider.invalid/file', 'file\nsecret', '', 'a'.repeat(257)])(
  'refuses unsafe or oversized provider references %#',
  async (reference) => {
    const { s, effects } = services();
    expect(
      (
        await s.registerProvider({
          id: randomUUID(),
          attemptId: randomUUID(),
          scopeId: scope,
          provider: 'synthetic',
          kind: 'file',
          reference,
        })
      ).ok,
    ).toBe(false);
    expect(effects()).toBe(0);
  },
);
it('refuses unsigned, stale, future, unrelated and oversized journal replay before database effects', async () => {
  const { s, effects } = services();
  for (const document of [
    { version: 1, capturedAt: '2020-01-01T00:00:00Z', entries: [] },
    { version: 1, capturedAt: new Date(Date.now() + 60000).toISOString(), entries: [] },
    {
      version: 1,
      capturedAt: new Date().toISOString(),
      entries: [{ kind: 'other', marks: [], version: 1 }],
    },
    { version: 1, capturedAt: new Date().toISOString(), entries: new Array(1001).fill({}) },
  ])
    expect((await s.replay(crypto.sign(document))).ok).toBe(false);
  expect((await s.replay({ keyVersion: 'local', digest: '0'.repeat(64), document: {} })).ok).toBe(
    false,
  );
  expect(effects()).toBe(0);
});
it('rejects an unbound save command before extending retention', async () => {
  const { s, effects } = services();
  expect(
    (await s.save(keys, { uploadId: randomUUID(), noticeVersion: 'notice', command: 'short' })).ok,
  ).toBe(false);
  expect(effects()).toBe(0);
});
