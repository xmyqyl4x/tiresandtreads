import { pilotHealthView } from './phase2-pilot-health-view.ts';
import { z, p2Uuid } from './phase2-wire.ts';
import { createP2Client, p2Operation } from './phase2-client.ts';
import type { EndpointContract } from './http.ts';
import { queueViewSchema, operationsViewSchema } from './staff-console.ts';
const empty = z.strictObject({}),
  stamp = z.iso.datetime(),
  count = z.number().int().min(0).max(5000),
  money = z.string().regex(/^\d{1,40}$/),
  task = z.enum(['report_analysis', 'generic_explanation', 'photo_extraction']);
const counts = (keys: readonly string[]) =>
  z
    .record(z.string().regex(new RegExp('^(' + keys.join('|') + ')$')), count)
    .refine((v) => Object.keys(v).length <= 16);
export const operationsCapabilities = z.object({
  aiObserve: z.boolean(),
  aiControl: z.boolean(),
  photoObserve: z.boolean(),
});
export const operationsReceipt = z.object({
  id: p2Uuid,
  operation: z.enum(['disable', 'resume']),
  target: p2Uuid,
  state: z.enum(['executing', 'succeeded', 'refused', 'unknown']),
  createdAt: stamp,
  finishedAt: stamp.nullable(),
});
export const operationsDayQuery = z.strictObject({ day: z.iso.date() });
export const operationsDashboard = z.object({
  day: z.string(),
  from: stamp,
  until: stamp,
  checkedAt: stamp,
  capabilities: operationsCapabilities,
  data: z.object({
    ai: z
      .object({
        sampleLimit: z.literal(5000),
        requestsSampled: count,
        requestsTruncated: z.boolean(),
        requestStates: counts([
          'queued',
          'running',
          'accepted',
          'rejected',
          'failed',
          'uncertain',
          'cancelled',
        ]),
        attemptsSampled: count,
        attemptsTruncated: z.boolean(),
        attemptStates: counts([
          'created',
          'started',
          'succeeded',
          'failed',
          'uncertain',
          'cancelled',
        ]),
        rejectionCodes: counts([
          'timeout',
          'refused',
          'invalid_output',
          'provider_unavailable',
          'cancelled',
          'unknown_charge',
        ]),
        usdReconciledMinor: money,
        usdEstimatedMinor: money,
        unknownCostAttempts: count,
        otherCurrencyAttempts: count,
        reuseSampled: count,
        reuseTruncated: z.boolean(),
        reuseStates: counts(['empty', 'leased', 'ready', 'invalidated']),
        expiredStoredReady: count,
        guardsSampled: count,
        guardsTruncated: z.boolean(),
        invalidatedGuards: count,
        guardStates: counts(['active', 'withdrawn', 'deleting']),
        policies: z
          .array(
            z.object({
              id: p2Uuid,
              task,
              status: z.enum(['draft', 'active', 'retired', 'blocked']),
              fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          )
          .max(25),
        policiesTruncated: z.boolean(),
        queue: z
          .array(
            z.object({
              id: p2Uuid,
              task,
              state: z.enum([
                'queued',
                'running',
                'accepted',
                'rejected',
                'failed',
                'uncertain',
                'cancelled',
              ]),
              recordedWork: z.boolean(),
              createdAt: stamp,
              expiresAt: stamp,
            }),
          )
          .max(25),
      })
      .nullable(),
    photo: z
      .object({
        sampleLimit: z.literal(5000),
        confirmationsSampled: count,
        confirmationsTruncated: z.boolean(),
        confirmationOrigins: counts(['accepted_candidate', 'corrected_candidate', 'manual']),
        purgesSampled: count,
        purgesTruncated: z.boolean(),
        purgePhases: counts(['journal', 'prepare', 'objects', 'providers', 'sql', 'blocked']),
        oldestPendingUpdatedAt: stamp.nullable(),
      })
      .nullable(),
  }),
});
export const operationsContracts: readonly EndpointContract[] = [
  {
    operationId: 'p2OperationsPurpose',
    method: 'GET',
    path: '/api/v1/staff/assistance/purpose',
    access: 'staff',
    command: false,
  },
  {
    operationId: 'p2OperationsSession',
    method: 'GET',
    path: '/api/v1/staff/assistance/session',
    access: 'staff',
    command: false,
  },
  {
    operationId: 'p2OperationsDashboard',
    method: 'GET',
    path: '/api/v1/staff/assistance/dashboard',
    access: 'staff',
    command: false,
  },
  {
    operationId: 'p2OperationsDisable',
    method: 'POST',
    path: '/api/v1/staff/assistance/policies/:policy/disable',
    access: 'staff',
    command: true,
  },
  {
    operationId: 'p2OperationsResume',
    method: 'POST',
    path: '/api/v1/staff/assistance/requests/:request/resume',
    access: 'staff',
    command: true,
  },
  {
    operationId: 'p2OperationsReceipt',
    method: 'GET',
    path: '/api/v1/staff/assistance/commands/:command',
    access: 'staff',
    command: false,
  },
];
const c = (name: string) => operationsContracts.find((c) => c.operationId === name)!;
export const operationsP2Definitions = {
  p2OperationsPurpose: p2Operation(
    c('p2OperationsPurpose'),
    undefined,
    z.object({
      kind: z.enum(['privacy', 'mail', 'callbacks', 'visitors', 'pilot']),
      queue: queueViewSchema.nullable(),
      visitors: operationsViewSchema.nullable(),
      pilot: pilotHealthView.nullable(),
    }),
    z.strictObject({
      kind: z.enum(['privacy', 'mail', 'callbacks', 'visitors', 'pilot']),
      day: z.iso.date(),
      after: p2Uuid.optional(),
      week: z.iso.date().optional(),
    }),
    false,
  ),
  p2OperationsSession: p2Operation(
    c('p2OperationsSession'),
    undefined,
    z.object({ csrf: z.string().regex(/^[a-f0-9]{64}$/), capabilities: operationsCapabilities }),
    empty,
    false,
  ),
  p2OperationsDashboard: p2Operation(
    c('p2OperationsDashboard'),
    undefined,
    operationsDashboard,
    operationsDayQuery,
    false,
  ),
  p2OperationsDisable: p2Operation(
    c('p2OperationsDisable'),
    z.strictObject({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
    operationsReceipt,
    empty,
    true,
  ),
  p2OperationsResume: p2Operation(c('p2OperationsResume'), empty, operationsReceipt, empty, true),
  p2OperationsReceipt: p2Operation(
    c('p2OperationsReceipt'),
    undefined,
    operationsReceipt,
    empty,
    false,
  ),
} as const;
export const createOperationsP2Client = (base: string, send: typeof fetch = fetch) =>
  createP2Client(operationsP2Definitions, base, (url, options) => {
    if (options?.method === 'POST')
      p2Uuid.parse(new Headers(options.headers).get('idempotency-key'));
    return send(url, options);
  });
