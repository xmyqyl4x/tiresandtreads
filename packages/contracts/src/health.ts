import { z } from 'zod';

export const healthSchema = z.strictObject({
  status: z.literal('ok'),
  scope: z.literal('bootstrap'),
});
export type HealthResponse = z.infer<typeof healthSchema>;
