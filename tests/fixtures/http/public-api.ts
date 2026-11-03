import { createReferenceQuery } from '../../../packages/application/src/queries/reference.ts';
import { createHttpApi } from '../../../packages/integrations/src/http/core.ts';
import { publicOwnerRoutes } from '../../../packages/integrations/src/http/public-owner.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { createLocalHttpSecurity } from '../../../packages/integrations/src/http/security.ts';
import { fixtureReportServices } from './report-services.ts';
import { privateFixture } from '../private/database.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';

export async function publicApiFixture() {
  const db = await privateFixture();
  try {
    await db.admin.query(
      "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES('local_http','1',60,1000,true)",
    );
    const { reports, crypto } = fixtureReportServices(db);
    const limiterScope = db.adapter('tt_limiter_runtime');
    let security = createLocalHttpSecurity({
      owners: db.scope,
      limiter: limiterScope,
      secret: new Uint8Array(32).fill(99),
      keyVersion: 'http-v1',
    });
    const lookup = createReferenceQuery(db.readScope.unitOfWork, db.catalog);
    const server = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        security: {
          authenticate: (request) => security.security.authenticate(request),
          quota: (peer, operation) => security.security.quota(peer, operation),
        },
        routes: [
          ...security.sessions.map((route) => ({
            ...route,
            handle: (c: Parameters<typeof route.handle>[0]) =>
              security.sessions
                .find((current) => current.operationId === route.operationId)!
                .handle(c),
          })),
          ...publicOwnerRoutes({
            reports,
            shareKeys: (token) => crypto.lookup('share', token),
            lookup,
            content: async () => ok({ coverage: 'unavailable' }),
            download: async () => ({
              ok: false,
              error: { code: 'not_found', messageKey: 'errors.not_found', retryable: false },
            }),
          }),
        ],
      }),
    );
    async function session() {
      const r = await fetch(server.origin + '/api/v1/sessions', {
        method: 'POST',
        headers: { origin: server.origin, 'content-type': 'application/json' },
        body: '{}',
      });
      if (r.status !== 200) throw Error('Fixture session failed');
      const body = (await r.json()) as { data: { csrf: string } };
      return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: body.data.csrf };
    }
    async function call(
      path: string,
      session?: { cookie: string; csrf: string },
      body?: unknown,
      command = 'synthetic_command_001',
    ) {
      return fetch(server.origin + '/api/v1' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: server.origin,
          'content-type': 'application/json',
          'idempotency-key': command,
          ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    return {
      db,
      server,
      session,
      call,
      rotateSecurity(keyVersion: string, retainedKeys: Readonly<Record<string, Uint8Array>>) {
        security = createLocalHttpSecurity({
          owners: db.scope,
          limiter: limiterScope,
          secret: retainedKeys[keyVersion]!,
          keyVersion,
          retainedKeys,
        });
      },
      async cleanup() {
        try {
          await server.close();
        } finally {
          await db.cleanup();
        }
      },
    };
  } catch (error) {
    await db.cleanup();
    throw error;
  }
}
