import { z } from 'zod';

const runtimeSchema = z.object({
  appEnv: z.enum(['dev-local', 'test-local', 'stage-local']),
  providerMode: z.literal('fixtures'),
});

export type RuntimeConfig = Readonly<z.infer<typeof runtimeSchema>>;

export function readRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const result = runtimeSchema.safeParse({ appEnv: env.APP_ENV, providerMode: env.PROVIDER_MODE });
  // Never echo environment values or validation input in startup errors.
  if (!result.success) throw new Error('Invalid bootstrap runtime configuration');
  return Object.freeze(result.data);
}
