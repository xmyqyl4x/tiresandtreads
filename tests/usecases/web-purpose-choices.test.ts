import { it, expect } from 'vitest';
import { loadChoices } from '../../apps/web/src/consent-gateway.ts';
import { createBrowserConsentClient } from '../../packages/contracts/src/browser-consent-client.ts';
import { uuid } from '../fixtures/engine/base.ts';
const id = uuid(9),
  reply = (data: unknown) => Response.json({ data, requestId: id });
const notices = { necessary: id, report: id, offers: id, analytics: id, ads: id, targeted_ads: id };
const state = {
  necessary: true,
  analytics: false,
  ads: false,
  targeted_ads: false,
  identity_sharing: false,
  revision: '1',
};
it('replays a consent command after a lost read acknowledgement using the original revision/body/key', async () => {
  let changed = false,
    fail = true;
  const posts: RequestInit[] = [];
  const send: typeof fetch = async (u, o = {}) => {
    const p = new URL(String(u)).pathname;
    if (p.endsWith('/sessions/current')) return reply({ csrf: 'a'.repeat(64) });
    if (p.endsWith('/policy')) return reply({ version: 'synthetic', notices });
    if (o.method === 'POST') {
      posts.push(o);
      changed = true;
      return reply({
        schema_version: 1,
        resource_id: id,
        status: 'accepted',
        result_revision: '2',
      });
    }
    if (changed && fail) {
      fail = false;
      throw Error('Read acknowledgment lost');
    }
    return reply({ ...state, revision: changed ? '2' : '1' });
  };
  const gateway = await loadChoices('http://127.0.0.1:8380', send);
  await expect(
    gateway.save({ analytics: false, ads: false, targeted_ads: false }, false),
  ).rejects.toThrow();
  await expect(
    gateway.save({ analytics: true, ads: false, targeted_ads: false }, false),
  ).rejects.toThrow(/unconfirmed/);
  expect(
    (await gateway.save({ analytics: false, ads: false, targeted_ads: false }, false)).revision,
  ).toBe('2');
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body).toBe(posts[1]!.body);
  expect(new Headers(posts[0]!.headers).get('idempotency-key')).toBe(
    new Headers(posts[1]!.headers).get('idempotency-key'),
  );
});
it('applies GPC to the explicit proposed targeted-ad choice without changing report or offers permissions', async () => {
  let body: Record<string, unknown> | undefined,
    saved = false;
  const send: typeof fetch = async (u, o = {}) => {
    const p = new URL(String(u)).pathname;
    if (p.endsWith('/sessions/current')) return reply({ csrf: 'a'.repeat(64) });
    if (p.endsWith('/policy')) return reply({ version: 'synthetic', notices });
    if (o.method === 'POST') {
      body = JSON.parse(String(o.body));
      saved = true;
      return reply({
        schema_version: 1,
        resource_id: id,
        status: 'accepted',
        result_revision: '2',
      });
    }
    return reply({ ...state, revision: saved ? '2' : '1' });
  };
  const gateway = await loadChoices('http://127.0.0.1:8380', send);
  await gateway.save({ analytics: true, ads: true, targeted_ads: true }, true);
  expect(body).toMatchObject({ gpc: true, allowed: ['analytics', 'ads'] });
  expect(Object.keys(body!.notices as object).sort()).toEqual([
    'ads',
    'analytics',
    'necessary',
    'targeted_ads',
  ]);
});
it('bounds all standalone browser-consent SDK calls without relying on a UI wrapper', async () => {
  const signals: unknown[] = [];
  const c = createBrowserConsentClient('http://127.0.0.1:8380', async (u, o = {}) => {
    signals.push(o.signal);
    return reply(
      new URL(String(u)).pathname.endsWith('/policy')
        ? { version: 'synthetic', notices }
        : o.method === 'POST'
          ? { schema_version: 1, resource_id: id, status: 'accepted', result_revision: '2' }
          : state,
    );
  });
  await c.policy();
  await c.browser();
  await c.choices(
    {
      expectedRevision: '1',
      allowed: [],
      gpc: false,
      notices: { necessary: id, analytics: id, ads: id, targeted_ads: id },
    },
    { csrf: 'a'.repeat(64), key: uuid(10) },
  );
  expect(signals).toHaveLength(3);
  for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
});
