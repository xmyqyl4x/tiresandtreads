import { z } from 'zod';

import { apiErrorSchema } from './http-views.ts';
export { apiErrorSchema } from './http-views.ts';
export { createApiClient } from './transport.ts';
export type { ApiReply } from './transport.ts';
export const pageSchema = z.strictObject({
  after: z.string().min(1).max(2048).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const toolInputSchema = z.strictObject({ input: z.unknown() });
export type ApiError = z.infer<typeof apiErrorSchema>;
export type WireValue =
  null | boolean | number | string | WireValue[] | { [key: string]: WireValue };
export interface EndpointContract {
  readonly operationId: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly access: 'public' | 'owner' | 'capability' | 'staff' | 'callback' | 'partner';
  readonly command?: boolean;
  readonly bodyMode?: 'json' | 'bytes' | 'form';
  readonly maxBodyBytes?: number;
  readonly bodyContentType?: 'application/octet-stream';
  readonly successStatuses?: readonly (200 | 201 | 202 | 204 | 302)[];
}
export const sessionContracts = [
  { operationId: 'createOwnerSession', method: 'POST', path: '/api/v1/sessions', access: 'public' },
  {
    operationId: 'getOwnerSession',
    method: 'GET',
    path: '/api/v1/sessions/current',
    access: 'owner',
  },
] as const satisfies readonly EndpointContract[];
