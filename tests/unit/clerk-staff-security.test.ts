import type { Id } from '../../packages/domain/src/values/core.ts';
import { generateKeyPairSync, sign } from 'node:crypto';
import { it, expect, vi, afterEach } from 'vitest';
import {
  withClerkStaffSessions,
  clerkStaffSubject,
} from '../../packages/integrations/src/http/clerk-staff-security.ts';
import { id } from '../../packages/domain/src/values/core.ts';

const issuer = 'https://synthetic.clerk.accounts.dev',
  origin = 'https://staff.example.invalid',
  pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }),
  staff = id('staff', '10000000-0000-4000-8000-000000000001');
if (!staff.ok) throw Error('Invalid synthetic staff');
const staffId = staff.value;
function setup(
  overrides: Record<string, unknown> = {},
  headerClaims: Record<string, unknown> = {},
) {
  const now = Date.now(),
    at = Math.floor(now / 1000),
    claims = {
      iss: issuer,
      azp: origin,
      aud: 'tiresandtreads:staff',
      sub: 'user_SyntheticStaff',
      sid: 'sess_SyntheticStaff',
      iat: at,
      nbf: at - 1,
      exp: at + 60,
      v: 2,
      fva: [0, 0],
      ...overrides,
    },
    header = Buffer.from(
      JSON.stringify({
        alg: 'RS256',
        typ: 'JWT',
        kid: 'synthetic',
        cat: 'cl_B7d4PD111AAA',
        ...headerClaims,
      }),
    ).toString('base64url'),
    body = header + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url'),
    token =
      body + '.' + sign('RSA-SHA256', Buffer.from(body), pair.privateKey).toString('base64url'),
    resolve = vi.fn<(subject: string) => Promise<Id<'staff'> | null>>(async () => staffId),
    session = {
      object: 'session',
      id: 'sess_SyntheticStaff',
      user_id: 'user_SyntheticStaff',
      status: 'active',
      created_at: now - 60000,
      last_active_at: now - 1000,
      expire_at: now + 3600000,
      abandon_at: now + 1800000,
      actor: null,
    },
    transport = vi.fn<typeof fetch>(async () => Response.json(session)),
    base = { authenticate: vi.fn(async () => null), quota: async () => ({ allowed: true }) },
    options = {
      enabled: true as const,
      base,
      issuer,
      audience: 'tiresandtreads:staff',
      authorizedParties: [origin],
      publishableKey: 'pk_test_' + Buffer.from('synthetic.clerk.accounts.dev$').toString('base64'),
      publicKeys: [pair.publicKey],
      apiKey: async (): Promise<string | null> => 'sk_test_' + 'synthetic'.repeat(4),
      csrfKey: new Uint8Array(32).fill(33),
      resolve,
      fetch: transport,
      now: () => now,
    },
    request = new Request(origin + '/api/v1/staff/session', {
      headers: { authorization: 'Bearer ' + token },
    });
  return { now, claims, token, resolve, session, transport, base, options, request };
}
it('verifies a locally signed Clerk session, checks current authority and emits a bound staff actor', async () => {
  const s = setup(),
    security = withClerkStaffSessions(s.options),
    actor = await security.authenticateStaff(s.request);
  expect(actor).toMatchObject({
    staff: staffId,
    keys: [],
    csrf: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(actor!.mfaAt).toBeLessThanOrEqual(s.now);
  expect(s.resolve).toHaveBeenCalledExactlyOnceWith(
    clerkStaffSubject(issuer, 'user_SyntheticStaff'),
  );
  expect(s.transport).toHaveBeenCalledTimes(1);
  expect(String(s.transport.mock.calls[0]![0])).toBe(
    'https://api.clerk.com/v1/sessions/sess_SyntheticStaff',
  );
  expect(s.transport.mock.calls[0]![1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  expect(s.base.authenticate).not.toHaveBeenCalled();
});
it.each([
  ['issuer', { iss: 'https://other.clerk.accounts.dev' }],
  ['origin', { azp: 'https://other.example.invalid' }],
  ['missing-origin', { azp: null }],
  ['audience', { aud: 'tiresandtreads:partner' }],
  ['pending', { sts: 'pending' }],
  ['missing-factor', { fva: null }],
  ['no-second-factor', { fva: [0, -1] }],
  ['no-first-factor', { fva: [-1, 0] }],
  ['stale-factor', { fva: [0, 5] }],
  ['fractional-factor', { fva: [0, 0.5] }],
  ['legacy', { v: 1 }],
  ['wrong-user-shape', { sub: 'admin' }],
  ['wrong-session-shape', { sid: 'sess_../outside' }],
  ['impersonation', { act: { sub: 'user_Another' } }],
] as const)(
  'refuses a signed session with %s before identity lookup or provider reads',
  async (_label, claims) => {
    const s = setup(claims),
      security = withClerkStaffSessions(s.options);
    expect(await security.authenticateStaff(s.request)).toBeNull();
    expect(s.resolve).not.toHaveBeenCalled();
    expect(s.transport).not.toHaveBeenCalled();
  },
);
it('refuses an invalid signature, expired token and future activation without falling back to owner authority', async () => {
  const s = setup(),
    security = withClerkStaffSessions(s.options),
    parts = s.token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...s.claims, sub: 'user_Another' })).toString(
    'base64url',
  );
  expect(
    await security.authenticateStaff(
      new Request(s.request.url, { headers: { authorization: 'Bearer ' + parts.join('.') } }),
    ),
  ).toBeNull();
  for (const extra of [
    { exp: Math.floor(s.now / 1000) - 10 },
    { nbf: Math.floor(s.now / 1000) + 60 },
    { iat: Math.floor(s.now / 1000) + 60 },
  ]) {
    const t = setup(extra);
    expect(await withClerkStaffSessions(t.options).authenticateStaff(t.request)).toBeNull();
    expect(t.transport).not.toHaveBeenCalled();
  }
  expect(s.base.authenticate).not.toHaveBeenCalled();
  expect(s.resolve).not.toHaveBeenCalled();
  expect(s.transport).not.toHaveBeenCalled();
});
it('refuses an unmapped or no-longer-authorized subject without a backend provider request', async () => {
  const s = setup(),
    security = withClerkStaffSessions(s.options);
  s.resolve.mockResolvedValue(null);
  expect(await security.authenticateStaff(s.request)).toBeNull();
  expect(s.transport).not.toHaveBeenCalled();
});
it.each([
  'revoked',
  'ended',
  'pending',
  'user',
  'id',
  'absolute',
  'idle',
  'expired',
  'abandoned',
  'future',
  'ordering',
  'missing',
  'numeric-string',
  'actor',
  'object',
])('refuses %s backend session state', async (mode) => {
  const s = setup(),
    state: Record<string, unknown> = { ...s.session };
  if (['revoked', 'ended', 'pending'].includes(mode)) state.status = mode;
  if (mode === 'user') state.user_id = 'user_Another';
  if (mode === 'id') state.id = 'sess_Another';
  if (mode === 'absolute') state.created_at = s.now - 12 * 3600000 - 1;
  if (mode === 'idle') {
    state.created_at = s.now - 3600000;
    state.last_active_at = s.now - 1800001;
  }
  if (mode === 'expired') state.expire_at = s.now;
  if (mode === 'abandoned') state.abandon_at = s.now;
  if (mode === 'future') state.last_active_at = s.now + 1;
  if (mode === 'ordering') state.last_active_at = Number(state.created_at) - 1;
  if (mode === 'missing') delete state.expire_at;
  if (mode === 'numeric-string') state.created_at = String(state.created_at);
  if (mode === 'actor') state.actor = { sub: 'user_Another' };
  if (mode === 'object') state.object = 'user';
  s.transport.mockImplementation(async () => Response.json(state));
  expect(await withClerkStaffSessions(s.options).authenticateStaff(s.request)).toBeNull();
  expect(s.transport).toHaveBeenCalledTimes(1);
});
it('rechecks external session revocation and current local role mapping on every request', async () => {
  const s = setup(),
    security = withClerkStaffSessions(s.options);
  expect((await security.authenticateStaff(s.request))?.staff).toBe(staffId);
  s.session.status = 'revoked';
  expect(await security.authenticateStaff(s.request)).toBeNull();
  expect(s.transport).toHaveBeenCalledTimes(2);
  s.session.status = 'active';
  s.resolve.mockResolvedValue(null);
  expect(await security.authenticateStaff(s.request)).toBeNull();
  expect(s.transport).toHaveBeenCalledTimes(2);
});
it('captures immutable profile/ports and does not observe a later caller configuration mutation', async () => {
  const s = setup(),
    security = withClerkStaffSessions(s.options),
    other = id('staff', '10000000-0000-4000-8000-000000000099');
  if (!other.ok) throw Error('Invalid fixture');
  s.options.resolve = vi.fn(async () => other.value);
  s.options.apiKey = async () => null;
  s.options.publicKeys[0] = 'not a key';
  s.options.authorizedParties[0] = 'https://other.example.invalid';
  s.options.csrfKey.fill(0);
  expect((await security.authenticateStaff(s.request))?.staff).toBe(staffId);
  expect(s.resolve).toHaveBeenCalledTimes(1);
});
it('keeps ordinary owner/partner verification separate and never inherits staff authority', async () => {
  const s = setup(),
    baseActor = {
      keys: [{ keyVersion: 'owner', digest: 'b'.repeat(64) }],
      csrf: 'a'.repeat(64),
      staff: staffId,
      mfaAt: s.now,
    },
    base = { ...s.base, authenticate: vi.fn(async () => baseActor) },
    request = new Request(s.request.url),
    off = withClerkStaffSessions({ enabled: false, base }),
    on = withClerkStaffSessions({ ...s.options, base });
  expect(await off.authenticate(request)).toEqual(baseActor);
  expect(await on.authenticate(request)).toEqual(baseActor);
  expect(await off.authenticateStaff(s.request)).toBeNull();
  expect(await on.authenticateStaff(request)).toBeNull();
});
it.each(['status', 'mime', 'declared-size', 'actual-size', 'invalid-json', 'array', 'no-secret'])(
  'refuses %s provider input with bounded read behavior',
  async (mode) => {
    const s = setup();
    if (mode === 'status')
      s.transport.mockResolvedValue(
        new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
      );
    if (mode === 'mime')
      s.transport.mockResolvedValue(
        new Response('{}', { headers: { 'content-type': 'text/html' } }),
      );
    if (mode === 'declared-size')
      s.transport.mockResolvedValue(
        new Response('{}', {
          headers: { 'content-type': 'application/json', 'content-length': '65537' },
        }),
      );
    if (mode === 'actual-size')
      s.transport.mockResolvedValue(
        new Response(JSON.stringify({ ...s.session, padding: 'x'.repeat(65536) }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    if (mode === 'invalid-json')
      s.transport.mockResolvedValue(
        new Response('{', { headers: { 'content-type': 'application/json' } }),
      );
    if (mode === 'array') s.transport.mockResolvedValue(Response.json([s.session]));
    if (mode === 'no-secret') s.options.apiKey = async () => null;
    expect(await withClerkStaffSessions(s.options).authenticateStaff(s.request)).toBeNull();
    if (mode === 'no-secret') expect(s.transport).not.toHaveBeenCalled();
  },
);

afterEach(() => vi.useRealTimers());
it.each([undefined, 'cl_B7d4PD222AAA', 'cl_B7d4PD333AAA'])(
  'refuses missing, template and machine JWT categories: %s',
  async (cat) => {
    const s = setup({}, { cat });
    expect(await withClerkStaffSessions(s.options).authenticateStaff(s.request)).toBeNull();
    expect(s.resolve).not.toHaveBeenCalled();
    expect(s.transport).not.toHaveBeenCalled();
  },
);
it('accepts a retained rotated public key without fetching provider keys', async () => {
  const s = setup(),
    old = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }),
    unexpected = vi.fn(async () => {
      throw Error('Unexpected network');
    });
  const prior = globalThis.fetch;
  globalThis.fetch = unexpected;
  try {
    const security = withClerkStaffSessions({
      ...s.options,
      publicKeys: [old.publicKey, pair.publicKey],
    });
    expect((await security.authenticateStaff(s.request))?.staff).toBe(staffId);
    expect(unexpected).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = prior;
  }
});
it('keeps CSRF bound to the verified session across token refresh and separates another session', async () => {
  const a = setup(),
    b = setup(),
    c = setup({ sid: 'sess_AnotherSynthetic' });
  c.session.id = 'sess_AnotherSynthetic';
  const actors = await Promise.all(
    [a, b, c].map((s) => withClerkStaffSessions(s.options).authenticateStaff(s.request)),
  );
  expect(actors.every(Boolean)).toBe(true);
  expect(actors[0]!.csrf).toBe(actors[1]!.csrf);
  expect(actors[2]!.csrf).not.toBe(actors[0]!.csrf);
});
it('expires an ignored secret lookup and prevents a late lookup from dispatching provider reads', async () => {
  vi.useFakeTimers();
  const s = setup();
  let release!: (value: string | null) => void;
  s.options.apiKey = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const result = withClerkStaffSessions(s.options).authenticateStaff(s.request);
  await vi.advanceTimersByTimeAsync(3001);
  expect(await result).toBeNull();
  release('sk_test_' + 'synthetic'.repeat(4));
  await vi.advanceTimersByTimeAsync(1);
  expect(s.resolve).not.toHaveBeenCalled();
  expect(s.transport).not.toHaveBeenCalled();
});
it('expires a stalled streamed response and cancels its owned body reader', async () => {
  vi.useFakeTimers();
  const s = setup(),
    cancel = vi.fn();
  s.transport.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{'));
        },
        cancel,
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  const result = withClerkStaffSessions(s.options).authenticateStaff(s.request);
  await vi.waitFor(() => expect(s.transport).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(3100);
  expect(await result).toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
  expect(s.transport).toHaveBeenCalledOnce();
});
it.each(['absolute', 'idle'] as const)(
  'enforces the exact approved %s session age boundary',
  async (mode) => {
    const s = setup();
    s.session.created_at = s.now - 12 * 60 * 60 * 1000;
    s.session.last_active_at = s.now - 30 * 60 * 1000;
    const security = withClerkStaffSessions(s.options);
    expect((await security.authenticateStaff(s.request))?.staff).toBe(staffId);
    if (mode === 'absolute') s.session.created_at--;
    else s.session.last_active_at--;
    expect(await security.authenticateStaff(s.request)).toBeNull();
  },
);
