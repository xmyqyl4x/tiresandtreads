import { it, expect, vi } from 'vitest';
import { p2ProxyContract, forwardP2 } from '../../apps/web/src/phase2/proxy.ts';
import { privateTransport } from '../../apps/web/src/phase2/transport.ts';
import { createOperationsP2Client } from '../../packages/contracts/src/phase2-operations-client.ts';
const id = '11111111-1111-4111-8111-111111111111',
  origin = 'http://127.0.0.1:8380';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_PREVIEW: 'enabled',
  LOCAL_WEB_ORIGIN: origin,
  LOCAL_API_ORIGIN: 'http://127.0.0.1:4100',
  LOCAL_P2_API_ORIGIN: 'http://127.0.0.1:4101',
  LOCAL_P2_OPERATIONS_UI: 'enabled',
};
it('admits only six reviewed operations and excludes arbitrary worker, policy enable, owner and staff mutations', () => {
  expect(
    p2ProxyContract('/api/v1/staff/assistance/policies/' + id + '/disable', 'POST', 'operations')
      ?.operationId,
  ).toBe('p2OperationsDisable');
  expect(
    p2ProxyContract('/api/v1/staff/assistance/requests/' + id + '/resume', 'POST', 'operations')
      ?.operationId,
  ).toBe('p2OperationsResume');
  for (const path of [
    '/api/v1/staff/assistance/policies/' + id + '/enable',
    '/api/v1/staff/recover',
    '/api/v1/photos',
    '/api/v1/analysis/' + id,
  ])
    expect(p2ProxyContract(path, 'POST', 'operations')).toBeNull();
  expect(
    p2ProxyContract('/api/v1/staff/assistance/requests/bad/resume', 'POST', 'operations'),
  ).toBeNull();
});
it('keeps independent enablement and strips ambient cookie, role and upload-grant assertions', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {}, requestId: id })),
    request = () =>
      new Request(origin + '/local-p2-operations-api/api/v1/staff/assistance/session', {
        headers: {
          host: '127.0.0.1:8380',
          authorization: 'Bearer ' + 'a'.repeat(43),
          cookie: 'tt_owner=other',
          'x-role': 'ai_operator',
          'x-upload-grant': 'b'.repeat(64),
        },
      });
  expect(
    (
      await forwardP2(
        request(),
        { ...env, LOCAL_P2_OPERATIONS_UI: 'disabled', LOCAL_P2_STAFF_UI: 'enabled' },
        send,
        'operations',
      )
    ).status,
  ).toBe(404);
  expect(send).not.toHaveBeenCalled();
  expect((await forwardP2(request(), env, send, 'operations')).status).toBe(200);
  const [url, init] = send.mock.calls[0]!;
  expect(String(url)).toBe('http://127.0.0.1:4101/api/v1/staff/assistance/session');
  expect(init?.redirect).toBe('error');
  for (const name of ['cookie', 'x-role', 'x-upload-grant'])
    expect(new Headers(init?.headers).has(name)).toBe(false);
});
it('refuses duplicate queries and cross-origin commands before forwarding', async () => {
  const send = vi.fn<typeof fetch>();
  const request = (path: string, method = 'GET', from = origin) =>
    new Request(origin + '/local-p2-operations-api' + path, {
      method,
      headers: { host: '127.0.0.1:8380', origin: from, authorization: 'Bearer ' + 'a'.repeat(43) },
    });
  expect(
    (
      await forwardP2(
        request('/api/v1/staff/assistance/dashboard?day=2026-11-08&day=2026-11-08'),
        env,
        send,
        'operations',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await forwardP2(
        request(
          '/api/v1/staff/assistance/requests/' + id + '/resume',
          'POST',
          'https://other.invalid',
        ),
        env,
        send,
        'operations',
      )
    ).status,
  ).toBe(403);
  expect(send).not.toHaveBeenCalled();
});
it('does not let the operations transport reach other API surfaces', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
    transport = privateTransport(
      origin,
      'a'.repeat(43),
      new AbortController().signal,
      send,
      'operations',
    );
  expect(() => transport(origin + '/api/v1/photos')).toThrow();
  expect(() => transport('https://elsewhere.invalid/api/v1/staff/assistance/session')).toThrow();
  await transport(origin + '/api/v1/staff/assistance/session');
  expect(String(send.mock.calls[0]![0])).toBe(
    origin + '/local-p2-operations-api/api/v1/staff/assistance/session',
  );
  expect(send.mock.calls[0]![1]?.credentials).toBe('omit');
});
it('rejects a non-UUID original command reference before dispatch', async () => {
  const send = vi.fn<typeof fetch>();
  await expect(
    createOperationsP2Client(origin, send).p2OperationsResume({
      path: { request: id },
      body: {},
      command: { key: 'not-a-receipt-reference', csrf: 'a'.repeat(64) },
    }),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
