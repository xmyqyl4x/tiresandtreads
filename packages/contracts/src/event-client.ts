import { createApiClient } from './http.ts';
import { callbackInputSchemas, collectionBatchSchema } from './callback-inputs.ts';
import type { z } from 'zod';
type Batch = z.input<typeof collectionBatchSchema>;
export function createEventClient(base: string, transport: typeof fetch = fetch) {
  const api = createApiClient(base, transport),
    headers = (proof: string) => ({ authorization: 'Bearer ' + proof });
  const post = (path: string, proof: string, body: unknown) =>
    api.request(path, {
      method: 'POST',
      headers: { ...headers(proof), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    grant: (input: z.input<typeof callbackInputSchemas.issueAnalyticsGrant>, csrf: string) =>
      api.request<
        { readonly status: 'issued'; readonly token: string } | { readonly status: 'refused' }
      >('/api/v1/analytics/grants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(callbackInputSchemas.issueAnalyticsGrant.parse(input)),
      }),
    collect: (proof: string, batch: Batch, cmpAvailable: boolean) => {
      const body = collectionBatchSchema.parse(batch);
      return api.requestOptional<{ readonly status: 'accepted'; readonly inserted: number }>(
        '/api/v1/collect',
        {
          method: 'POST',
          headers: {
            ...headers(proof),
            'content-type': 'application/json',
            'x-tt-cmp-available': String(cmpAvailable),
          },
          body: JSON.stringify(body),
        },
      );
    },
    preferences: (proof: string) =>
      api.request<{ readonly purpose: string; readonly status: string }>(
        '/api/v1/email/preferences',
        { headers: headers(proof) },
      ),
    confirmation: (proof: string) =>
      api.request<{
        readonly purpose: string;
        readonly status: string;
        readonly expired: boolean;
        readonly expiresAt: string;
      }>('/api/v1/email/confirmation', { headers: headers(proof) }),
    confirm: (proof: string) => post('/api/v1/email/confirm', proof, {}),
    withdraw: (proof: string) => post('/api/v1/email/withdraw', proof, {}),
    feedback: (proof: string, value: 'yes' | 'no') =>
      post(
        '/api/v1/email/feedback',
        proof,
        callbackInputSchemas.recordEmailFeedback.parse({ value }),
      ),
  };
}
