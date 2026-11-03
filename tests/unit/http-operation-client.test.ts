import { it, expect, vi } from 'vitest';
import {
  createConsentClient,
  createStaffClient,
} from '../../packages/contracts/src/operation-client.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
function transport() {
  return vi.fn(
    async () => new Response(JSON.stringify({ data: { status: 'synthetic' }, requestId: uuid })),
  );
}
it('uses typed consent commands with the common transport and browser CSRF/idempotency headers', async () => {
  const send = transport(),
    api = createConsentClient('http://127.0.0.1:3210', send as typeof fetch);
  await api.cancel(
    uuid,
    { expectedRevision: '1', reason: 'cancel' },
    { csrf: 'session-csrf', key: 'synthetic_command_001' },
  );
  const [url, options] = send.mock.calls[0]! as unknown as [string, RequestInit];
  expect(String(url)).toBe('http://127.0.0.1:3210/api/v1/deliveries/' + uuid + '/cancel');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': 'session-csrf', 'idempotency-key': 'synthetic_command_001' },
  });
  expect(JSON.parse(options.body as string)).toEqual({ expectedRevision: '1', reason: 'cancel' });
});
it('keeps privacy bearer proofs out of URLs and does not invent a mutating GET', async () => {
  const send = transport(),
    api = createConsentClient('http://127.0.0.1:3210', send as typeof fetch);
  await api.privacyStatus('private-proof');
  await api.confirmPrivacy('private-proof');
  const calls = send.mock.calls as unknown as [string, RequestInit][];
  expect(String(calls[0]![0])).not.toContain('private-proof');
  expect(calls[0]![1].headers).toMatchObject({ authorization: 'Bearer private-proof' });
  expect(calls[1]![1].method).toBe('POST');
});
it('binds staff authority in headers and encodes pagination without caller-selected actors', async () => {
  const send = transport(),
    api = createStaffClient(
      'http://127.0.0.1:3210',
      { bearer: 'private-staff', csrf: 'staff-csrf' },
      send as typeof fetch,
    );
  await api.queue('imports', { limit: 5, after: uuid });
  await api.prepare({ artifactId: uuid }, 'synthetic_command_001');
  const calls = send.mock.calls as unknown as [string, RequestInit][];
  expect(String(calls[0]![0])).toContain('limit=5');
  expect(String(calls[0]![0])).not.toContain('private-staff');
  expect(calls[1]![1].headers).toMatchObject({
    authorization: 'Bearer private-staff',
    'x-csrf-token': 'staff-csrf',
  });
  expect(JSON.parse(calls[1]![1].body as string)).toEqual({ artifactId: uuid });
});
it('refuses unknown command fields and malformed resource identifiers before network access', async () => {
  const send = transport(),
    api = createStaffClient(
      'http://127.0.0.1:3210',
      { bearer: 'staff', csrf: 'csrf' },
      send as typeof fetch,
    );
  expect(() =>
    api.prepare({ artifactId: uuid, actorId: uuid } as never, 'synthetic_command_001'),
  ).toThrow();
  const consent = createConsentClient('http://127.0.0.1:3210', send as typeof fetch);
  expect(() => consent.delivery('../private')).toThrow();
  expect(send).not.toHaveBeenCalled();
});
