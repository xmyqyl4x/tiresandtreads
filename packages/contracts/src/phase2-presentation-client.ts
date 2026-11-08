import { z, p2Uuid, p2Revision } from './phase2-wire.ts';
import type { EndpointContract } from './http.ts';
import { createP2Client, p2Operation } from './phase2-client.ts';
export const presentationApiContracts: readonly EndpointContract[] = [
  {
    operationId: 'p2AnalysisPresentation',
    method: 'GET',
    path: '/api/v1/reports/:report/versions/:version/analysis/presentation',
    access: 'owner',
    command: false,
  },
];
export const presentationView = z.object({
  reportId: p2Uuid,
  version: z.number().int().min(1).max(2147483647),
  checkedAt: z.iso.datetime(),
  assistance: z.object({
    available: z.boolean(),
    policyId: p2Uuid.nullable(),
    noticeVersion: z.string().min(1).max(100),
    notice: z.string().min(1).max(2000),
  }),
  latestRequest: p2Uuid.nullable(),
  selection: z.object({ revision: p2Revision, attachedAt: z.iso.datetime() }).nullable(),
});
export const presentationP2Operations = {
  p2AnalysisPresentation: p2Operation(
    presentationApiContracts[0]!,
    undefined,
    presentationView,
    z.strictObject({}),
    false,
  ),
} as const;
export const createP2PresentationClient = (base: string, transport: typeof fetch = fetch) =>
  createP2Client(presentationP2Operations, base, transport);
