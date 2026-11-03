import { createReportServices } from '../../../packages/application/src/services/reports.ts';
import { createReportAccessRepository } from '../../../packages/db/src/repositories/report-services.ts';
import { createCommandRepository } from '../../../packages/db/src/repositories/jobs.ts';
import { createReportCrypto } from '../../../packages/integrations/src/report-crypto.ts';
import { createLocalHttpSecurity } from '../../../packages/integrations/src/http/security.ts';
import { createReferenceQuery } from '../../../packages/application/src/queries/reference.ts';
import { createHttpApi } from '../../../packages/integrations/src/http/core.ts';
import { publicOwnerRoutes } from '../../../packages/integrations/src/http/public-owner.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { privateFixture, time } from '../private/database.ts';
import { engineFixture } from '../engine/base.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';

export async function publicApiFixture() {
  const db = await privateFixture();
  try {
    await db.admin.query(
      "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES('local_http','1',60,1000,true)",
    );
    const crypto = createReportCrypto(
      'http-v1',
      { 'http-v1': new Uint8Array(32).fill(41) },
      new Uint8Array(32).fill(87),
    );
    const encrypted = new Map<string, Uint8Array>();
    const reports = createReportServices({
      uow: db.scope.unitOfWork,
      owners: db.owners,
      reports: db.reports,
      capabilities: db.caps,
      access: createReportAccessRepository(db.scope),
      commands: createCommandRepository(db.scope),
      crypto,
      now: () => time(),
      evidence: {
        prepare: async (_input, asOf) => {
          const e = engineFixture();
          e.snapshot.bundleId = db.bundleId;
          e.snapshot.policy.id = db.ruleId;
          e.snapshot.asOf = asOf;
          e.snapshot.recall.checkedAt = asOf;
          return ok({ snapshot: e.snapshot, prices: [], products: [] });
        },
        current: async () => ok(true),
        overlay: async (_version, asOf) =>
          ok({ checkedAt: asOf, status: 'review_required', matched: [], unresolved: true }),
      },
      encryption: {
        encrypt: async (bytes, purpose, id) => {
          encrypted.set(purpose + id, bytes);
          return { keyVersion: 'synthetic-only', hex: 'c'.repeat(64) };
        },
        decrypt: async (_value, purpose, id) => encrypted.get(purpose + id)!,
      },
    });
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
