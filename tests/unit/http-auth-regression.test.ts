import { it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createLocalHttpSecurity } from '../../packages/integrations/src/http/security.ts';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
import type { createTransactions } from '../../packages/db/src/transactions.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
type Scope = ReturnType<typeof createTransactions>;
const uuid = '11111111-1111-4111-8111-111111111111',
  token = Buffer.alloc(32, 51).toString('base64url'),
  origin = 'http://127.0.0.1:3210';
const oldKey = new Uint8Array(32).fill(17),
  newKey = new Uint8Array(32).fill(18);
const hash = (secret: Uint8Array, purpose: string, value: string) =>
  createHmac('sha256', secret)
    .update('local-http:v1\0' + purpose + '\0' + value)
    .digest('hex');
const request = (method = 'GET', csrf?: string) =>
  new Request(origin + '/api/v1/reports', {
    method,
    headers: {
      cookie: 'tt_owner=' + token,
      origin,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
it('returns a retryable masked 503 when owner authentication is unavailable, without treating a valid cookie as invalid', async () => {
  const scope = {
    unitOfWork: { run: async () => fail(failure('timeout', true)) },
  } as unknown as Scope;
  const auth = createLocalHttpSecurity({
    owners: scope,
    limiter: scope,
    secret: oldKey,
    keyVersion: 'A',
  });
  const api = createHttpApi({
    origin,
    security: auth.security,
    routes: [
      {
        operationId: 'read',
        path: '/api/v1/reports',
        method: 'GET',
        access: 'owner',
        handle: async () => ok(null),
      },
    ],
  });
  const response = await api(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'unavailable', retryable: true });
});
it('resolves an existing owner across all retained keys and preserves its prior session CSRF', async () => {
  const query = vi.fn(async (_tx: unknown, _sql: string, params: unknown[]) => {
    const keys = JSON.parse(params[0] as string) as { key_version: string; digest: string }[];
    return {
      rows: keys.some((k) => k.key_version === 'A' && k.digest === hash(oldKey, 'owner', token))
        ? [{ id: uuid, subject_id: uuid }]
        : [],
    };
  });
  const scope = {
    query,
    unitOfWork: { run: async (fn: (tx: unknown) => unknown) => fn({}) },
    abort: () => {
      throw Error('unexpected abort');
    },
  } as unknown as Scope;
  const auth = createLocalHttpSecurity({
    owners: scope,
    limiter: scope,
    secret: newKey,
    keyVersion: 'B',
    retainedKeys: { A: oldKey, B: newKey },
  });
  const actor = await auth.security.authenticate(request());
  expect(actor).not.toBeNull();
  const api = createHttpApi({
    origin,
    security: { ...auth.security, quota: async () => ({ allowed: true }) },
    routes: [
      {
        operationId: 'write',
        path: '/api/v1/reports',
        method: 'POST',
        access: 'owner',
        handle: async () => ok(null),
      },
    ],
  });
  expect((await api(request('POST', hash(oldKey, 'csrf', token)))).status).toBe(200);
});
