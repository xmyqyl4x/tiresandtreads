import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createPartnerReviewServices } from '../../packages/application/src/partners/partner-review.ts';
import { ServiceFault } from '../../packages/application/src/services/service-work.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import type { AssetLocation } from '../../packages/application/src/ports/assets.ts';
type Dependencies = Parameters<typeof createPartnerReviewServices>[0];
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const checksum = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function setup() {
  const now = Date.parse('2026-11-08T00:00:00.000Z'),
    bytes = new TextEncoder().encode('{"review":"synthetic"}');
  const actor = {
    subject: 'independent-staff',
    emailVerified: true as const,
    emailDomain: 'example.invalid',
    staffId: id,
    mfaAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600000).toISOString(),
  };
  const asset: AssetLocation = {
    id: id as never,
    revision: 1n as never,
    key: 'assets/' + id,
    mime: 'application/json',
    sha256: checksum(bytes),
    size: bytes.length,
    version: 'synthetic-v1',
    state: 'ready',
  };
  const profile = {
    services: ['sales'],
    state: 'submitted',
    revision: 1n,
    emailDomain: 'example.invalid',
  };
  const root = {
    organization: {
      id,
      legalName: 'Synthetic',
      status: 'pending',
      verification: 'pending',
      revision: 1n,
    },
    member: null,
    profile: profile as typeof profile | null,
  };
  const queue = vi.fn(async () => [
      {
        org: id,
        resource: id,
        version: null as number | null,
        title: 'Synthetic',
        state: 'submitted',
        revision: 1n,
      },
    ]),
    context = vi.fn(async () => ({ assets: [], agreements: [], locations: [], truncated: false })),
    targets = vi.fn(async () => []);
  const staff = vi.fn(async () => undefined),
    lock = vi.fn(async () => root),
    audit = vi.fn(async () => undefined),
    verify = vi.fn(async () => ok(actor));
  const offer = {
    organizationId: id,
    offerId: other,
    version: 1,
    status: 'pending_review',
    title: 'Synthetic',
    partnerAuthor: 'PRIVATE',
  };
  const version = vi.fn(async () => offer as typeof offer | null),
    eligible = vi.fn(async () => false),
    render = vi.fn(async () => ({ text: 'Exact stored terms', html: 'unused' })),
    get = vi.fn(async () => asset),
    objectGet = vi.fn(async () => bytes),
    inspect = vi.fn(async (_p: unknown, _m: unknown, b: Uint8Array) => b);
  const deps = {
    policy: {
      version: 'local',
      agreements: Object.fromEntries(
        ['pilot_terms', 'privacy', 'dpa'].map((k) => [
          k,
          { version: 'v1', sha256: 'a'.repeat(64) },
        ]),
      ),
      excludedEmailDomains: [],
    },
    uow: { run: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
    clock: { now: () => now },
    authority: { verify },
    onboarding: { staff, lock, audit },
    crypto: {
      checksum,
      digest: (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
    },
    review: { queue, context, targets },
    offers: { version, eligible },
    preview: { render },
    assets: { get },
    objects: { get: objectGet },
    files: { inspect },
  } as unknown as Dependencies;
  return {
    service: createPartnerReviewServices(deps),
    queue,
    context,
    targets,
    staff,
    lock,
    audit,
    verify,
    actor,
    root,
    offer,
    version,
    eligible,
    render,
    get,
    objectGet,
    inspect,
    asset,
    bytes,
  };
}
it('returns bounded permission-scoped business and composite offer cursor pages', async () => {
  const s = setup();
  s.queue.mockResolvedValue([
    { org: id, resource: id, version: null, title: 'First', state: 'submitted', revision: 1n },
    {
      org: other,
      resource: other,
      version: null,
      title: 'Second',
      state: 'submitted',
      revision: 1n,
    },
  ]);
  const first = await s.service.queue('credential', 'businesses', null, 1);
  expect(first).toMatchObject({ ok: true, value: { items: [{ org: id }], next: id } });
  expect(s.staff).toHaveBeenNthCalledWith(
    1,
    expect.anything(),
    expect.anything(),
    'partner.verify',
  );
  expect((await s.service.queue('credential', 'businesses', id, 25)).ok).toBe(true);
  s.queue.mockResolvedValue([
    { org: id, resource: other, version: 1, title: 'First', state: 'pending_review', revision: 1n },
    {
      org: other,
      resource: other,
      version: 2,
      title: 'Second',
      state: 'pending_review',
      revision: 1n,
    },
  ]);
  expect(await s.service.queue('credential', 'offers', null, 1)).toMatchObject({
    ok: true,
    value: { next: id + ':' + other + ':1' },
  });
  expect((await s.service.queue('credential', 'offers', id + ':' + other + ':1', 25)).ok).toBe(
    true,
  );
  s.queue.mockResolvedValue([]);
  expect(await s.service.queue('credential', 'businesses', null, 25)).toMatchObject({
    ok: true,
    value: { items: [], next: null },
  });
});
it.each([
  ['businesses', null, 0],
  ['businesses', null, 26],
  ['businesses', null, 1.5],
  ['other', null, 1],
  ['businesses', 'bad', 1],
  ['businesses', id + ':extra', 1],
  ['offers', id, 1],
  ['offers', id + ':' + other + ':0', 1],
  ['offers', id + ':' + other + ':01', 1],
  ['offers', id + ':' + other + ':2147483648', 1],
  ['offers', id + ':bad:1', 1],
  ['businesses', 'x'.repeat(129), 1],
] as const)(
  'rejects malformed review paging before querying (%s,%s,%s)',
  async (kind, after, limit) => {
    const s = setup();
    expect((await s.service.queue('credential', kind as never, after, limit)).ok).toBe(false);
    expect(s.queue).not.toHaveBeenCalled();
  },
);
it('refuses a role denied before reading and a role revoked during a read', async () => {
  const s = setup();
  s.staff.mockRejectedValueOnce(new ServiceFault('forbidden'));
  expect((await s.service.queue('credential', 'businesses', null, 1)).ok).toBe(false);
  expect(s.queue).not.toHaveBeenCalled();
  s.staff.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ServiceFault('forbidden'));
  expect((await s.service.queue('credential', 'offers', null, 1)).ok).toBe(false);
});
it('projects current business context and rejects a missing onboarding profile', async () => {
  const s = setup();
  expect(await s.service.business('credential', id as never)).toMatchObject({
    ok: true,
    value: { profile: { state: 'submitted' }, truncated: false },
  });
  s.root.profile = null;
  expect((await s.service.business('credential', id as never)).ok).toBe(false);
});
it('reauthorizes current staff after rendering exact offer text without exposing its author', async () => {
  const s = setup();
  const r = await s.service.offer('credential', id as never, other as never, 1);
  expect(r).toMatchObject({
    ok: true,
    value: { state: 'pending_review', text: 'Exact stored terms', targets: [] },
  });
  if (r.ok) expect(r.value).not.toHaveProperty('partnerAuthor');
  expect(s.staff).toHaveBeenCalledTimes(2);
});
it.each([0, 1.5, 2147483648])('refuses invalid review version %s', async (version) => {
  const s = setup();
  expect((await s.service.offer('credential', id as never, other as never, version)).ok).toBe(
    false,
  );
  expect(s.render).not.toHaveBeenCalled();
});
it('refuses a nonexistent offer and permission failure before rendering', async () => {
  const s = setup();
  s.version.mockResolvedValueOnce(null);
  expect((await s.service.offer('credential', id as never, other as never, 1)).ok).toBe(false);
  expect(s.render).not.toHaveBeenCalled();
  s.staff.mockRejectedValueOnce(new ServiceFault('forbidden'));
  expect((await s.service.offer('credential', id as never, other as never, 1)).ok).toBe(false);
});
it('rejects changed authority, changed immutable offer snapshot and changed eligibility after rendering', async () => {
  for (const scenario of ['authority', 'snapshot', 'eligibility', 'permission'] as const) {
    const s = setup();
    s.render.mockImplementationOnce(async () => {
      if (scenario === 'authority')
        s.verify.mockResolvedValueOnce(ok({ ...s.actor, subject: 'different' }));
      if (scenario === 'snapshot')
        s.version.mockResolvedValueOnce({ ...s.offer, title: 'Changed' });
      if (scenario === 'eligibility') s.eligible.mockResolvedValueOnce(true);
      if (scenario === 'permission') s.staff.mockRejectedValueOnce(new ServiceFault('forbidden'));
      return { text: 'Private terms', html: 'unused' };
    });
    expect((await s.service.offer('credential', id as never, other as never, 1)).ok).toBe(false);
  }
});
it('checks private evidence integrity outside the transaction then reauthorizes and audits only its reference', async () => {
  const s = setup();
  expect(
    await s.service.evidence('credential', id as never, id as never, 'verification'),
  ).toMatchObject({
    ok: true,
    value: { id, purpose: 'verification', text: '{"review":"synthetic"}' },
  });
  expect(s.inspect).toHaveBeenCalledWith('verification', 'application/json', s.bytes);
  expect(s.staff).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(s.audit.mock.calls)).not.toContain('synthetic');
});
it.each([
  'purpose',
  'state',
  'mime',
  'size',
  'bytes',
  'checksum',
  'identity',
  'revision',
  'permission',
] as const)('denies adverse private evidence %s without a successful audit', async (scenario) => {
  const s = setup();
  if (scenario === 'state') s.get.mockResolvedValueOnce({ ...s.asset, state: 'pending' });
  if (scenario === 'mime') s.get.mockResolvedValueOnce({ ...s.asset, mime: 'text/plain' });
  if (scenario === 'size') s.get.mockResolvedValueOnce({ ...s.asset, size: 65537 });
  if (scenario === 'bytes') s.objectGet.mockResolvedValueOnce(new Uint8Array(0));
  if (scenario === 'checksum') s.objectGet.mockResolvedValueOnce(new Uint8Array(s.bytes.length));
  if (['identity', 'revision', 'permission'].includes(scenario))
    s.objectGet.mockImplementationOnce(async () => {
      if (scenario === 'identity')
        s.verify.mockResolvedValueOnce(ok({ ...s.actor, subject: 'different' }));
      if (scenario === 'revision')
        s.get.mockResolvedValueOnce({ ...s.asset, revision: 2n as never });
      if (scenario === 'permission') s.staff.mockRejectedValueOnce(new ServiceFault('forbidden'));
      return s.bytes;
    });
  expect(
    (
      await s.service.evidence(
        'credential',
        id as never,
        id as never,
        scenario === 'purpose' ? ('logo' as never) : 'agreement',
      )
    ).ok,
  ).toBe(false);
  expect(s.audit).not.toHaveBeenCalled();
});
