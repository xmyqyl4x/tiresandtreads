import { z, p2Uuid } from './phase2-wire.ts';
import type { EndpointContract } from './http.ts';
import { createP2Client, p2Operation } from './phase2-client.ts';
export const photoPresentationContracts: readonly EndpointContract[] = [
  {
    operationId: 'p2PhotoOptions',
    method: 'GET',
    path: '/api/v1/photo-options',
    access: 'owner',
    command: false,
  },
];
export const photoOptionsQuery = z.strictObject({ after: z.string().min(1).max(2048).optional() });
const stamp = z.iso.datetime();
export const photoOptionsView = z.object({
  checkedAt: stamp,
  processing: z.object({
    available: z.boolean(),
    policyId: p2Uuid.nullable(),
    noticeVersion: z.string().min(1).max(100),
    notice: z.string().min(1).max(2000),
    maxBytes: z.literal(10485760),
    expiresAfterHours: z.literal(24),
  }),
  items: z
    .array(
      z.object({
        id: p2Uuid,
        state: z.enum(['pending', 'quarantined', 'ready', 'processing', 'complete', 'rejected']),
        createdAt: stamp,
        expiresAt: stamp,
        savedAt: stamp.nullable(),
      }),
    )
    .max(25),
  next: z.string().max(2048).nullable(),
});
export const photoPresentationOperations = {
  p2PhotoOptions: p2Operation(
    photoPresentationContracts[0]!,
    undefined,
    photoOptionsView,
    photoOptionsQuery,
    false,
  ),
} as const;
export const createPhotoPresentationClient = (base: string, send: typeof fetch = fetch) =>
  createP2Client(photoPresentationOperations, base, send);
