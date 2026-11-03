import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createOwnerRepository } from '../../../db/src/repositories/owners.ts';
import { createLimiterRepository } from '../../../db/src/repositories/limiter.ts';
import type { createTransactions } from '../../../db/src/transactions.ts';
import { id, instant, ok } from '../../../domain/src/values/core.ts';
import type { HttpActor, HttpSecurity, HttpRoute } from './core.ts';
import { sessionContracts } from '../../../contracts/src/http.ts';

type Scope = ReturnType<typeof createTransactions>;
export function createLocalHttpSecurity(d: {
  readonly owners: Scope;
  readonly limiter: Scope;
  readonly secret: Uint8Array;
  readonly keyVersion: string;
  readonly now?: () => number;
}) {
  if (d.secret.length < 32 || !/^[a-zA-Z0-9_-]{1,80}$/.test(d.keyVersion))
    throw Error('Invalid local HTTP security');
  const owners = createOwnerRepository(d.owners),
    limiter = createLimiterRepository(d.limiter, [d.keyVersion]);
  const now = d.now ?? Date.now;
  const hash = (purpose: string, token: string) =>
    createHmac('sha256', d.secret)
      .update('local-http:v1\0' + purpose + '\0' + token)
      .digest('hex');
  const keys = (token: string) => [{ keyVersion: d.keyVersion, digest: hash('owner', token) }];
  function bearer(request: Request) {
    const authorization = request.headers.get('authorization');
    if (authorization)
      return /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) ? authorization.slice(7) : null;
    const cookies =
      request.headers
        .get('cookie')
        ?.split(';')
        .map((c) => c.trim())
        .filter((c) => c.startsWith('tt_owner=')) ?? [];
    return cookies.length === 1 && /^tt_owner=[A-Za-z0-9_-]{43}$/.test(cookies[0]!)
      ? cookies[0]!.slice(9)
      : null;
  }
  const security: HttpSecurity = {
    async authenticate(request): Promise<HttpActor | null> {
      const token = bearer(request);
      if (!token) return null;
      const result = await d.owners.unitOfWork.run(async (tx) =>
        ok(await owners.resolve(tx, keys(token))),
      );
      if (!result.ok || !result.value) return null;
      return { keys: keys(token), csrf: hash('csrf', token) };
    },
    async quota(peer) {
      const result = await d.limiter.unitOfWork.run(async (tx) =>
        ok(
          await limiter.consume(tx, [
            {
              policy: 'local_http',
              version: '1',
              keys: [{ keyVersion: d.keyVersion, digest: hash('peer', peer) }],
            },
          ]),
        ),
      );
      if (!result.ok) throw Error('Local HTTP admission unavailable');
      return result.value;
    },
  };
  const sessions: readonly HttpRoute[] = [
    {
      ...sessionContracts[0],
      async handle(c) {
        if (
          !c.body ||
          typeof c.body !== 'object' ||
          Array.isArray(c.body) ||
          Object.keys(c.body).length
        )
          return {
            ok: false,
            error: { code: 'invalid_input', messageKey: 'errors.invalid_input', retryable: false },
          };
        const token = randomBytes(32).toString('base64url'),
          subject = id('subject', randomUUID()),
          session = id('owner_session', randomUUID()),
          expires = instant(new Date(now() + 86400000).toISOString());
        if (!subject.ok || !session.ok || !expires.ok) throw Error('Session unavailable');
        const result = await d.owners.unitOfWork.run(async (tx) =>
          ok(
            await owners.create(tx, {
              owner: { subjectId: subject.value, sessionId: session.value },
              key: keys(token)[0]!,
              expiresAt: expires.value,
            }),
          ),
        );
        if (!result.ok) return result;
        c.responseHeaders.set(
          'set-cookie',
          `tt_owner=${token}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=86400`,
        );
        return ok({ csrf: hash('csrf', token), expiresAt: expires.value, mode: 'local-only' });
      },
    },
    {
      ...sessionContracts[1],
      async handle(c) {
        return ok({ csrf: c.actor!.csrf, mode: 'local-only' });
      },
    },
  ];
  return { security, sessions };
}
