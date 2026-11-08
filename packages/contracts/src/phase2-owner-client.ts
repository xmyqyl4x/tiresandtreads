import { z, p2Uuid, p2Revision } from './phase2-wire.ts';
import {
  analysisApiContracts,
  analysisApiInputs,
  photoApiInputs,
  analysisStatusView,
  analysisAttachmentView,
  photoStatusView,
  photoConfirmationView,
} from './phase2-analysis.ts';
import { pilotApiContracts, pilotRequestInput } from './phase2-pilot.ts';
import { createP2Client, p2Operation } from './phase2-client.ts';
import type { EndpointContract } from './http.ts';
export const analysisDeliveryInput = z.strictObject({
  email: z.string().min(3).max(254),
  report: z.strictObject({ id: p2Uuid, version: z.number().int().min(1).max(2147483647) }),
  offers: z.boolean(),
  notices: z.strictObject({ report: p2Uuid, offers: p2Uuid.optional() }),
  comparisonRevision: p2Revision.nullable().optional(),
  analysis: z.union([
    z.strictObject({ attachmentRevision: p2Revision, fallback: z.null() }),
    z.strictObject({
      attachmentRevision: z.null(),
      fallback: z.enum(['not_requested', 'unavailable', 'declined', 'expired']),
    }),
  ]),
});
export const analysisDeliveryContract: EndpointContract = {
  operationId: 'p2AnalysisDelivery',
  path: '/api/v1/analysis/deliveries',
  method: 'POST',
  access: 'owner',
  command: true,
};
const empty = z.strictObject({}),
  stamp = z.iso.datetime(),
  text = z.string().max(200),
  contracts = [...analysisApiContracts, ...pilotApiContracts, analysisDeliveryContract];
const contract = (name: string) => {
  const c = contracts.find((x) => x.operationId === name);
  if (!c) throw Error('Unknown owner operation');
  return c;
};
const post = <I extends z.ZodType, O extends z.ZodType>(name: string, input: I, output: O) =>
  p2Operation(contract(name), input, output, empty, true);
const get = <O extends z.ZodType>(name: string, output: O) =>
  p2Operation(contract(name), undefined, output, empty, false);
export const ownerP2Operations = {
  p2AnalysisRequest: post('p2AnalysisRequest', analysisApiInputs.request, analysisStatusView),
  p2AnalysisStatus: get('p2AnalysisStatus', analysisStatusView),
  p2AnalysisAttachment: get('p2AnalysisAttachment', analysisAttachmentView),
  p2AnalysisChoice: post(
    'p2AnalysisChoice',
    analysisApiInputs.choice,
    z.object({ allowed: z.boolean(), permissionRevision: p2Revision, cleanupPending: z.boolean() }),
  ),
  p2PhotoCapture: post('p2PhotoCapture', photoApiInputs.capture, z.object({ batchId: p2Uuid })),
  p2PhotoIntent: post(
    'p2PhotoIntent',
    photoApiInputs.intent,
    z.discriminatedUnion('state', [
      z.object({ state: z.literal('manual'), id: z.null(), grant: z.null(), grantUntil: z.null() }),
      z.object({
        state: z.enum([
          'pending',
          'processing',
          'ready',
          'quarantined',
          'complete',
          'rejected',
          'deleting',
          'deleted',
        ]),
        id: p2Uuid,
        grant: photoApiInputs.finalize,
        grantUntil: stamp,
      }),
    ]),
  ),
  p2PhotoFinalize: p2Operation(
    contract('p2PhotoFinalize'),
    undefined,
    photoStatusView,
    empty,
    true,
    true,
  ),
  p2PhotoExtract: post(
    'p2PhotoExtract',
    photoApiInputs.extract,
    z.object({ id: p2Uuid, state: text }),
  ),
  p2PhotoStatus: get('p2PhotoStatus', photoStatusView),
  p2PhotoConfirm: post('p2PhotoConfirm', photoApiInputs.confirm, photoConfirmationView),
  p2PhotoDelete: post(
    'p2PhotoDelete',
    photoApiInputs.remove,
    z.object({ id: p2Uuid, jobId: p2Uuid, cleanupPending: z.literal(true) }),
  ),
  p2PhotoSave: post(
    'p2PhotoSave',
    photoApiInputs.save,
    z.object({ value: z.union([z.string().max(100), z.null()]).optional() }),
  ),
  p2PilotRequest: post(
    'p2PilotRequest',
    pilotRequestInput,
    z.object({ sendId: p2Uuid, state: z.literal('registered'), includeOffers: z.boolean() }),
  ),
  p2PilotCancel: post('p2PilotCancel', empty, z.object({ state: text })),
  p2AnalysisDelivery: post(
    'p2AnalysisDelivery',
    analysisDeliveryInput,
    z.object({
      id: p2Uuid,
      revision: p2Revision,
      state: text,
      sendAfter: stamp,
      cancelDeadline: stamp,
    }),
  ),
} as const;
export const createP2OwnerClient = (base: string, transport: typeof fetch = fetch) =>
  createP2Client(ownerP2Operations, base, transport);
