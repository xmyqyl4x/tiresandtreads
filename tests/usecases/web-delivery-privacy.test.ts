import { it, expect } from 'vitest';
import { deliveryPrivacyController } from '../../apps/web/src/delivery-privacy/controller.ts';
import { createDeliveryPrivacyClient } from '../../packages/contracts/src/delivery-privacy-client.ts';
import { uuid } from '../fixtures/engine/base.ts';
const origin = 'http://127.0.0.1:8380',
  csrf = 'a'.repeat(64),
  id = uuid(50);
const view = {
  id,
  revision: '1',
  state: 'scheduled',
  sendAfter: '2026-11-03T12:01:00.000Z',
  cancelDeadline: '2026-11-03T12:01:00.000Z',
};
const body = () => ({
  kind: 'delivery' as const,
  input: {
    email: 'example@example.invalid',
    report: { id: uuid(3), version: 2 },
    comparisonRevision: null,
    offers: false,
    notices: { report: uuid(1) },
  },
});
const reply = (data: unknown) => Response.json({ data, requestId: uuid(100) });
function error(code: string, status: number) {
  return Response.json(
    { code, messageKey: 'errors.' + code, fieldErrors: {}, retryable: false, requestId: uuid(100) },
    { status },
  );
}
it('captures the request before asynchronous identity and coalesces duplicate submissions', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
      release = r;
    }),
    calls: RequestInit[] = [];
  const send: typeof fetch = async (u, o) => {
    if (new URL(String(u)).pathname.endsWith('/sessions/current')) {
      await wait;
      return reply({ csrf });
    }
    calls.push(o!);
    return reply(view);
  };
  const c = deliveryPrivacyController(origin, send, () => uuid(9)),
    input = body(),
    a = c.submit(input),
    b = c.submit(body());
  input.input.email = 'changed@example.invalid';
  release();
  expect(await a).toEqual({ kind: 'delivery', view });
  expect(await b).toEqual({ kind: 'delivery', view });
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0]!.body)).email).toBe('example@example.invalid');
});
it('retries an unknown delivery acknowledgement with the same body/key and refuses silent edits', async () => {
  const calls: RequestInit[] = [];
  let first = true;
  const send: typeof fetch = async (u, o) => {
    if (new URL(String(u)).pathname.endsWith('/sessions/current')) return reply({ csrf });
    calls.push(o!);
    if (first) {
      first = false;
      throw Error('Response lost after commit');
    }
    return reply(view);
  };
  const c = deliveryPrivacyController(origin, send, () => uuid(9));
  await expect(c.submit(body())).rejects.toThrow();
  await expect(
    c.submit({
      ...body(),
      input: { ...body().input, offers: true, notices: { report: uuid(1), offers: uuid(2) } },
    }),
  ).rejects.toThrow(/unconfirmed/);
  expect(await c.submit(body())).toMatchObject({ kind: 'delivery', view: { id } });
  expect(calls).toHaveLength(2);
  expect(calls[0]!.body).toBe(calls[1]!.body);
  expect(new Headers(calls[0]!.headers).get('idempotency-key')).toBe(
    new Headers(calls[1]!.headers).get('idempotency-key'),
  );
});
it('allows corrected input after a definite validation refusal', async () => {
  let posts = 0;
  const send: typeof fetch = async (u) =>
    new URL(String(u)).pathname.endsWith('/sessions/current')
      ? reply({ csrf })
      : ++posts === 1
        ? error('invalid_input', 400)
        : reply(view);
  const c = deliveryPrivacyController(origin, send);
  await expect(c.submit(body())).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(
    c.submit({ ...body(), input: { ...body().input, email: 'corrected@example.invalid' } }),
  ).resolves.toMatchObject({ kind: 'delivery' });
});
it('keeps offers-only requests off the delivery endpoint', async () => {
  const paths: string[] = [];
  const send: typeof fetch = async (u) => {
    const p = new URL(String(u)).pathname;
    paths.push(p);
    return p.endsWith('/sessions/current')
      ? reply({ csrf })
      : reply({ schema_version: 1, resource_id: uuid(8), status: 'accepted' });
  };
  const c = deliveryPrivacyController(origin, send);
  expect(
    (
      await c.submit({
        kind: 'offers',
        input: {
          email: 'example@example.invalid',
          report: null,
          offers: true,
          notices: { offers: uuid(2) },
        },
      })
    ).kind,
  ).toBe('offers');
  expect(paths).toContain('/api/v1/contacts');
  expect(paths).not.toContain('/api/v1/deliveries');
});
it('submits the server cancellation revision and never promises cancellation after a conflict', async () => {
  let sent: unknown;
  const send: typeof fetch = async (u, o) => {
    if (new URL(String(u)).pathname.endsWith('/sessions/current')) return reply({ csrf });
    sent = JSON.parse(String(o?.body));
    return error('conflict', 409);
  };
  const c = deliveryPrivacyController(origin, send);
  await expect(c.cancel(view, 'correct_address')).rejects.toMatchObject({ code: 'conflict' });
  expect(sent).toEqual({ expectedRevision: '1', reason: 'correct_address' });
});
it('does not create an owner session, send cookies, place proofs in URLs or mutate on confirmation/preferences/status reads', async () => {
  const rows: { url: URL; init: RequestInit }[] = [];
  const send: typeof fetch = async (u, o = {}) => {
    const url = new URL(String(u));
    rows.push({ url, init: o });
    if (url.pathname.endsWith('/confirmation'))
      return reply({
        purpose: 'offers',
        status: 'pending',
        expiresAt: view.sendAfter,
        expired: false,
      });
    if (url.pathname.endsWith('/preferences'))
      return reply({ purpose: 'offers', status: 'confirmed' });
    return reply({
      id,
      kind: 'access',
      status: 'verified',
      dueAt: view.sendAfter,
      completedAt: null,
    });
  };
  const c = createDeliveryPrivacyClient(origin, send);
  await c.confirmation('verify.v1.' + id + '.' + 'a'.repeat(64));
  await c.preferences('unsubscribe.v1.' + id + '.' + 'a'.repeat(64));
  await c.privacyStatus('privacy.v1.' + id + '.' + 'a'.repeat(64));
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(r.url.search + r.url.hash).toBe('');
    expect(r.init.method ?? 'GET').toBe('GET');
    expect(r.init.credentials).toBe('omit');
    expect(r.init.signal).toBeInstanceOf(AbortSignal);
    expect(r.init.redirect).toBe('error');
    expect(new Headers(r.init.headers).get('authorization')).toMatch(/^Bearer /);
  }
});
it('refuses foreign send receipts, purpose-confused proofs and malformed statuses', async () => {
  const c = createDeliveryPrivacyClient(origin, async () => reply({ ...view, id: uuid(51) }));
  await expect(c.delivery(id)).rejects.toThrow();
  await expect(c.confirmation('unsubscribe.v1.' + id + '.' + 'a'.repeat(64))).rejects.toThrow();
  await expect(
    createDeliveryPrivacyClient(origin, async () =>
      reply({ ...view, state: 'delivered' }),
    ).delivery(id),
  ).rejects.toThrow();
});
it('keeps an ambiguous public email-rights request single-shot instead of duplicating verification work', async () => {
  let calls = 0;
  const c = deliveryPrivacyController(origin, async () => {
    calls++;
    throw Error('Response lost');
  });
  const input = {
    email: 'example@example.invalid',
    kind: 'access' as const,
    jurisdiction: 'synthetic',
  };
  await expect(c.emailRights(input)).rejects.toThrow();
  await expect(c.emailRights(input)).rejects.toThrow(/unconfirmed/);
  expect(calls).toBe(1);
});

it('retries failed owner initialization without replacing the pinned request', async () => {
  let lookups = 0,
    posts = 0;
  const keys: string[] = [];
  const c = deliveryPrivacyController(
    origin,
    async (u, o = {}) => {
      if (new URL(String(u)).pathname.endsWith('/sessions/current')) {
        if (++lookups === 1) throw Error('Offline');
        return reply({ csrf });
      }
      posts++;
      keys.push(new Headers(o.headers).get('idempotency-key')!);
      return reply(view);
    },
    () => uuid(9),
  );
  await expect(c.submit(body())).rejects.toThrow('Offline');
  expect(await c.submit(body())).toMatchObject({ kind: 'delivery', view });
  expect(lookups).toBe(2);
  expect(posts).toBe(1);
  expect(keys).toEqual([uuid(9)]);
});
it('refuses a cancellation acknowledgement that is not cancelled and a privacy proof bound to another request', async () => {
  const c = createDeliveryPrivacyClient(origin, async (u) =>
    new URL(String(u)).pathname.includes('/cancel')
      ? reply(view)
      : reply({ id, proof: 'privacy.p1.' + uuid(51) + '.' + 'a'.repeat(64) }),
  );
  await expect(
    c.cancel(id, { expectedRevision: '1', reason: 'cancel' }, csrf, uuid(9)),
  ).rejects.toThrow(/cancellation/);
  await expect(
    c.ownerRights({ kind: 'access', jurisdiction: 'synthetic' }, csrf, uuid(9)),
  ).rejects.toThrow(/binding/);
});
it('keeps capability actions cookie-free and bounded, with proofs only in the authorization header', async () => {
  const calls: { path: string; options: RequestInit }[] = [];
  const c = createDeliveryPrivacyClient(origin, async (u, o = {}) => {
    const path = new URL(String(u)).pathname;
    calls.push({ path, options: o });
    return reply(
      path.endsWith('/email/confirm')
        ? { status: 'confirmed' }
        : path.endsWith('/withdraw')
          ? { status: 'withdrawn' }
          : { verified: true },
    );
  });
  await c.confirmEmail('verify.p1.' + id + '.' + 'a'.repeat(64));
  await c.withdraw('unsubscribe.p1.' + id + '.' + 'a'.repeat(64));
  await c.confirmPrivacy('privacy.p1.' + id + '.' + 'a'.repeat(64));
  for (const call of calls) {
    expect(call.options.credentials).toBe('omit');
    expect(call.options.method).toBe('POST');
    expect(call.options.body).toBe('{}');
    expect(call.options.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(call.options.headers).get('authorization')).toMatch(/^Bearer /);
  }
});
