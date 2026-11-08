import { it, expect, vi } from 'vitest';
import { forwardP2, p2ProxyContract } from '../../apps/web/src/phase2/proxy.ts';
import { dollars, offerDraft, simulation } from '../../apps/web/src/phase2/partner/forms.ts';
const origin = 'http://127.0.0.1:8380';
const env = {
  LOCAL_WEB_PREVIEW: 'enabled',
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_ORIGIN: origin,
  LOCAL_API_ORIGIN: 'http://127.0.0.1:4100',
  LOCAL_P2_UI: 'enabled',
  LOCAL_P2_API_ORIGIN: 'http://127.0.0.1:4101',
};
const org = '11111111-1111-4111-8111-111111111111';
it('allows only the reviewed versioned partner route inventory', () => {
  expect(p2ProxyContract('/api/v1/partners/organizations/' + org, 'GET')?.operationId).toBe(
    'p2Organization',
  );
  for (const path of [
    '/api/v1/staff/recover',
    '/api/v1/partners/../staff',
    '//evil.invalid',
    '/api/v1/partners/organizations/not-an-id',
  ])
    expect(p2ProxyContract(path, 'GET')).toBeNull();
});
it('refuses disabled, foreign-host, cross-origin, anonymous and oversized requests before transport', async () => {
  const send = vi.fn<typeof fetch>();
  const request = (headers: Record<string, string> = {}, body?: string) =>
    new Request(origin + '/local-p2-api/api/v1/partners/organizations', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:8380',
        origin,
        authorization: 'Bearer ' + 'a'.repeat(43),
        ...headers,
      },
      body: body ?? '{}',
    });
  expect((await forwardP2(request(), { ...env, LOCAL_P2_UI: 'disabled' }, send)).status).toBe(404);
  expect((await forwardP2(request({ host: 'evil.invalid' }), env, send)).status).toBe(403);
  expect((await forwardP2(request({ origin: 'https://evil.invalid' }), env, send)).status).toBe(
    403,
  );
  expect((await forwardP2(request({ authorization: '' }), env, send)).status).toBe(401);
  expect((await forwardP2(request({}, 'a'.repeat(262145)), env, send)).status).toBe(413);
  expect(send).not.toHaveBeenCalled();
});
it('forwards only fixed local authority and allowed headers with a bounded private reply', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {}, requestId: org }));
  const response = await forwardP2(
    new Request(origin + '/local-p2-api/api/v1/partners/session', {
      headers: {
        host: '127.0.0.1:8380',
        authorization: 'Bearer session-11111111-1111-4111-8111-111111111111',
        cookie: 'private=secret',
        'x-role': 'admin',
      },
    }),
    env,
    send,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const [url, init] = send.mock.calls[0]!;
  expect(String(url)).toBe('http://127.0.0.1:4101/api/v1/partners/session');
  expect(new Headers(init?.headers).has('cookie')).toBe(false);
  expect(new Headers(init?.headers).has('x-role')).toBe(false);
  expect(init?.redirect).toBe('error');
});
it('parses decimal input exactly and leaves discount calculations to the API', () => {
  expect(dollars('0.10')).toBe('10');
  expect(dollars('1234567890123456.78')).toBe('123456789012345678');
  for (const v of ['-1', '1.001', '1e3', 'NaN']) expect(() => dollars(v)).toThrow();
  const form = new FormData();
  for (const [k, v] of Object.entries({
    title: 'A set offer',
    description: 'Local',
    terms: 'Availability',
    included: 'Tires\nFitting',
    kind: 'amount_off',
    amount: '25.00',
    minimumTires: '4',
    validFrom: '2026-11-07T00:00',
    validUntil: '2026-12-07T00:00',
    strategy: 'store_wide',
    version: '1',
  }))
    form.set(k, v);
  const draft = offerDraft(form, org);
  expect(draft.body.discount).toEqual({
    kind: 'amount_off',
    money: { minor: '2500', currency: 'USD' },
  });
  expect(draft.targets[0]?.strategy).toBe('store_wide');
  expect(() => simulation(new FormData())).toThrow();
});

it('keeps ordinary ingress bounded and admits only the reviewed private binary upload size', async () => {
  const { previewBodyLimit } = await import('../fixtures/http/preview-headers.mjs');
  expect(
    previewBodyLimit(
      '/local-p2-api/api/v1/partners/organizations/' + org + '/assets?purpose=coupon_pool',
      'POST',
    ),
  ).toBe(16777216);
  for (const path of [
    '/api/v1/reports',
    '/local-p2-api/api/v1/partners/session',
    '/local-p2-api/api/v1/staff/csv/uploads',
    '/local-p2-api/api/v1/partners/organizations/no/assets',
  ])
    expect(previewBodyLimit(path, 'POST')).toBe(65536);
  expect(
    previewBodyLimit('/local-p2-api/api/v1/partners/organizations/' + org + '/assets', 'GET'),
  ).toBe(65536);
});

function audienceForm() {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    quantity: '4',
    skuId: org,
    modelId: org,
    size: '225/45R18',
    rim: '18',
    category: 'touring',
  }))
    f.set(key, value);
  return f;
}
it('preserves optional coordinates for actual radius matching and keeps omitted coordinates unknown', () => {
  const f = audienceForm();
  f.set('latitude', '34.05');
  f.set('longitude', '-118.25');
  expect(simulation(f)).toMatchObject({ latitude: 34.05, longitude: -118.25 });
  f.delete('latitude');
  f.delete('longitude');
  expect(simulation(f)).toMatchObject({ latitude: null, longitude: null });
});
it('refuses partial, nonfinite and out-of-range simulation coordinates before transport', () => {
  for (const [lat, lon] of [
    ['34', ''],
    ['', '-118'],
    ['NaN', '-118'],
    ['91', '0'],
    ['0', '181'],
    ['-91', '0'],
    ['0', '-181'],
  ]) {
    const f = audienceForm();
    f.set('latitude', lat!);
    f.set('longitude', lon!);
    expect(() => simulation(f)).toThrow();
  }
});
