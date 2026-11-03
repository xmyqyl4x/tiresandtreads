import { createApiClient } from './transport.ts';
import type { AssessmentRequest, ReportInput } from './report-inputs.ts';
export interface CommandReceipt {
  readonly schema_version: 1;
  readonly resource_id: string;
  readonly status: string;
  readonly report_id?: string;
  readonly report_version?: number;
  readonly result_revision?: string;
  readonly token?: string;
  readonly expires_at?: string;
}
export function createReportClient(base: string, transport: typeof fetch = fetch) {
  const api = createApiClient(base, transport);
  const post = (path: string, body: unknown, csrf: string, key: string) =>
    api.request<CommandReceipt>(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': key },
      body: JSON.stringify(body),
    });
  const reportPath = (id: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('Invalid report identifier');
    return '/api/v1/reports/' + id;
  };
  return {
    create: (body: AssessmentRequest, csrf: string, key: string) =>
      post('/api/v1/reports', body, csrf, key),
    read: <T>(id: string) => api.request<T>(reportPath(id), { credentials: 'same-origin' }),
    draft: (id: string, body: ReportInput<'saveDraft'>, csrf: string, key: string) =>
      post(reportPath(id) + '/draft', body, csrf, key),
    refine: (id: string, body: ReportInput<'refineReport'>, csrf: string, key: string) =>
      post(reportPath(id) + '/refine', body, csrf, key),
    compare: (id: string, body: ReportInput<'compareReport'>, csrf: string, key: string) =>
      post(reportPath(id) + '/compare', body, csrf, key),
    quote: (id: string, body: ReportInput<'saveQuote'>, csrf: string, key: string) =>
      post(reportPath(id) + '/quotes', body, csrf, key),
    share: (id: string, body: ReportInput<'shareReport'>, csrf: string, key: string) =>
      post(reportPath(id) + '/shares', body, csrf, key),
    pdf: (id: string, body: ReportInput<'ownerPdf'>, csrf: string, key: string) =>
      post(reportPath(id) + '/pdf', body, csrf, key),
  };
}
