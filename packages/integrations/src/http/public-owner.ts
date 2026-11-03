import { toolInputSchema } from '../../../contracts/src/http.ts';
import { reportInputSchemas, type ReportOperation } from '../../../contracts/src/report-inputs.ts';
import { ok, fail } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type { createReportServices } from '../../../application/src/services/reports.ts';
import { PrivateDownload, type HttpRoute } from './core.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure } from '../../../application/src/ports/transactions.ts';
import { decodeSize, checklist, scorecard } from '../../../domain/src/public-policy.ts';

export function publicOwnerRoutes(d: {
  readonly reports: ReturnType<typeof createReportServices>;
  readonly shareKeys: (token: string) => readonly { keyVersion: string; digest: string }[];
  readonly lookup: (query: URLSearchParams) => Promise<Result<unknown, ApplicationFailure>>;
  readonly content: (query: URLSearchParams) => Promise<Result<unknown, ApplicationFailure>>;
  readonly download: (
    token: string,
  ) => Promise<Result<{ bytes: Uint8Array; mime: string }, ApplicationFailure>>;
}): readonly HttpRoute[] {
  const route = (
    operationId: string,
    path: string,
    method: HttpRoute['method'],
    access: HttpRoute['access'],
    handle: HttpRoute['handle'],
    command = false,
  ): HttpRoute => ({
    operationId,
    path: '/api/v1' + path,
    method,
    access,
    handle: async (c) => {
      const schema = reportInputSchemas[operationId as ReportOperation];
      if (schema && !schema.safeParse(c.body).success) return fail(failure('invalid_input'));
      return handle(c);
    },
    command,
  });
  const reports = d.reports;
  const token = (request: Request) => {
    const value = request.headers.get('authorization');
    return value?.startsWith('Bearer ') && value.length <= 512 ? d.shareKeys(value.slice(7)) : [];
  };
  return [
    route('downloadPdf', '/download', 'GET', 'capability', async (c) => {
      const authorization = c.request.headers.get('authorization');
      const result = await d.download(
        authorization?.startsWith('Bearer ') ? authorization.slice(7) : '',
      );
      return result.ok ? ok(new PrivateDownload(result.value.bytes, result.value.mime)) : result;
    }),
    route('lookupReference', '/reference', 'GET', 'public', (c) => d.lookup(c.query)),
    route('getContent', '/content', 'GET', 'public', (c) => d.content(c.query)),
    ...(['size', 'checklist', 'scorecard'] as const).map((kind) =>
      route('tool' + kind, '/tools/' + kind, 'POST', 'public', async (c) => {
        const parsed = toolInputSchema.safeParse(c.body);
        if (!parsed.success) return fail(failure('invalid_input'));
        try {
          return ok(
            kind === 'size'
              ? decodeSize(parsed.data.input)
              : kind === 'checklist'
                ? checklist(parsed.data.input as Parameters<typeof checklist>[0])
                : scorecard(parsed.data.input as Parameters<typeof scorecard>[0]),
          );
        } catch {
          return fail(failure('invalid_input'));
        }
      }),
    ),
    route(
      'createReport',
      '/reports',
      'POST',
      'owner',
      (c) => reports.create(c.actor!.keys, c.key, c.body),
      true,
    ),
    route('readReport', '/reports/:reportId', 'GET', 'owner', (c) =>
      reports.readOwner(
        c.actor!.keys,
        c.params.reportId,
        c.query.has('version') ? Number(c.query.get('version')) : null,
      ),
    ),
    route(
      'saveDraft',
      '/reports/:reportId/draft',
      'POST',
      'owner',
      (c) => reports.saveDraft(c.actor!.keys, c.params.reportId, c.key, c.body),
      true,
    ),
    route(
      'refineReport',
      '/reports/:reportId/refine',
      'POST',
      'owner',
      (c) => reports.refine(c.actor!.keys, c.params.reportId, c.key, c.body),
      true,
    ),
    route(
      'compareReport',
      '/reports/:reportId/compare',
      'POST',
      'owner',
      (c) => reports.compare(c.actor!.keys, c.params.reportId, c.key, c.body),
      true,
    ),
    route(
      'saveQuote',
      '/reports/:reportId/quotes',
      'POST',
      'owner',
      (c) => reports.saveQuote(c.actor!.keys, c.params.reportId, c.key, c.body),
      true,
    ),
    route('readQuote', '/reports/:reportId/quotes/:quoteId', 'GET', 'owner', (c) =>
      reports.readQuote(c.actor!.keys, c.params.reportId, c.params.quoteId),
    ),
    route('readComparison', '/reports/:reportId/comparisons/:revision', 'GET', 'owner', (c) =>
      reports.readComparison(
        c.actor!.keys,
        c.params.reportId,
        Number(c.query.get('version')),
        c.params.revision,
      ),
    ),
    route(
      'shareReport',
      '/reports/:reportId/shares',
      'POST',
      'owner',
      (c) => reports.share(c.actor!.keys, c.params.reportId, c.key, c.body),
      true,
    ),
    route(
      'revokeShare',
      '/reports/:reportId/shares/:capabilityId',
      'DELETE',
      'owner',
      (c) => reports.revoke(c.actor!.keys, c.params.reportId, c.key, c.params.capabilityId),
      true,
    ),
    route('readSharedReport', '/shared', 'GET', 'capability', (c) =>
      reports.readShared(token(c.request)),
    ),
    route(
      'forkReport',
      '/shared/fork',
      'POST',
      'owner',
      (c) =>
        reports.fork(
          c.actor!.keys,
          c.key,
          d.shareKeys(c.request.headers.get('x-share-token') ?? ''),
          c.body,
        ),
      true,
    ),
    route(
      'ownerPdf',
      '/reports/:reportId/pdf',
      'POST',
      'owner',
      (c) => reports.ownerDownload(c.actor!.keys, c.params.reportId, c.key, c.body),
      true,
    ),
    route(
      'sharedPdf',
      '/shared/pdf',
      'POST',
      'capability',
      (c) => reports.sharedDownload(token(c.request), c.key, c.body),
      true,
    ),
  ];
}
