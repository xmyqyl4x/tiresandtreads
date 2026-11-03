import { z } from 'zod';
import { createApiClient } from './http.ts';
import { consentInputSchemas } from './consent-inputs.ts';
import { staffInputSchemas } from './staff-inputs.ts';
import type { CommandReceipt } from './report-client.ts';
type ConsentInput<K extends keyof typeof consentInputSchemas> = z.input<
  (typeof consentInputSchemas)[K]
>;
type StaffInput<K extends keyof typeof staffInputSchemas> = z.input<(typeof staffInputSchemas)[K]>;
export interface DeliveryView {
  readonly id: string;
  readonly revision: string;
  readonly state: string;
  readonly sendAfter: string;
  readonly cancelDeadline: string;
}
export interface PrivacyView {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly dueAt: string;
  readonly completedAt: string | null;
}
interface ConsentReplies {
  requestContact: CommandReceipt;
  requestDelivery: DeliveryView;
  cancelDelivery: DeliveryView;
  setBrowserConsent: CommandReceipt;
  requestOwnerRights: { readonly id: string; readonly proof: string };
  requestEmailRights: { readonly accepted: true };
  confirmPrivacyProof: { readonly verified: true };
}
export interface LocalCommand {
  readonly csrf: string;
  readonly key: string;
}
const resource = (value: string) => {
  if (
    !z.string().uuid().safeParse(value).success ||
    value === '00000000-0000-0000-0000-000000000000'
  )
    throw Error('Invalid resource');
  return value;
};
export function createConsentClient(base: string, transport: typeof fetch = fetch) {
  const api = createApiClient(base, transport);
  const post = <K extends keyof typeof consentInputSchemas>(
    operation: K,
    path: string,
    body: ConsentInput<K>,
    command?: LocalCommand,
    bearer?: string,
  ) => {
    const value = consentInputSchemas[operation].parse(body);
    return api.request<ConsentReplies[K]>(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(command ? { 'x-csrf-token': command.csrf, 'idempotency-key': command.key } : {}),
        ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
      },
      body: JSON.stringify(value),
    });
  };
  return {
    policy: () =>
      api.request<{
        readonly version: string;
        readonly notices: Readonly<
          Record<'necessary' | 'report' | 'offers' | 'analytics' | 'ads' | 'targeted_ads', string>
        >;
      }>('/api/v1/consent/policy'),
    contact: (input: ConsentInput<'requestContact'>, command: LocalCommand) =>
      post('requestContact', '/api/v1/contacts', input, command),
    browser: (cmpAvailable = false) =>
      api.request('/api/v1/consent/browser' + (cmpAvailable ? '?cmpAvailable=true' : ''), {
        credentials: 'same-origin',
      }),
    choices: (input: ConsentInput<'setBrowserConsent'>, command: LocalCommand) =>
      post('setBrowserConsent', '/api/v1/consent/browser', input, command),
    deliver: (input: ConsentInput<'requestDelivery'>, command: LocalCommand) =>
      post('requestDelivery', '/api/v1/deliveries', input, command),
    delivery: (sendId: string) =>
      api.request<DeliveryView>('/api/v1/deliveries/' + resource(sendId), {
        credentials: 'same-origin',
      }),
    cancel: (sendId: string, input: ConsentInput<'cancelDelivery'>, command: LocalCommand) =>
      post('cancelDelivery', '/api/v1/deliveries/' + resource(sendId) + '/cancel', input, command),
    ownerRights: (input: ConsentInput<'requestOwnerRights'>, command: LocalCommand) =>
      post('requestOwnerRights', '/api/v1/privacy/owner-requests', input, command),
    emailRights: (input: ConsentInput<'requestEmailRights'>) =>
      post('requestEmailRights', '/api/v1/privacy/email-requests', input),
    privacyStatus: (proof: string) =>
      api.request<PrivacyView>('/api/v1/privacy/status', {
        headers: { authorization: 'Bearer ' + proof },
      }),
    confirmPrivacy: (proof: string) =>
      post('confirmPrivacyProof', '/api/v1/privacy/confirm', {}, undefined, proof),
  };
}
export function createStaffClient(
  base: string,
  session: { readonly bearer: string; readonly csrf: string },
  transport: typeof fetch = fetch,
) {
  const api = createApiClient(base, transport),
    headers = { authorization: 'Bearer ' + session.bearer };
  const get = (path: string, query: Readonly<Record<string, string | number | undefined>> = {}) => {
    const encoded = new URLSearchParams(
      Object.entries(query)
        .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    return api.request(path + (encoded.size ? '?' + encoded.toString() : ''), { headers });
  };
  const post = <K extends keyof typeof staffInputSchemas>(
    operation: K,
    path: string,
    input: StaffInput<K>,
    key: string,
  ) => {
    const body = staffInputSchemas[operation].parse(input);
    return api.request(path, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-csrf-token': session.csrf,
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
  };
  return {
    queue: (
      kind: 'mail' | 'callbacks' | 'imports' | 'privacy' | 'seo',
      query: { readonly limit?: number; readonly after?: string } = {},
    ) => get('/api/v1/staff/queues/' + kind, query),
    recover: (input: StaffInput<'recoverOperation'>, key: string) =>
      post('recoverOperation', '/api/v1/staff/recover', input, key),
    prepare: (input: StaffInput<'prepareImport'>, key: string) =>
      post('prepareImport', '/api/v1/staff/imports/prepare', input, key),
    importStatus: (runId: string) => get('/api/v1/staff/imports/' + resource(runId)),
    importDiff: (runId: string, against?: string) =>
      get('/api/v1/staff/imports/' + resource(runId) + '/diff', {
        against: against === undefined ? undefined : resource(against),
      }),
    publish: (runId: string, input: StaffInput<'publishImport'>, key: string) =>
      post('publishImport', '/api/v1/staff/imports/' + resource(runId) + '/publish', input, key),
    rollback: (input: StaffInput<'rollbackImport'>, key: string) =>
      post('rollbackImport', '/api/v1/staff/imports/rollback', input, key),
    content: (input: StaffInput<'enqueueContent'>, key: string) =>
      post('enqueueContent', '/api/v1/staff/content', input, key),
    auditSeo: (input: StaffInput<'auditSeo'>, key: string) =>
      post('auditSeo', '/api/v1/staff/seo/audit', input, key),
    seoMetrics: (query: {
      readonly path: string;
      readonly day: string;
      readonly locale?: 'en-US';
      readonly market?: 'US';
    }) => get('/api/v1/staff/seo/metrics', query),
    operations: (query: { readonly day: string; readonly dimension?: string }) =>
      get('/api/v1/staff/operations', query),
    revenue: (query: {
      readonly account: string;
      readonly day: string;
      readonly dimension?: string;
      readonly currency?: string;
    }) => get('/api/v1/staff/advertising/revenue', query),
  };
}
