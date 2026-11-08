import { it, expect, vi } from 'vitest';
import { p2ProxyContract, forwardP2 } from '../../apps/web/src/phase2/proxy.ts';
const id = '11111111-1111-4111-8111-111111111111',
  origin = 'http://127.0.0.1:8380';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_PREVIEW: 'enabled',
  LOCAL_WEB_ORIGIN: origin,
  LOCAL_API_ORIGIN: 'http://127.0.0.1:4100',
  LOCAL_P2_API_ORIGIN: 'http://127.0.0.1:4101',
  LOCAL_P2_OWNER_UI: 'enabled',
};
it('admits only the reviewed owner operations, never staff, partner, session creation or a shared capability', () => {
  expect(
    p2ProxyContract('/api/v1/reports/' + id + '/versions/1/analysis/presentation', 'GET', 'owner')
      ?.operationId,
  ).toBe('p2AnalysisPresentation');
  for (const [path, method] of [
    ['/api/v1/staff/review/session', 'GET'],
    ['/api/v1/partners/session', 'GET'],
    ['/api/v1/sessions', 'POST'],
    ['/api/v1/shared', 'GET'],
    ['/api/v1/reports/' + id + '/versions/01/analysis', 'POST'],
    ['/api/v1/photos/' + id + '/save/arbitrary', 'POST'],
  ])
    expect(p2ProxyContract(path!, method!, 'owner')).toBeNull();
});
it('requires independent enablement and strips ambient authority and redirect escape', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {}, requestId: id }));
  const request = () =>
    new Request(origin + '/local-p2-owner-api/api/v1/sessions/current', {
      headers: {
        host: '127.0.0.1:8380',
        authorization: 'Bearer ' + 'a'.repeat(43),
        cookie: 'tt_owner=other',
        'x-role': 'staff',
      },
    });
  expect(
    (
      await forwardP2(
        request(),
        { ...env, LOCAL_P2_OWNER_UI: 'disabled', LOCAL_P2_STAFF_UI: 'enabled' },
        send,
        'owner',
      )
    ).status,
  ).toBe(404);
  expect(send).not.toHaveBeenCalled();
  expect((await forwardP2(request(), env, send, 'owner')).status).toBe(200);
  const [url, init] = send.mock.calls[0]!;
  expect(String(url)).toBe('http://127.0.0.1:4101/api/v1/sessions/current');
  expect(init?.redirect).toBe('error');
  expect(new Headers(init?.headers).has('cookie')).toBe(false);
  expect(new Headers(init?.headers).has('x-role')).toBe(false);
});
