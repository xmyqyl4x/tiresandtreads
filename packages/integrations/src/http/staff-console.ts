import {
  commercialPolicySchema,
  reportQueueViewSchema,
  sourceHealthViewSchema,
  strategicRegisterViewSchema,
  commercialConfigurationViewSchema,
  seoFindingsViewSchema,
  commercialPublishInputSchema,
  type z,
} from '../../../contracts/src/staff-console.ts';
import { id, ok, fail, type Id, type Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure } from '../../../application/src/ports/transactions.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type { createStaffConsoleRuntime } from '../staff-console-runtime.ts';
import type { createCommercialServices } from '../../../application/src/services/commercial.ts';
import type { HttpRoute, HttpSecurity } from './core.ts';
// Additional local console endpoints. The frozen 66-operation product inventory is unchanged.
export function staffConsoleRoutes(d: {
  readonly queries: ReturnType<typeof createStaffConsoleRuntime>;
  readonly commercial: ReturnType<typeof createCommercialServices>;
  readonly security: HttpSecurity;
  readonly now?: () => number;
}): readonly HttpRoute[] {
  const invalid = () => fail(failure('invalid_input'));
  const get = (key: string, fn: HttpRoute['handle']): HttpRoute => ({
    operationId: 'localStaff' + key,
    path: '/api/v1/staff-console/' + key,
    method: 'GET',
    access: 'staff',
    command: false,
    handle: fn,
  });
  const paged =
    (
      fn: (
        actor: Id<'staff'>,
        page: { limit: number; after: string | null },
      ) => Promise<Result<unknown, ApplicationFailure>>,
      schema: z.ZodType,
    ) =>
    async (c: Parameters<HttpRoute['handle']>[0]) => {
      if (
        [...c.query.keys()].some((k) => !['limit', 'after'].includes(k)) ||
        new Set(c.query.keys()).size !== [...c.query].length
      )
        return invalid();
      const result = await fn(c.actor!.staff!, {
        limit: Number(c.query.get('limit') ?? 25),
        after: c.query.get('after'),
      });
      if (!result.ok) return result;
      const parsed = schema.safeParse(result.value);
      return parsed.success ? ok(parsed.data) : fail(failure('integrity'));
    };
  const post = (key: string, handle: HttpRoute['handle']): HttpRoute => ({
    operationId: 'localStaff' + key,
    path: '/api/v1/staff-console/' + key,
    method: 'POST',
    access: 'staff',
    command: true,
    handle,
  });
  return [
    get('session', async (c) => {
      if (c.query.size) return invalid();
      const r = await d.queries.session(c.actor!.staff!);
      return r.ok ? ok({ csrf: c.actor!.csrf, staffId: c.actor!.staff!, localOnly: true }) : r;
    }),
    get('findings', paged(d.queries.findings, seoFindingsViewSchema)),
    get('reports', paged(d.queries.reports, reportQueueViewSchema)),
    get('sources', paged(d.queries.sources, sourceHealthViewSchema)),
    get('strategy', paged(d.queries.strategy, strategicRegisterViewSchema)),
    get('configuration', async (c) => {
      if (c.query.size) return invalid();
      const r = await d.queries.configuration(c.actor!.staff!);
      if (!r.ok) return r;
      const p = commercialConfigurationViewSchema.safeParse(r.value);
      return p.success ? ok(p.data) : fail(failure('integrity'));
    }),
    post('preview', async (c) => {
      if (c.query.size) return invalid();
      const p = commercialPolicySchema.safeParse(c.body);
      return p.success ? d.commercial.preview(c.actor!.staff!, p.data) : invalid();
    }),
    post('publish', async (c) => {
      if (c.query.size) return invalid();
      const p = commercialPublishInputSchema.safeParse(c.body);
      const credential = c.request.headers.get('x-reviewer-authorization');
      if (!p.success || !credential || !/^Bearer [A-Za-z0-9_-]{43}$/.test(credential))
        return invalid();
      const request = new Request(c.request.url, { headers: { authorization: credential } }),
        reviewer = await d.security.authenticate(request),
        now = (d.now ?? Date.now)();
      if (
        !reviewer?.staff ||
        reviewer.mfaAt === undefined ||
        reviewer.mfaAt > now ||
        now - reviewer.mfaAt > 300000 ||
        !id('staff', reviewer.staff).ok
      )
        return fail(failure('forbidden'));
      return d.commercial.publish(
        c.actor!.staff!,
        reviewer.staff,
        p.data.expectedVersion,
        p.data.policy,
      );
    }),
  ];
}
