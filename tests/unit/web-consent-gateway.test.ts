import { it, expect } from 'vitest';
import { loadChoices } from '../../apps/web/src/consent-gateway.ts';
const uuid = '11111111-1111-4111-8111-111111111111',
  csrf = 'a'.repeat(64);
const notices = {
  necessary: uuid,
  report: uuid,
  offers: uuid,
  analytics: uuid,
  ads: uuid,
  targeted_ads: uuid,
};
const state = {
  necessary: true,
  analytics: false,
  ads: false,
  targeted_ads: false,
  identity_sharing: false,
  revision: '1',
};
function transport(options: { existing?: boolean; badView?: boolean; stale?: boolean } = {}) {
  const calls: { path: string; options: RequestInit }[] = [];
  let saved = false;
  const send: typeof fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, options: init });
    const reply = (data: unknown) => Response.json({ data, requestId: uuid });
    const error = (code: string, status: number) =>
      Response.json(
        { code, messageKey: 'errors.' + code, fieldErrors: {}, retryable: false, requestId: uuid },
        { status },
      );
    if (path === '/api/v1/sessions/current')
      return options.existing ? reply({ csrf }) : error('unauthorized', 401);
    if (path === '/api/v1/sessions') return reply({ csrf });
    if (path === '/api/v1/consent/policy') return reply({ version: 'synthetic', notices });
    if (init.method === 'POST') {
      if (options.stale) return error('conflict', 409);
      saved = true;
      return reply({
        schema_version: 1,
        resource_id: uuid,
        status: 'accepted',
        result_revision: '2',
      });
    }
    return reply(
      options.badView
        ? { ...state, identity_sharing: true }
        : { ...state, revision: saved ? '2' : '1' },
    );
  };
  return { send, calls };
}
it('loads only necessary identity/policy state and never grants optional consent on open', async () => {
  const t = transport(),
    g = await loadChoices('http://127.0.0.1:8380', t.send);
  expect(g.current.analytics).toBe(false);
  expect(t.calls.filter((x) => x.options.method === 'POST').map((x) => x.path)).toEqual([
    '/api/v1/sessions',
  ]);
});
it('uses an existing owner and saves only explicit choices with current revision, notices and CSRF', async () => {
  const t = transport({ existing: true }),
    g = await loadChoices('http://127.0.0.1:8380', t.send);
  await g.save({ analytics: true, ads: false, targeted_ads: false }, false);
  expect(t.calls.some((x) => x.path === '/api/v1/sessions')).toBe(false);
  const call = t.calls.find(
    (x) => x.path === '/api/v1/consent/browser' && x.options.method === 'POST',
  )!;
  expect(JSON.parse(String(call.options.body))).toEqual({
    expectedRevision: '1',
    allowed: ['analytics'],
    gpc: false,
    notices: { necessary: uuid, analytics: uuid, ads: uuid, targeted_ads: uuid },
  });
  expect(new Headers(call.options.headers).get('x-csrf-token')).toBe(csrf);
  expect(g.current.revision).toBe('2');
});
it('keeps existing choices when a concurrent save conflicts and refuses malformed server permission DTOs', async () => {
  const t = transport({ stale: true }),
    g = await loadChoices('http://127.0.0.1:8380', t.send);
  await expect(
    g.save({ analytics: false, ads: false, targeted_ads: false }, false),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(g.current.revision).toBe('1');
  await expect(
    loadChoices('http://127.0.0.1:8380', transport({ badView: true }).send),
  ).rejects.toThrow();
});
