import { it, expect, vi } from 'vitest';
import { forwardEditorial } from '../../apps/web/src/editorial/proxy.ts';
import {
  createEditorialClient,
  redirectEditorCommandSchema,
} from '../../packages/contracts/src/editorial-client.ts';
const web = 'http://127.0.0.1:8380',
  api = 'http://127.0.0.1:9411',
  token = 'a'.repeat(300) + '.' + 'b'.repeat(400) + '.' + 'c'.repeat(342),
  env = {
    APP_ENV: 'dev-local',
    PROVIDER_MODE: 'fixtures',
    LOCAL_WEB_PREVIEW: 'enabled',
    LOCAL_WEB_ORIGIN: web,
    LOCAL_API_ORIGIN: api,
    LOCAL_EDITORIAL_PREVIEW: 'enabled',
    LOCAL_EDITORIAL_API_ORIGIN: api,
  };
function request(credential = token, headers: Record<string, string> = {}) {
  return new Request(web + '/local-editorial-api?identity=1', {
    headers: { host: '127.0.0.1:8380', authorization: 'Bearer ' + credential, ...headers },
  });
}
it('forwards a bounded session unchanged without cookies or a browser identity claim', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ data: { id: 'server-owned' } }, { headers: { 'set-cookie': 'refused=x' } }),
    );
  const response = await forwardEditorial(request(token, { cookie: 'private=secret' }), env, send);
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(send.mock.calls[0]![0]).toBe(api + '/local-editorial/api?identity=1');
  expect(new Headers(send.mock.calls[0]![1]!.headers).get('authorization')).toBe('Bearer ' + token);
  expect(new Headers(send.mock.calls[0]![1]!.headers).get('cookie')).toBeNull();
});
it.each(['a..b', 'x'.repeat(8186), 'a.b.c extra'])(
  'refuses malformed or oversized credentials before forwarding: %s',
  async (bad) => {
    const send = vi.fn<typeof fetch>();
    expect((await forwardEditorial(request(bad), env, send)).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  },
);
it('retains opt-in and same-origin admission', async () => {
  const send = vi.fn<typeof fetch>();
  expect(
    (await forwardEditorial(request(), { ...env, LOCAL_EDITORIAL_PREVIEW: 'disabled' }, send))
      .status,
  ).toBe(404);
  expect(
    (await forwardEditorial(request(token, { origin: 'https://untrusted.invalid' }), env, send))
      .status,
  ).toBe(403);
  expect(send).not.toHaveBeenCalled();
});
it('carries a session in the private client header with no credential in its URL', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: 'verified' } }));
  expect(await createEditorialClient(web, token, send).identity()).toEqual({ id: 'verified' });
  expect(String(send.mock.calls[0]![0])).not.toContain(token);
  expect(new Headers(send.mock.calls[0]![1]!.headers).get('authorization')).toBe('Bearer ' + token);
});
it('bounds independent reviewer credentials inside the existing private POST contract', () => {
  const value = {
    action: 'redirects',
    reviewerCredential: token,
    revision: 1,
    issuedAt: '2026-11-15T12:00:00.000Z',
    expiresAt: '2026-11-16T12:00:00.000Z',
    csv: 'synthetic',
  };
  expect(redirectEditorCommandSchema.safeParse(value).success).toBe(true);
  expect(
    redirectEditorCommandSchema.safeParse({ ...value, reviewerCredential: 'a'.repeat(8186) })
      .success,
  ).toBe(false);
});
