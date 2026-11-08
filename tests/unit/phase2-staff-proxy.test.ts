import { it, expect, vi } from 'vitest';
import { p2ProxyContract, forwardP2 } from '../../apps/web/src/phase2/proxy.ts';
import { previewBodyLimit } from '../fixtures/http/preview-headers.mjs';
const id = '11111111-1111-4111-8111-111111111111',
  origin = 'http://127.0.0.1:8380';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_PREVIEW: 'enabled',
  LOCAL_WEB_ORIGIN: origin,
  LOCAL_API_ORIGIN: 'http://127.0.0.1:4100',
  LOCAL_P2_API_ORIGIN: 'http://127.0.0.1:4101',
  LOCAL_P2_STAFF_UI: 'enabled',
};
it('admits only reviewed staff CSV, read queues and independent decision routes with canonical versions', () => {
  expect(
    p2ProxyContract(
      '/api/v1/staff/review/businesses/' + id + '/offers/' + id + '/1',
      'GET',
      'staff',
    )?.operationId,
  ).toBe('p2OfferReviewDetail');
  for (const p of [
    '/api/v1/staff/recover',
    '/api/v1/partners/organizations',
    '/api/v1/staff/review/businesses/' + id + '/offers/' + id + '/01',
    '/api/v1/staff/review/businesses/' + id + '/offers/' + id + '/2147483648',
  ])
    expect(p2ProxyContract(p, 'GET', 'staff')).toBeNull();
  expect(
    previewBodyLimit('/local-p2-staff-api/api/v1/staff/csv/uploads?templateId=' + id, 'POST'),
  ).toBe(16777216);
  expect(
    previewBodyLimit('/local-p2-staff-api/api/v1/staff/csv/uploads/' + id + '/review', 'POST'),
  ).toBe(65536);
});
it('keeps staff enablement independent and strips ambient cookies or authority assertions', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {}, requestId: id })),
    request = () =>
      new Request(origin + '/local-p2-staff-api/api/v1/staff/review/session', {
        headers: {
          host: '127.0.0.1:8380',
          authorization: 'Bearer ' + 'a'.repeat(43),
          cookie: 'tt_owner=private',
          'x-role': 'owner',
        },
      });
  expect(
    (
      await forwardP2(
        request(),
        { ...env, LOCAL_P2_STAFF_UI: 'disabled', LOCAL_P2_UI: 'enabled' },
        send,
        'staff',
      )
    ).status,
  ).toBe(404);
  expect(send).not.toHaveBeenCalled();
  expect((await forwardP2(request(), env, send, 'staff')).status).toBe(200);
  const [target, options] = send.mock.calls[0]!;
  expect(String(target)).toBe('http://127.0.0.1:4101/api/v1/staff/review/session');
  expect(new Headers(options?.headers).has('cookie')).toBe(false);
  expect(new Headers(options?.headers).has('x-role')).toBe(false);
});
