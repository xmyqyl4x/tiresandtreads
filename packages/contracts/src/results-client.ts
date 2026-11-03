import { createApiClient } from './transport.ts';
import { ownerReportView, draftView, reportCommandView } from './report-views.ts';
import { assessmentInputSchema } from './assessment-input.ts';
import type { AssessmentRequest, ReportInput } from './report-inputs.ts';
export function createResultsClient(origin: string, send: typeof fetch = fetch) {
  const api = createApiClient(origin, send);
  const path = (id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw Error('Invalid report identifier');
    return '/api/v1/reports/' + id;
  };
  const command = async (id: string, suffix: string, body: unknown, csrf: string, key: string) => {
    const r = reportCommandView.parse(
      (
        await api.request<unknown>(path(id) + suffix, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf,
            'idempotency-key': key,
          },
          body: JSON.stringify(body),
        })
      ).data,
    );
    if (r.report_id !== id || r.resource_id !== id) throw Error('Invalid report receipt');
    return r;
  };
  return {
    async read(id: string, version?: number) {
      if (
        version !== undefined &&
        (!Number.isInteger(version) || version < 1 || version > 2147483647)
      )
        throw Error('Invalid report version');
      const r = ownerReportView.parse(
        (
          await api.request<unknown>(path(id) + (version ? '?version=' + version : ''), {
            credentials: 'same-origin',
          })
        ).data,
      );
      if (r.reportId !== id || (version && r.version !== version))
        throw Error('Invalid report view');
      return r;
    },
    async draft(id: string) {
      const r = draftView.parse(
        (await api.request<unknown>(path(id) + '/draft', { credentials: 'same-origin' })).data,
      );
      if (r.reportId !== id) throw Error('Invalid draft view');
      return r.draft;
    },
    save: (
      id: string,
      body: { baseVersion: number; expectedRevision: string | null; input: AssessmentRequest },
      csrf: string,
      key: string,
    ) => {
      assessmentInputSchema.parse(body.input);
      return command(id, '/draft', body, csrf, key);
    },
    refine: (id: string, body: ReportInput<'refineReport'>, csrf: string, key: string) =>
      command(id, '/refine', body, csrf, key),
  };
}
