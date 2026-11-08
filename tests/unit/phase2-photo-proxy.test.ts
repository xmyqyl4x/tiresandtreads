import { it, expect, vi } from 'vitest';
import { forwardP2, p2ProxyContract } from '../../apps/web/src/phase2/proxy.ts';
import { previewBodyLimit, previewForwardHeaders } from '../fixtures/http/preview-headers.mjs';
const id = '11111111-1111-4111-8111-111111111111',
  origin = 'http://127.0.0.1:8380',
  finalize = '/local-p2-owner-api/api/v1/photos/' + id + '/finalize';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_PREVIEW: 'enabled',
  LOCAL_WEB_ORIGIN: origin,
  LOCAL_API_ORIGIN: 'http://127.0.0.1:4100',
  LOCAL_P2_API_ORIGIN: 'http://127.0.0.1:4101',
  LOCAL_P2_OWNER_UI: 'enabled',
};
it('admits reviewed photo/delete and assessment routes without granting staff or arbitrary uploads', () => {
  expect(p2ProxyContract('/api/v1/photos/' + id, 'DELETE', 'owner')?.operationId).toBe(
    'p2PhotoDelete',
  );
  expect(p2ProxyContract('/api/v1/photo-options', 'GET', 'owner')?.operationId).toBe(
    'p2PhotoOptions',
  );
  expect(p2ProxyContract('/api/v1/reports', 'POST', 'owner')?.operationId).toBe('createReport');
  expect(p2ProxyContract('/api/v1/photos/' + id + '/execute', 'POST', 'owner')).toBeNull();
  expect(p2ProxyContract('/api/v1/photos/' + id + '/save', 'POST', 'owner')).toBeNull();
  expect(p2ProxyContract('/api/v1/staff/review/session', 'GET', 'owner')).toBeNull();
});
it('retains64KiB ordinary ingress and10MiB only for the reviewed photo-finalize path', () => {
  expect(previewBodyLimit(finalize, 'POST')).toBe(10485760);
  expect(previewBodyLimit(finalize, 'DELETE')).toBe(65536);
  expect(previewBodyLimit('/local-p2-owner-api/api/v1/photos', 'POST')).toBe(65536);
  const headers = { 'x-upload-grant': 'a'.repeat(64) };
  expect(previewForwardHeaders(headers, '127.0.0.1:8380', finalize, 'POST')['x-upload-grant']).toBe(
    headers['x-upload-grant'],
  );
  expect(
    previewForwardHeaders(headers, '127.0.0.1:8380', '/local-p2-owner-api/api/v1/reports', 'POST')[
      'x-upload-grant'
    ],
  ).toBeUndefined();
});
it('requires a bounded upload grant and forwards it only on finalize', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {}, requestId: id }));
  const request = (path: string, grant?: string) =>
    new Request(origin + path, {
      method: 'POST',
      headers: {
        host: '127.0.0.1:8380',
        origin,
        authorization: 'Bearer ' + 'b'.repeat(43),
        'content-type': 'application/octet-stream',
        ...(grant ? { 'x-upload-grant': grant } : {}),
      },
      body: new Uint8Array([1, 2]),
    });
  expect((await forwardP2(request(finalize), env, send, 'owner')).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
  expect((await forwardP2(request(finalize, 'a'.repeat(64)), env, send, 'owner')).status).toBe(200);
  expect(new Headers(send.mock.calls[0]![1]?.headers).get('x-upload-grant')).toBe('a'.repeat(64));
  send.mockClear();
  await forwardP2(
    request('/local-p2-owner-api/api/v1/reports', 'a'.repeat(64)),
    env,
    send,
    'owner',
  );
  expect(new Headers(send.mock.calls[0]![1]?.headers).has('x-upload-grant')).toBe(false);
});
