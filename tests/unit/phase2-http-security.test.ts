import { expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { withPartnerSessions } from '../../packages/integrations/src/http/partner-security.ts';
import {
  p2Commands,
  p2Project,
  p2Id,
  p2Rev,
  p2Parse,
} from '../../packages/integrations/src/http/phase2-common.ts';
import { createHttpApi, type HttpContext } from '../../packages/integrations/src/http/core.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { z } from '../../packages/contracts/src/phase2-partners.ts';
const stamp = Date.now(),
  secret = randomBytes(32),
  csrf = 'synthetic-csrf',
  subject = 'local-subject',
  principal = {
    subject,
    emailVerified: true as const,
    emailDomain: 'example.test',
    staffId: null,
    mfaAt: new Date(stamp - 1000).toISOString(),
    expiresAt: new Date(stamp + 60000).toISOString(),
  },
  base = { authenticate: async () => null, quota: async () => ({ allowed: true }) };
it('requires a real injected authority proof and refuses stale or ambiguous sessions', async () => {
  const verify = vi.fn(async () => ok(principal)),
    s = withPartnerSessions(base, { verify } as never, secret, () => stamp),
    token = 'synthetic-session-12345';
  const a = await s.authenticate(
    new Request('http://127.0.0.1', { headers: { authorization: 'Bearer ' + token } }),
  );
  expect(a?.partner).toEqual({ handle: token, subject });
  expect(a?.keys).toEqual([]);
  expect(a?.csrf).toHaveLength(64);
  expect(
    await s.authenticate(
      new Request('http://127.0.0.1', {
        headers: { authorization: 'Bearer ' + token, cookie: 'tt_owner=other' },
      }),
    ),
  ).toBeNull();
  expect(verify).toHaveBeenCalledTimes(1);
});
it.each([0, 31])('refuses undersized command/session secrets (%s)', (n) => {
  expect(() =>
    withPartnerSessions(base, { verify: async () => ok(principal) } as never, new Uint8Array(n)),
  ).toThrow();
  expect(() => p2Commands({ claim: async () => true }, new Uint8Array(n))).toThrow();
});
it.each([
  'prompt',
  'bucket',
  'objectKey',
  'encryptedEmail',
  'seal',
  'providerRequestId',
  'subjectId',
])('never emits unselected private field %s', (field) => {
  expect(
    p2Project(
      ok({ id: 'safe', [field]: 'secret', nested: { value: 'allowed', other: 'secret' } }),
      ['id', 'nested.value'],
    ),
  ).toEqual(ok({ id: 'safe', nested: { value: 'allowed' } }));
});
it('projects safe list entries and propagates service denials', () => {
  expect(p2Project(ok([{ id: 1, secret: 2 }]), ['id'])).toEqual(ok({ items: [{ id: 1 }] }));
  expect(p2Project(fail({ code: 'forbidden' } as never), ['id'])).toEqual(
    fail({ code: 'forbidden' }),
  );
  expect(p2Project(ok(null), [])).toEqual(ok({ value: null }));
});
it.each([null, 'nope', 1, {}, '../../file'])('refuses malformed object identifiers %s', (value) =>
  expect(() => p2Id('report', value)).toThrow(),
);
it.each(['0', '-1', '1.5', null, {}, '999999999999999999999999'])(
  'refuses malformed expected revision %s',
  (value) => expect(() => p2Rev(value)).toThrow(),
);
it('refuses unknown fields before command admission', () =>
  expect(() =>
    p2Parse(z.strictObject({ id: z.uuid() }), { id: randomUUID(), actor: subject }),
  ).toThrow());
it('binds command identity to verified actor, operation, path and canonical payload and never repeats a duplicate', async () => {
  const seen = new Set<string>(),
    claim = vi.fn(async (h: string) => {
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    }),
    cmd = p2Commands({ claim }, secret),
    work = vi.fn(async () => ok({ id: 'safe' }));
  const context = {
    actor: { keys: [], csrf, partner: { subject, handle: 'private' } },
    key: 'synthetic-key-123456',
    params: { org: randomUUID() },
    query: new URLSearchParams(),
  } as unknown as HttpContext;
  expect(await cmd.execute(context, 'one', { b: 2, a: 1 }, work)).toEqual(ok({ id: 'safe' }));
  await expect(cmd.execute(context, 'one', { a: 1, b: 2 }, work)).rejects.toMatchObject({
    status: 409,
  });
  await expect(cmd.execute(context, 'one', { a: 2, b: 2 }, work)).rejects.toMatchObject({
    status: 409,
  });
  expect(work).toHaveBeenCalledTimes(1);
  expect(await cmd.execute(context, 'two', {}, work)).toEqual(ok({ id: 'safe' }));
  expect(cmd.id(context)).toMatch(/^[a-f0-9-]{36}$/);
  expect(claim.mock.calls[0]!.every((x) => /^[a-f0-9]{64}$/.test(x))).toBe(true);
});
it('keeps an admitted unknown outcome blocked instead of dispatching a second effect', async () => {
  let admitted = false;
  const cmd = p2Commands(
      {
        claim: async () => {
          if (admitted) return false;
          admitted = true;
          return true;
        },
      },
      secret,
    ),
    context = {
      actor: { keys: [], csrf, staff: randomUUID() },
      key: 'synthetic-key-123456',
      params: {},
      query: new URLSearchParams(),
    } as unknown as HttpContext;
  await expect(
    cmd.execute(context, 'upload', {}, async () => {
      throw Error('private storage exception');
    }),
  ).rejects.toThrow();
  const next = vi.fn(async () => ok(null));
  await expect(cmd.execute(context, 'upload', {}, next)).rejects.toMatchObject({ status: 409 });
  expect(next).not.toHaveBeenCalled();
});
it('accepts binary only on the explicit bounded octet-stream route and preserves existing JSON behavior', async () => {
  const handle = vi.fn(async () => ok({ accepted: true })),
    origin = 'http://127.0.0.1',
    api = createHttpApi({
      origin,
      security: {
        ...base,
        authenticate: async () => ({
          keys: [],
          csrf,
          staff: randomUUID() as never,
          mfaAt: Date.now(),
        }),
      },
      routes: [
        {
          operationId: 'upload',
          path: '/api/v1/upload',
          method: 'POST',
          access: 'staff',
          bodyMode: 'bytes',
          bodyContentType: 'application/octet-stream',
          maxBodyBytes: 4,
          handle,
        },
      ],
    });
  const send = (bytes: number, type: string) =>
    api(
      new Request(origin + '/api/v1/upload', {
        method: 'POST',
        headers: { origin, 'x-csrf-token': csrf, 'content-type': type },
        body: new Uint8Array(bytes),
      }),
    );
  expect((await send(4, 'application/octet-stream')).status).toBe(200);
  expect((await send(5, 'application/octet-stream')).status).toBe(413);
  expect((await send(4, 'application/json')).status).toBe(415);
  expect(handle).toHaveBeenCalledTimes(1);
});
it('bounds concurrent binary body admission before reading and releases both slots after failure', async () => {
  const origin = 'http://127.0.0.1',
    controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const api = createHttpApi({
    origin,
    security: base,
    routes: [
      {
        operationId: 'binary',
        path: '/api/v1/binary',
        method: 'POST',
        access: 'public',
        bodyMode: 'bytes',
        bodyContentType: 'application/octet-stream',
        maxBodyBytes: 4,
        handle: async () => ok(null),
      },
    ],
  });
  const request = () =>
    new Request(origin + '/api/v1/binary', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/octet-stream' },
      body: new ReadableStream<Uint8Array>({
        start(c) {
          controllers.push(c);
        },
      }),
      duplex: 'half',
    } as RequestInit);
  const first = api(request()),
    second = api(request());
  await new Promise((r) => setTimeout(r, 0));
  const third = await api(request());
  expect(third.status).toBe(429);
  expect(third.headers.get('retry-after')).toBe('1');
  controllers[0]!.error(Error('aborted'));
  controllers[1]!.close();
  await Promise.all([first, second]);
  const last = api(request());
  await new Promise((r) => setTimeout(r, 0));
  controllers.at(-1)!.close();
  expect((await last).status).toBe(200);
  controllers[2]!.close();
});
