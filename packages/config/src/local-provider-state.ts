import { z } from 'zod';
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  target: z.enum(['dev', 'stage']),
  keyId: z.string().min(1).max(100),
  ciphertext: z.string().min(1).max(8192),
  plaintextHash: z.string().regex(/^[a-f0-9]{64}$/),
  objects: z
    .array(
      z.strictObject({
        bucket: z.string().regex(/^local-host-(private|public)-(dev|stage)$/),
        key: z.literal('fixture/provider-canary'),
        version: z.string().min(1).max(200),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .length(4),
});
export type LocalProviderState = z.infer<typeof schema>;
export function parseLocalProviderState(input: unknown, target: string) {
  const state = schema.parse(input);
  if (
    state.target !== target ||
    state.objects.some((o) => !o.bucket.endsWith('-' + target)) ||
    new Set(state.objects.map((o) => o.bucket + ':' + o.version)).size !== 4 ||
    ['private', 'public'].some(
      (kind) =>
        state.objects.filter((o) => o.bucket === `local-host-${kind}-${target}`).length !== 2,
    )
  )
    throw Error('Invalid provider state');
  return state;
}
