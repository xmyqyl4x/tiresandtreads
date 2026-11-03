import { callbackInputSchemas as input } from '../../../contracts/src/callback-inputs.ts';
import { ok, fail, id, type Id } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type { createLocalServiceHost } from '../service-host.ts';
import { verifySvixBytes } from '../resend-webhook.ts';
import {
  HttpSuccess,
  HttpRedirect,
  HttpFailure,
  type HttpContext,
  type HttpRoute,
} from './core.ts';
import { decodeCallbackKeys, type LocalCallbackKeys } from './callback-key-values.ts';
export type { LocalCallbackKeys } from './callback-key-values.ts';
import type { createConfirmationQuery } from '../../../application/src/queries/confirmation.ts';
export type CallbackServices = Pick<
  Awaited<ReturnType<typeof createLocalServiceHost>>['services'],
  'mail' | 'actions' | 'analytics' | 'commercial'
>;
export function callbackRoutes(d: {
  readonly services: CallbackServices;
  readonly keys: LocalCallbackKeys;
  readonly confirmation: ReturnType<typeof createConfirmationQuery>;
  readonly wake: (jobId: Id<'job'>) => Promise<unknown>;
  readonly now: () => string;
}): readonly HttpRoute[] {
  const s = d.services,
    keys = decodeCallbackKeys(d.keys),
    invalid = () => fail(failure('invalid_input')),
    unavailable = () => fail(failure('unavailable', true));
  const route = (
    operationId: string,
    path: string,
    method: HttpRoute['method'],
    access: HttpRoute['access'],
    handle: HttpRoute['handle'],
    extra: Partial<Pick<HttpRoute, 'bodyMode' | 'maxBodyBytes' | 'successStatuses'>> = {},
  ): HttpRoute => ({
    operationId,
    path,
    method,
    access,
    handle: (c) => (c.query.size ? Promise.resolve(invalid()) : handle(c)),
    ...extra,
  });
  const proof = (c: HttpContext) => {
    const header = c.request.headers.get('authorization'),
      bearer = header?.startsWith('Bearer ') && header.length <= 4096 ? header.slice(7) : '';
    if (c.params.token) {
      if (c.params.token.length > 512 || (bearer && bearer !== c.params.token))
        throw new HttpFailure(400, 'ambiguous_credentials');
      return c.params.token;
    }
    return bearer;
  };
  const preferences = (c: HttpContext) => s.actions.preferences(proof(c), 'GET');
  const confirm = (c: HttpContext) =>
    input.confirmEmail.safeParse(c.body).success
      ? s.actions.confirm(proof(c), 'POST')
      : Promise.resolve(invalid());
  const withdraw = (c: HttpContext) =>
    input.withdrawEmail.safeParse(c.body).success
      ? s.actions.withdraw(proof(c), 'POST')
      : Promise.resolve(invalid());
  const oneClick = (c: HttpContext) =>
    s.actions.oneClick(proof(c), 'POST', c.body as Readonly<Record<string, unknown>>);
  return [
    route(
      'receiveMailCallback',
      '/api/v1/webhooks/resend',
      'POST',
      'callback',
      async (c) => {
        if (!keys.mail.length) return unavailable();
        if (!(c.body instanceof Uint8Array)) return invalid();
        // Loading the database runtime is unnecessary during contract generation.
        const { createResendWebhookIngress } = await import('../mail-events-runtime.ts');
        const result = await createResendWebhookIngress({
          services: s.mail,
          secrets: keys.mail,
          now: d.now,
        }).receive(c.body, Object.fromEntries(c.request.headers));
        return result.ok ? ok(new HttpSuccess(202, result.value)) : result;
      },
      { bodyMode: 'bytes', maxBodyBytes: 262144, successStatuses: [202] },
    ),
    route(
      'wakeDurableJob',
      '/api/v1/workflows/wake',
      'POST',
      'callback',
      async (c) => {
        if (!keys.workflow.length) return unavailable();
        let jobId: Id<'job'>;
        try {
          if (!(c.body instanceof Uint8Array)) return invalid();
          verifySvixBytes(c.body, Object.fromEntries(c.request.headers), keys.workflow, d.now());
          const value = input.wakeDurableJob.safeParse(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(c.body)),
          );
          if (!value.success || c.request.headers.get('svix-id') !== 'job_' + value.data.jobId)
            return invalid();
          const job = id('job', value.data.jobId);
          if (!job.ok) return invalid();
          jobId = job.value;
        } catch {
          return invalid();
        }
        await d.wake(jobId);
        return ok(new HttpSuccess(202, { accepted: true }));
      },
      { bodyMode: 'bytes', maxBodyBytes: 8192, successStatuses: [202] },
    ),
    route('issueAnalyticsGrant', '/api/v1/analytics/grants', 'POST', 'owner', (c) => {
      const value = input.issueAnalyticsGrant.safeParse(c.body);
      return value.success
        ? s.analytics.issue(
            c.actor!.keys,
            {
              gpc: c.request.headers.get('sec-gpc') === '1',
              cmpAvailable: value.data.cmpAvailable,
            },
            value.data.channel,
          )
        : Promise.resolve(invalid());
    }),
    route(
      'collectEvents',
      '/api/v1/collect',
      'POST',
      'capability',
      async (c) => {
        if (!(c.body instanceof Uint8Array)) return invalid();
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(c.body);
        } catch {
          return invalid();
        }
        const result = await s.analytics.collect(proof(c), text, {
          ip: c.peer,
          gpc: c.request.headers.get('sec-gpc') === '1',
          cmpAvailable: c.request.headers.get('x-tt-cmp-available') === 'true',
          bot: 'unknown',
        });
        if (!result.ok) return result;
        if (result.value.status === 'limited') {
          c.responseHeaders.set(
            'retry-after',
            String(Math.min(3600, Math.max(1, result.value.retryAfterSeconds ?? 60))),
          );
          throw new HttpFailure(429, 'rate_limited');
        }
        return ok(
          result.value.status === 'accepted'
            ? new HttpSuccess(202, result.value)
            : new HttpSuccess(204),
        );
      },
      { bodyMode: 'bytes', maxBodyBytes: 65536, successStatuses: [202, 204] },
    ),
    route('getEmailPreferences', '/api/v1/email/preferences', 'GET', 'capability', preferences),
    route('confirmEmail', '/api/v1/email/confirm', 'POST', 'capability', confirm),
    route('withdrawEmail', '/api/v1/email/withdraw', 'POST', 'capability', withdraw),
    route('getEmailConfirmation', '/api/v1/email/confirmation', 'GET', 'capability', (c) =>
      d.confirmation(proof(c)),
    ),
    route('readEmailConfirmation', '/email/confirm/:token', 'GET', 'capability', (c) =>
      d.confirmation(proof(c)),
    ),
    route('confirmEmailLink', '/email/confirm/:token', 'POST', 'capability', confirm),
    route('readEmailUnsubscribe', '/email/unsubscribe/:token', 'GET', 'capability', preferences),
    route('oneClickUnsubscribe', '/email/unsubscribe/:token', 'POST', 'callback', oneClick, {
      bodyMode: 'form',
      maxBodyBytes: 8192,
    }),
    route('oneClickUnsubscribeApi', '/api/v1/unsubscribe/:token', 'POST', 'callback', oneClick, {
      bodyMode: 'form',
      maxBodyBytes: 8192,
    }),
    route('readPreferences', '/preferences/:token', 'GET', 'capability', preferences),
    route('updatePreferences', '/preferences/:token', 'POST', 'capability', (c) => {
      const value = input.updatePreferences.safeParse(c.body);
      return value.success
        ? value.data.action === 'confirm'
          ? s.actions.confirm(proof(c), 'POST')
          : s.actions.withdraw(proof(c), 'POST')
        : Promise.resolve(invalid());
    }),
    route(
      'visitEmailLink',
      '/e/c/:token',
      'GET',
      'capability',
      async (c) => {
        const result = await s.actions.visit(proof(c), 'GET');
        return result.ok && result.value.kind === 'redirect'
          ? ok(new HttpRedirect(result.value.destination))
          : result;
      },
      { successStatuses: [200, 302] },
    ),
    ...[
      ['recordEmailFeedback', '/api/v1/email/feedback'],
      ['recordEmailLinkFeedback', '/e/c/:token/feedback'],
    ].map(([operation, path]) =>
      route(operation!, path!, 'POST', 'capability', (c) => {
        const value = input.recordEmailFeedback.safeParse(c.body);
        return value.success
          ? s.actions.feedback(proof(c), value.data.value, 'POST')
          : Promise.resolve(invalid());
      }),
    ),
    route(
      'redirectAffiliate',
      '/go/:linkId',
      'GET',
      'public',
      async (c) => {
        const result = await s.commercial.resolveAffiliate(c.params.linkId ?? '', 'US');
        return result.ok
          ? result.value
            ? ok(new HttpRedirect(result.value.destination))
            : fail(failure('not_found'))
          : result;
      },
      { successStatuses: [302] },
    ),
  ];
}
