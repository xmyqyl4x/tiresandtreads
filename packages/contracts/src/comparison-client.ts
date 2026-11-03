import { createApiClient } from './transport.ts';
import {
  ownerComparisonView,
  quotePageView,
  privateQuoteView,
  sharedReportView,
  actionReceipt,
  tokenReceipt,
} from './comparison-views.ts';
import { quoteInputSchema, type QuoteInput } from './quote-input.ts';
export type Selection = { kind: 'catalog' | 'quote'; key: string };
export function createComparisonClient(origin: string, send: typeof fetch = fetch) {
  const api = createApiClient(origin, send),
    id = (v: string) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
        throw Error('Invalid identifier');
      return v.toLowerCase();
    },
    path = (report: string) => '/api/v1/reports/' + id(report);
  const post = (url: string, body: unknown, csrf: string, key: string, method = 'POST') =>
    api.request<unknown>(url, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': key },
      body: JSON.stringify(body),
    });
  const own = (report: string, raw: unknown) => {
    const r = actionReceipt.parse(raw);
    if (r.report_id !== id(report)) throw Error('Invalid command receipt');
    return r;
  };
  const validToken = (r: ReturnType<typeof tokenReceipt.parse>, purpose: 'share' | 'download') => {
    const parts = r.token.split('.'),
      expiry = Date.parse(r.expires_at);
    return (
      parts.length === 4 &&
      parts[0] === purpose &&
      /^[A-Za-z0-9_-]{1,100}$/.test(parts[1] ?? '') &&
      parts[2] === r.resource_id &&
      /^[a-f0-9]{64}$/.test(parts[3] ?? '') &&
      Number.isFinite(expiry) &&
      new Date(expiry).toISOString() === r.expires_at &&
      expiry > Date.now()
    );
  };
  return {
    async quotes(report: string, after: string | null = null) {
      const r = quotePageView.parse(
        (
          await api.request<unknown>(
            path(report) + '/quotes' + (after ? '?after=' + encodeURIComponent(after) : ''),
            { credentials: 'same-origin' },
          )
        ).data,
      );
      if (r.reportId !== id(report)) throw Error('Invalid quote page');
      return r;
    },
    async quote(report: string, quote: string) {
      const r = privateQuoteView.parse(
        (
          await api.request<unknown>(path(report) + '/quotes/' + id(quote), {
            credentials: 'same-origin',
          })
        ).data,
      );
      if (r.quote.id !== id(quote)) throw Error('Invalid quote');
      return r;
    },
    async saveQuote(report: string, body: QuoteInput, csrf: string, key: string) {
      quoteInputSchema.parse(body);
      const r = own(report, (await post(path(report) + '/quotes', body, csrf, key)).data);
      if (r.status !== 'accepted' || !r.result_revision) throw Error('Invalid quote receipt');
      return r;
    },
    async compare(
      report: string,
      body: { version: number; expectedRevision: string | null; items: Selection[] },
      csrf: string,
      key: string,
    ) {
      const r = own(report, (await post(path(report) + '/compare', body, csrf, key)).data);
      if (
        !r.result_revision ||
        r.resource_id !== id(report) ||
        r.report_version !== body.version ||
        r.status !== 'accepted'
      )
        throw Error('Invalid comparison receipt');
      return r;
    },
    async comparison(report: string, version: number, revision: string) {
      if (!/^[1-9][0-9]{0,18}$/.test(revision) || !Number.isInteger(version) || version < 1)
        throw Error('Invalid comparison reference');
      const r = ownerComparisonView.parse(
        (
          await api.request<unknown>(
            path(report) + '/comparisons/' + revision + '?version=' + version,
            { credentials: 'same-origin' },
          )
        ).data,
      );
      if (r.reportId !== id(report) || r.version !== version || r.comparison.revision !== revision)
        throw Error('Invalid comparison');
      return r;
    },
    async share(
      report: string,
      body: { version: number | null; comparisonRevision: string | null },
      csrf: string,
      key: string,
    ) {
      const r = tokenReceipt.parse((await post(path(report) + '/shares', body, csrf, key)).data);
      if (
        r.report_id !== id(report) ||
        (body.version !== null && r.report_version !== body.version) ||
        !validToken(r, 'share')
      )
        throw Error('Invalid share receipt');
      return r;
    },
    async revoke(report: string, capability: string, csrf: string, key: string) {
      const r = own(
        report,
        (await post(path(report) + '/shares/' + id(capability), {}, csrf, key, 'DELETE')).data,
      );
      if (r.resource_id !== id(capability) || r.status !== 'accepted')
        throw Error('Invalid revoke receipt');
      return r;
    },
    async shared(token: string) {
      if (!token.startsWith('share.') || token.length > 256)
        throw Error('Invalid shared reference');
      return sharedReportView.parse(
        (
          await api.request<unknown>('/api/v1/shared', {
            headers: { authorization: 'Bearer ' + token },
            credentials: 'omit',
          })
        ).data,
      );
    },
    async ownerPdf(report: string, version: number, assetId: string, csrf: string, key: string) {
      const r = tokenReceipt.parse(
        (await post(path(report) + '/pdf', { version, assetId: id(assetId) }, csrf, key)).data,
      );
      if (r.report_id !== id(report) || r.report_version !== version || !validToken(r, 'download'))
        throw Error('Invalid PDF grant');
      return r;
    },
    async sharedPdf(token: string, assetId: string, key: string) {
      const r = tokenReceipt.parse(
        (
          await api.request<unknown>('/api/v1/shared/pdf', {
            method: 'POST',
            credentials: 'omit',
            headers: {
              authorization: 'Bearer ' + token,
              'content-type': 'application/json',
              'idempotency-key': key,
            },
            body: JSON.stringify({ assetId: id(assetId) }),
          })
        ).data,
      );
      if (!validToken(r, 'download')) throw Error('Invalid PDF grant');
      return r;
    },
    async download(token: string) {
      if (!token.startsWith('download.') || token.length > 256) throw Error('Invalid PDF grant');
      const response = await send(new URL('/api/v1/download', origin), {
        headers: { authorization: 'Bearer ' + token },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/pdf')
        throw Error('PDF unavailable');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 10485760))
        throw Error('PDF too large');
      const reader = response.body?.getReader();
      if (!reader) throw Error('PDF unavailable');
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          total += item.value.byteLength;
          if (total > 10485760) {
            await reader.cancel();
            throw Error('PDF too large');
          }
          chunks.push(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (
        bytes.length < 5 ||
        bytes.length > 10485760 ||
        new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
      )
        throw Error('PDF unavailable');
      return bytes;
    },
  };
}
