import './browser-runtime.ts';
import {
  object,
  string,
  uuid,
  number,
  maxLength,
  array,
  literal,
  boolean,
  nullable,
  optional,
  enum as enumeration,
} from 'zod/mini';
import { createApiClient } from './transport.ts';
import { assessmentInputSchema } from './assessment-input.ts';
import type { AssessmentRequest } from './report-inputs.ts';
const source = object({
  datasetId: uuid(),
  fetchedAt: string(),
  expiresAt: object({
    state: enumeration(['known', 'unknown']),
    value: optional(string()),
    reason: optional(string()),
  }),
  rights: object({ display: boolean(), api: boolean() }),
});
const fact = object({
  id: uuid(),
  modelYear: optional(number()),
  make: optional(string()),
  model: optional(string()),
  trim: optional(string()),
  vehicleId: optional(uuid()),
  configurationId: optional(uuid()),
  wheelPackage: optional(string()),
  verificationStatus: optional(string()),
  axle: optional(string()),
  sizeCode: optional(string()),
});
export const referencePageSchema = object({
  coverage: enumeration(['available', 'partial', 'unavailable']),
  source: nullable(
    object({ bundleId: uuid(), components: array(object({ key: string(), source })) }),
  ),
  items: array(object({ fact, source })).check(maxLength(100)),
  next: nullable(string()),
});
export const reportReceiptSchema = object({
  schema_version: literal(1),
  resource_id: uuid(),
  status: literal('created'),
  report_id: uuid(),
  report_version: literal(1),
});
export function createAssessmentClient(base: string, send: typeof fetch = fetch) {
  const api = createApiClient(base, send);
  return {
    async lookup(
      kind: 'vehicles' | 'fitmentConfigurations' | 'fitmentAxles',
      filters: Record<string, string>,
      signal?: AbortSignal,
    ) {
      const query = new URLSearchParams({ kind, market: 'US', limit: '25', ...filters });
      return referencePageSchema.parse(
        (await api.request<unknown>('/api/v1/reference?' + query, signal ? { signal } : {})).data,
      );
    },
    async create(input: AssessmentRequest, csrf: string, key: string) {
      assessmentInputSchema.parse(input);
      const receipt = reportReceiptSchema.parse(
        (
          await api.request<unknown>('/api/v1/reports', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrf,
              'idempotency-key': key,
            },
            body: JSON.stringify(input),
          })
        ).data,
      );
      if (receipt.resource_id !== receipt.report_id) throw Error('Invalid assessment receipt');
      return receipt;
    },
  };
}
export type ReferencePage = ReturnType<typeof referencePageSchema.parse>;
