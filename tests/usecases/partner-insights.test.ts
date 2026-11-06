import { beforeEach, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPartnerInsightsServices } from '../../packages/application/src/partners/partner-insights.ts';
import { createPartnerCrypto } from '../../packages/integrations/src/partner-crypto.ts';
import { createInsightsTokens } from '../../packages/integrations/src/insights-tokens.ts';
import { ok, fail, type Id, type Instant } from '../../packages/domain/src/values/core.ts';
import type { PartnerAuthority } from '../../packages/application/src/ports/partner-services.ts';
import type { PartnerPrincipal } from '../../packages/domain/src/partner-policy.ts';
import type { PartnerInsightsRepository } from '../../packages/application/src/ports/partner-insights.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
} from '../../packages/application/src/ports/transactions.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { ServiceFault } from '../../packages/application/src/services/service-work.ts';
const uuid = <K extends string>(n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as Id<K>;
const clock = Date.parse('2026-11-06T12:00:00.000Z'),
  week = '2026-10-26',
  org = uuid<'organization'>(1),
  subject = uuid<'subject'>(2),
  contact = uuid<'contact'>(3),
  assignment = uuid<'coupon_assignment'>(4);
let d: ReturnType<typeof dependencies>, service: ReturnType<typeof createPartnerInsightsServices>;
function dependencies() {
  const p: PartnerPrincipal = {
    subject: 'staff',
    staffId: uuid<'staff'>(20),
    emailVerified: true,
    emailDomain: 'synthetic.example',
    mfaAt: new Date(clock - 1000).toISOString() as Instant,
    expiresAt: new Date(clock + 60000).toISOString() as Instant,
  };
  const repo = {
    member: vi.fn<PartnerInsightsRepository['member']>(async () => {}),
    staff: vi.fn<PartnerInsightsRepository['staff']>(async () => {}),
    release: vi.fn<PartnerInsightsRepository['release']>(async () => ({
      state: 'suppressed',
      week,
      computedAt: new Date(clock).toISOString() as Instant,
      cells: null,
    })),
    redemption: vi.fn<PartnerInsightsRepository['redemption']>(async () =>
      uuid<'redemption_event'>(9),
    ),
    dispute: vi.fn<PartnerInsightsRepository['dispute']>(async () => ({
      id: uuid<'partner_dispute'>(10),
      reason: 'terms',
      state: 'open',
      revision: 1,
      createdAt: new Date(clock).toISOString() as Instant,
    })),
    disputes: vi.fn<PartnerInsightsRepository['disputes']>(async () => []),
    click: vi.fn<PartnerInsightsRepository['click']>(async () => {}),
    health: vi.fn<PartnerInsightsRepository['health']>(async () => ({
      accepted: '0',
      uncertain: '0',
      delivered: '0',
      bounced: '0',
      complained: '0',
      suspectedHumanOpens: '0',
      machineOpens: '0',
      unknownOpens: '0',
      suspectedHumanClicks: '0',
      machineClicks: '0',
      unknownClicks: '0',
    })),
    importDomain: vi.fn<PartnerInsightsRepository['importDomain']>(async () => {}),
    domains: vi.fn<PartnerInsightsRepository['domains']>(async () => []),
    visitors: vi.fn<PartnerInsightsRepository['visitors']>(async () => [
      {
        subject,
        lastSeen: new Date(clock).toISOString() as Instant,
        sessions: '2',
        events: '3',
        routes: ['/assess'],
        channels: ['web'],
      },
    ]),
    reveal: vi.fn<PartnerInsightsRepository['reveal']>(async () => ({
      id: contact,
      revision: '1',
      envelope: { keyVersion: 'synthetic', hex: 'aa'.repeat(40) },
    })),
    purge: vi.fn<PartnerInsightsRepository['purge']>(async () => {}),
    maintenance: vi.fn<PartnerInsightsRepository['maintenance']>(async () => 1),
  };
  const uow: UnitOfWork = {
    async run(fn) {
      return fn({} as Tx);
    },
  };
  return {
    uow,
    repository: repo as unknown as PartnerInsightsRepository,
    repo,
    authority: { verify: vi.fn<PartnerAuthority['verify']>(async () => ok(p)) },
    principal: p,
    clock: { now: () => clock },
    crypto: createPartnerCrypto('v1', { v1: randomBytes(32) }, randomBytes(32)),
    tokens: createInsightsTokens(randomBytes(32)),
    encryption: {
      encrypt: vi.fn(async () => ({ keyVersion: 'synthetic', hex: 'aa'.repeat(40) })),
      decrypt: vi.fn(async () => new TextEncoder().encode('synthetic@example.invalid')),
    },
  };
}
beforeEach(() => {
  d = dependencies();
  service = createPartnerInsightsServices(d);
});
const command = () => ({
  key: uuid<'command'>(5),
  assignment,
  kind: 'reported' as const,
  quantity: 1,
  previous: null,
  occurredAt: new Date(clock).toISOString() as Instant,
});
const dispute = () => ({
  key: uuid<'command'>(6),
  id: uuid<'partner_dispute'>(10),
  assignment,
  reason: 'terms' as const,
  kind: 'opened' as const,
  expected: 0,
  details: 'Synthetic disputed terms',
});
const click = () => ({
  key: uuid<'command'>(7),
  organization: org,
  assignment,
  method: 'GET' as const,
  classification: 'suspected_human' as const,
  occurredAt: new Date(clock).toISOString() as Instant,
});
it('labels partner reporting without exposing recipients, codes or charging', async () => {
  expect(await service.report('session', org, week)).toMatchObject({
    ok: true,
    value: {
      cells: null,
      pilot: 'noncharging',
      attribution: 'reported redemption is not a verified sale',
    },
  });
  expect(d.repo.member).toHaveBeenCalledTimes(2);
});
it('keeps internal insights explicitly unexportable and separately authorized', async () => {
  expect(await service.internal('session', week)).toMatchObject({
    ok: true,
    value: { exportEnabled: false },
  });
  expect(d.repo.staff.mock.calls).toHaveLength(2);
});
it.each(['', '2026-11-02', '2026-10-27'])(
  'rejects invalid reporting periods before authorization %s',
  async (w) => {
    expect((await service.report('session', org, w)).ok).toBe(false);
    expect(d.repo.release).not.toHaveBeenCalled();
  },
);
it('rejects missing authentication before persistence', async () => {
  d.authority.verify.mockResolvedValueOnce(fail(failure('forbidden')));
  expect((await service.report('session', org, week)).ok).toBe(false);
  expect(d.repo.member).not.toHaveBeenCalled();
});
it('rejects stale MFA proof', async () => {
  Object.assign(d.principal, { mfaAt: new Date(clock - 300001).toISOString() as Instant });
  expect((await service.report('session', org, week)).ok).toBe(false);
});
it('refuses an operation if the MFA deadline expires during work', async () => {
  let at = clock;
  d.clock.now = () => at;
  d.repo.release.mockImplementationOnce(async () => {
    at += 600000;
    return {
      state: 'suppressed',
      week,
      computedAt: new Date(clock).toISOString() as Instant,
      cells: null,
    };
  });
  expect((await service.report('session', org, week)).ok).toBe(false);
});
it('propagates a final membership refusal without exposing the read', async () => {
  d.repo.member
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(async () => {
      throw new ServiceFault('forbidden');
    });
  expect(await service.report('session', org, week)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
it('captures a redemption command before asynchronous authority yields', async () => {
  const v = command();
  d.authority.verify.mockImplementationOnce(async () => {
    v.quantity = 4;
    return ok(d.principal);
  });
  expect((await service.redemption('session', org, v)).ok).toBe(true);
  expect(d.repo.redemption.mock.calls[0]![3]).toMatchObject({ quantity: 1 });
});
it.each([
  { quantity: 0 },
  { quantity: 5 },
  { quantity: 1.5 },
  { previous: uuid<'redemption_event'>(9) },
  { occurredAt: 'bad' },
  { occurredAt: '2026-01-01T00:00:00.000Z' },
  { kind: 'sale' },
])('rejects malformed redemption %j', async (change) => {
  expect((await service.redemption('session', org, { ...command(), ...change } as never)).ok).toBe(
    false,
  );
  expect(d.repo.redemption).not.toHaveBeenCalled();
});
it('supports a correction delta without asserting a sale', async () => {
  expect(
    await service.redemption('session', org, {
      ...command(),
      kind: 'correction',
      quantity: -1,
      previous: uuid<'redemption_event'>(20),
    }),
  ).toMatchObject({ ok: true, value: { verifiedSale: false, charging: false } });
});
it('encrypts dispute details and never passes plaintext to SQL', async () => {
  expect((await service.dispute('session', org, dispute())).ok).toBe(true);
  expect(JSON.stringify(d.repo.dispute.mock.calls)).not.toContain(dispute().details);
  expect(d.encryption.encrypt).toHaveBeenCalledOnce();
});
it.each([
  { reason: 'secret' },
  { kind: 'delete' },
  { expected: -1 },
  { expected: 1 },
  { details: '<script>' },
  { details: 'x'.repeat(2001) },
])('refuses invalid disputes %j', async (change) => {
  expect((await service.dispute('session', org, { ...dispute(), ...change } as never)).ok).toBe(
    false,
  );
  expect(d.repo.dispute).not.toHaveBeenCalled();
});
it('requires independent caseworker authority for resolution', async () => {
  expect(
    (await service.dispute('session', org, { ...dispute(), kind: 'resolved', expected: 1 })).ok,
  ).toBe(true);
  expect(d.repo.staff).toHaveBeenCalled();
  expect(d.repo.member).not.toHaveBeenCalled();
});
it('keeps evidence updates under current tenant write authorization', async () => {
  expect(
    (await service.dispute('session', org, { ...dispute(), kind: 'evidence', expected: 1 })).ok,
  ).toBe(true);
  expect(d.repo.member).toHaveBeenCalled();
});
it('requires authority again after asynchronous encryption', async () => {
  d.authority.verify
    .mockResolvedValueOnce(ok(d.principal))
    .mockResolvedValueOnce(fail(failure('forbidden')));
  expect((await service.dispute('session', org, dispute())).ok).toBe(false);
  expect(d.repo.dispute).not.toHaveBeenCalled();
});
it('reads only bounded masked disputes', async () => {
  expect((await service.disputes('session', org)).ok).toBe(true);
  expect((await service.disputes('session', org, null, 51)).ok).toBe(false);
});
it.each([
  { method: 'POST' },
  { classification: 'human' },
  { occurredAt: '2026-12-01T00:00:00.000Z' },
])('refuses untrusted click shapes %j', async (change) => {
  expect((await service.offerClick('session', { ...click(), ...change } as never)).ok).toBe(false);
  expect(d.repo.click).not.toHaveBeenCalled();
});
it('requires the server event role without changing allocations', async () => {
  expect(await service.offerClick('session', click())).toMatchObject({
    ok: true,
    value: { allocationChanged: false },
  });
});
it('keeps machine opens and missing domain attribution explicit', async () =>
  expect(await service.health('session', week)).toMatchObject({
    ok: true,
    value: {
      opensAreEstimates: true,
      domainAttribution: 'unavailable; sends have no recorded sender domain',
    },
  }));
it('imports unavailable structured domain samples without inventing reputation', async () =>
  expect(
    (
      await service.importDomain('session', uuid<'command'>(20), {
        domain: 'mail.example.com',
        source: 'google_postmaster',
        day: '2026-11-05',
        status: 'unavailable',
        reputation: null,
        spamBasisPoints: null,
        sampleSize: null,
      })
    ).ok,
  ).toBe(true));
it('rejects a malformed domain import before SQL', async () => {
  expect((await service.importDomain('session', uuid<'command'>(20), {})).ok).toBe(false);
  expect(d.repo.importDomain).not.toHaveBeenCalled();
});
it('normalizes domain health lookup and rejects URLs', async () => {
  expect((await service.domains('session', 'MAIL.EXAMPLE.COM')).ok).toBe(true);
  expect((await service.domains('session', 'https://mail.example.com')).ok).toBe(false);
});
it('returns encrypted visitor references and masked contact fields', async () => {
  const v = await service.visitors('session', week);
  expect(v).toMatchObject({ ok: true, value: { items: [{ contact: 'masked' }], next: null } });
  expect(JSON.stringify(v)).not.toContain(subject);
});
it('binds page continuations to actor, purpose and fixed week', async () => {
  const c = d.tokens.issue('other', 'page', { subject, week }, clock);
  expect((await service.visitors('session', week, c)).ok).toBe(false);
});
it('provides a bounded next cursor without exposing IDs', async () => {
  d.repo.visitors.mockResolvedValueOnce(
    Array.from({ length: 2 }, () => ({
      subject,
      lastSeen: new Date(clock).toISOString() as Instant,
      sessions: '2',
      events: '3',
      routes: ['/assess'],
      channels: ['web'],
    })),
  );
  const v = await service.visitors('session', week, null, 1);
  expect(v).toMatchObject({
    ok: true,
    value: { next: expect.any(String), items: [expect.any(Object)] },
  });
});
it.each([0, 51, 1.1])('rejects unbounded explorer page size %s', async (n) =>
  expect((await service.visitors('session', week, null, n)).ok).toBe(false),
);
it('logs an authorized contact read before decryption and checks current eligibility afterward', async () => {
  const token = d.tokens.issue('staff', 'visitor', { subject, week }, clock);
  expect(await service.reveal('session', token, 'support_request', uuid<'case'>(20))).toMatchObject(
    { ok: true, value: { email: 'synthetic@example.invalid', exportEnabled: false } },
  );
  expect(d.repo.reveal).toHaveBeenCalledTimes(2);
  expect(d.repo.reveal.mock.invocationCallOrder[0]!).toBeLessThan(
    d.encryption.decrypt.mock.invocationCallOrder[0]!,
  );
});
it('never decrypts if the audit transaction fails', async () => {
  d.repo.reveal.mockRejectedValueOnce(Error('SQL unavailable'));
  const token = d.tokens.issue('staff', 'visitor', { subject, week }, clock);
  expect((await service.reveal('session', token, 'privacy_request', uuid<'case'>(20))).ok).toBe(
    false,
  );
  expect(d.encryption.decrypt).not.toHaveBeenCalled();
});
it('withholds decrypted contact data if current permission is gone', async () => {
  d.repo.reveal
    .mockResolvedValueOnce({
      id: contact,
      revision: '1',
      envelope: { keyVersion: 'synthetic', hex: 'aa'.repeat(40) },
    })
    .mockResolvedValueOnce(null as never);
  const token = d.tokens.issue('staff', 'visitor', { subject, week }, clock);
  expect((await service.reveal('session', token, 'privacy_request', uuid<'case'>(20))).ok).toBe(
    false,
  );
});
it('does not reveal contact data from another actor handle', async () => {
  const token = d.tokens.issue('other', 'visitor', { subject, week }, clock);
  expect((await service.reveal('session', token, 'support_request', uuid<'case'>(20))).ok).toBe(
    false,
  );
});
it('rejects malformed decrypted addresses', async () => {
  d.encryption.decrypt.mockResolvedValueOnce(new TextEncoder().encode('private\nsecret'));
  const token = d.tokens.issue('staff', 'visitor', { subject, week }, clock);
  expect((await service.reveal('session', token, 'support_request', uuid<'case'>(20))).ok).toBe(
    false,
  );
});
it('does not claim full subject erasure for the operations-only purge', async () =>
  expect(await service.purge('session', subject)).toMatchObject({
    ok: true,
    value: { fullSubjectErasureAccepted: false },
  }));
it('runs bounded maintenance and rejects an oversized batch', async () => {
  expect(await service.maintenance('session')).toMatchObject({ ok: true, value: { purged: 1 } });
  expect((await service.maintenance('session', 501)).ok).toBe(false);
});
