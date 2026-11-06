import { it, expect, vi } from 'vitest';
import { createPilotDeliveryServices } from '../../packages/application/src/partners/pilot-delivery.ts';
import { createPartnerCrypto } from '../../packages/integrations/src/partner-crypto.ts';
import {
  failure,
  type UnitOfWork,
  type TransactionContext,
  type ApplicationFailure,
} from '../../packages/application/src/ports/transactions.ts';
import { ServiceFault } from '../../packages/application/src/services/service-work.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import type {
  PilotContext,
  PilotLease,
  PilotOffer,
  PilotHeld,
  PilotPolicy,
  PilotRepository,
  PilotProvider,
  PilotRenderer,
  PilotRequest,
} from '../../packages/application/src/ports/pilot-delivery.ts';
import type { ContactEncryption } from '../../packages/application/src/ports/contact-services.ts';
import type { DeliveryFiles } from '../../packages/application/src/ports/delivery-services.ts';
import { audience, candidate } from '../fixtures/phase2/matching.ts';
import { uuid, time } from '../fixtures/phase2/compose-partner-services.ts';
function setup() {
  const crypto = createPartnerCrypto(
      'v1',
      { v1: new Uint8Array(32).fill(31) },
      new Uint8Array(32).fill(32),
    ),
    send = uuid('send'),
    policy: PilotPolicy = {
      version: 'unit-pilot',
      timeZone: 'UTC',
      offersNotice: uuid('notice'),
      reportNotice: uuid('notice'),
      consentPolicy: 'unit',
      provider: 'fixture',
      fixture: true,
      creditUnits: 1n,
    },
    lease: PilotLease = { sendId: send, token: uuid('lease'), generation: '1', state: 'queued' },
    offer: PilotOffer = {
      ...candidate(),
      poolId: uuid('coupon_pool'),
      mode: 'shared',
      prefix: null,
      caps: [],
    };
  const location = { region: null, postal: null, latitude: null, longitude: null };
  const context: PilotContext = {
    policyVersion: policy.version,
    sendId: send,
    ownerId: uuid('subject'),
    recipientId: uuid('subject'),
    contactId: uuid('contact'),
    provider: 'fixture',
    providerKey: 'stable-unit-key',
    permissionRevision: '1',
    reportAllowed: true,
    offersAllowed: true,
    audience,
    document: {
      schemaVersion: 1,
      fixture: true,
      locale: 'en-US',
      market: 'US',
      sender: 'unit@example.invalid',
      policyVersion: policy.version,
      report: { issuanceAuthorized: false },
      comparison: null,
      template: { id: uuid('template'), version: '1', rendererHash: 'a'.repeat(64) },
      learning: [],
    },
    geo: { box: { keyVersion: 'unit', hex: 'b'.repeat(64) }, digest: crypto.digest(location) },
    contact: { keyVersion: 'unit', hex: 'a'.repeat(64) },
  };
  const original: PilotHeld = {
    assignment: {
      id: uuid('coupon_assignment'),
      organizationId: offer.offer.organizationId,
      sendId: send,
      subjectId: context.ownerId,
      offerId: offer.offer.offerId,
      version: 1,
      poolId: offer.poolId,
      mode: 'shared',
      codeId: null,
      slot: 1,
      policyVersion: policy.version,
      state: 'reserved',
      reservedAt: time(),
    },
    offer,
    seal: crypto.seal(offer.offer.organizationId, offer.poolId, 'UNIT-CODE', 'v1'),
  };
  let held: readonly PilotHeld[] = [];
  const repo = {
    authorize: vi.fn(async () => {}),
    capture: vi.fn<PilotRepository['capture']>(async () => {}),
    acquire: vi.fn<PilotRepository['acquire']>(async () => lease),
    context: vi.fn(async () => context),
    candidates: vi.fn(async () => [offer]),
    reserve: vi.fn<PilotRepository['reserve']>(async (_tx, _l, _c, offers) => {
      held = offers.length ? [original] : [];
    }),
    held: vi.fn(async () => held),
    trim: vi.fn<PilotRepository['trim']>(async (_tx, _l, keep) => {
      held = held.filter((h) => keep.includes(h.assignment.id));
    }),
    reservePayload: vi.fn(async () => {}),
    claim: vi.fn(async () => true),
    finish: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
  let nextFailure: ApplicationFailure | null = null;
  const uow: UnitOfWork = {
    async run(work) {
      if (nextFailure) {
        const f = nextFailure;
        nextFailure = null;
        return fail(f);
      }
      try {
        return await work({} as TransactionContext);
      } catch {
        return fail(failure('unavailable'));
      }
    },
  };
  const envelopes = new Map<string, Uint8Array>(),
    objects = new Map<string, Uint8Array>();
  const encryption: ContactEncryption = {
    encrypt: vi.fn(async (bytes, purpose, id) => {
      envelopes.set(purpose + id, new Uint8Array(bytes));
      return { keyVersion: 'unit', hex: crypto.checksum(bytes) };
    }),
    decrypt: vi.fn(async (_box, purpose, id) =>
      purpose === 'contact_email'
        ? new TextEncoder().encode('unit@example.invalid')
        : new Uint8Array(envelopes.get(purpose + id)!),
    ),
  };
  envelopes.set('pilot_geo' + send, new TextEncoder().encode(JSON.stringify(location)));
  const files: DeliveryFiles = {
    put: vi.fn(async (id, _purpose, bytes) => {
      objects.set(id, new Uint8Array(bytes));
    }),
    get: vi.fn(async (id) => new Uint8Array(objects.get(id)!)),
  };
  const renderer = {
    fixture: true,
    render: vi.fn<PilotRenderer['render']>(async (_c, blocks) => ({
      subject: 'Unit',
      html: '<html><body>Frozen unit message</body></html>',
      text: 'Unit message',
      pdf: _c.reportAllowed ? 'JVBERi0=' : null,
      commercial: blocks.length > 0,
      stream: blocks.length ? 'commercial' : 'report',
      headers: blocks.length
        ? {
            'List-Unsubscribe': '<https://preview.example.invalid/unsubscribe>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : {},
      unsubscribeUrl: blocks.length ? 'https://preview.example.invalid/unsubscribe' : null,
      fixture: true,
    })),
  };
  const provider = {
    name: 'fixture',
    fixture: true,
    send: vi.fn<PilotProvider['send']>(async () => ({
      outcome: 'accepted',
      messageId: 'unit-message',
    })),
  };
  const deps = { uow, repository: repo, policy, crypto, encryption, files, renderer, provider },
    service = createPilotDeliveryServices(deps),
    request: PilotRequest = {
      includeOffers: true,
      itemKey: 'chosen',
      adult: true,
      quantity: 4,
      region: null,
      postal: null,
      latitude: null,
      longitude: null,
    },
    keys = [{ keyVersion: 'v1', digest: 'a'.repeat(64) }];
  return {
    deps,
    service,
    repo,
    context,
    lease,
    offer,
    original,
    provider,
    renderer,
    encryption,
    files,
    send,
    request,
    keys,
    failNext: () => {
      nextFailure = failure('unavailable');
    },
    hold: () => {
      held = [original];
    },
  };
}
it('freezes exact bytes and stable provider identity before handoff and records acceptance', async () => {
  const s = setup();
  expect(await s.service.dispatch(s.send)).toEqual(ok({ state: 'accepted' }));
  expect(s.provider.send.mock.calls[0]![0]).toBe(s.context.providerKey);
  expect(s.repo.claim.mock.invocationCallOrder[0]).toBeLessThan(
    s.provider.send.mock.invocationCallOrder[0]!,
  );
  expect(s.repo.finish).toHaveBeenCalledWith(
    expect.anything(),
    s.lease,
    'accepted',
    'unit-message',
  );
});
it.each(['credit', 'provider', 'environment', 'notice', 'zone'])(
  'refuses invalid %s configuration',
  (kind) => {
    const s = setup(),
      d = { ...s.deps, policy: { ...s.deps.policy } };
    if (kind === 'credit') d.policy.creditUnits = 0n;
    if (kind === 'provider') d.policy.provider = 'other';
    if (kind === 'environment') d.policy.fixture = false;
    if (kind === 'notice') d.policy.offersNotice = 'wrong' as never;
    if (kind === 'zone') d.policy.timeZone = 'not/a/zone';
    expect(() => createPilotDeliveryServices(d)).toThrow();
  },
);
it.each([
  { quantity: 0 },
  { quantity: 5 },
  { adult: 'yes' },
  { includeOffers: 'yes' },
  { region: '<script>' },
  { postal: 'x'.repeat(101) },
  { latitude: 91, longitude: 0 },
  { latitude: 0, longitude: 181 },
  { latitude: 0, longitude: null },
  { latitude: NaN, longitude: 0 },
])('rejects invalid request %j before persistence', async (patch) => {
  const s = setup();
  expect(
    (await s.service.request(s.keys, s.send, { ...s.request, ...patch } as PilotRequest)).ok,
  ).toBe(false);
  expect(s.repo.capture).not.toHaveBeenCalled();
});
it('captures request and key input before awaiting persistence', async () => {
  const s = setup(),
    request = { ...s.request },
    keys = [{ ...s.keys[0]! }];
  const p = s.service.request(keys, s.send, request);
  request.adult = false;
  keys[0]!.digest = '0'.repeat(64);
  expect((await p).ok).toBe(true);
  expect(s.repo.capture.mock.calls[0]![3].adult).toBe(true);
  expect(s.repo.capture.mock.calls[0]![1][0]!.digest).toBe('a'.repeat(64));
});
it('cancels through current authenticated owner keys and validates send identities', async () => {
  const s = setup();
  expect((await s.service.cancel(s.keys, s.send)).ok).toBe(true);
  expect(s.repo.cancel).toHaveBeenCalledOnce();
  expect((await s.service.cancel(s.keys, 'bad' as never)).ok).toBe(false);
});
it('has no persistence effects during reproducible simulation', async () => {
  const s = setup();
  expect((await s.service.simulate(audience, [s.offer])).ok).toBe(true);
  expect(s.repo.acquire).not.toHaveBeenCalled();
  expect(
    (
      await s.service.simulate(
        audience,
        Array.from({ length: 201 }, () => s.offer),
      )
    ).ok,
  ).toBe(false);
});
it('returns idle for a leased or terminal send and refuses malformed IDs', async () => {
  const s = setup();
  s.repo.acquire.mockResolvedValue(null);
  expect(await s.service.dispatch(s.send)).toEqual(ok({ state: 'idle' }));
  expect((await s.service.dispatch('bad' as never)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('propagates acquisition and current-source failures without dispatch', async () => {
  const s = setup();
  s.failNext();
  expect((await s.service.dispatch(s.send)).ok).toBe(false);
  s.repo.context.mockRejectedValueOnce(Error('private details'));
  expect((await s.service.dispatch(s.send)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('recovers an interrupted handoff as uncertain without a second provider call', async () => {
  const s = setup();
  s.repo.acquire.mockResolvedValue({ ...s.lease, state: 'dispatching' });
  expect(await s.service.dispatch(s.send)).toEqual(ok({ state: 'uncertain' }));
  expect(s.provider.send).not.toHaveBeenCalled();
  expect(s.repo.finish).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    'uncertain',
    null,
  );
});
it('propagates failed handoff recovery without dispatch or release', async () => {
  const s = setup();
  s.repo.acquire.mockResolvedValue({ ...s.lease, state: 'dispatching' });
  s.repo.finish.mockRejectedValue(Error('unavailable'));
  expect((await s.service.dispatch(s.send)).ok).toBe(false);
  expect(s.repo.retry).not.toHaveBeenCalled();
});
it('resumes existing reservations after a pre-handoff interruption without allocating again', async () => {
  const s = setup();
  s.hold();
  s.repo.acquire.mockResolvedValue({ ...s.lease, state: 'reserved' });
  expect((await s.service.dispatch(s.send)).ok).toBe(true);
  expect(s.repo.reserve).not.toHaveBeenCalled();
});
it('bounds allocation conflict retries and preserves a report-only fallback', async () => {
  const s = setup();
  s.repo.reserve.mockRejectedValueOnce(new ServiceFault('conflict'));
  expect((await s.service.dispatch(s.send)).ok).toBe(true);
  expect(s.repo.reserve).toHaveBeenCalledTimes(2);
  expect(s.provider.send.mock.calls[0]![1].mail.commercial).toBe(false);
});
it('fails closed after four allocation conflicts and on integrity failures', async () => {
  const s = setup();
  s.repo.reserve.mockRejectedValue(new ServiceFault('conflict'));
  expect((await s.service.dispatch(s.send)).ok).toBe(false);
  expect(s.repo.reserve).toHaveBeenCalledTimes(4);
  expect(s.provider.send).not.toHaveBeenCalled();
  const t = setup();
  t.repo.reserve.mockRejectedValue(new ServiceFault('integrity'));
  expect((await t.service.dispatch(t.send)).ok).toBe(false);
  expect(t.repo.reserve).toHaveBeenCalledOnce();
});
it('never dispatches through a mismatched provider or unapproved production issuance', async () => {
  const s = setup();
  Object.assign(s.context, { provider: 'other' });
  expect((await s.service.dispatch(s.send)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
  const t = setup();
  const service = createPilotDeliveryServices({
    ...t.deps,
    policy: { ...t.deps.policy, fixture: false },
    renderer: { ...t.renderer, fixture: false },
    provider: { ...t.provider, fixture: false },
  });
  expect((await service.dispatch(t.send)).ok).toBe(false);
  expect(t.provider.send).not.toHaveBeenCalled();
});
it('suppresses absent permitted content and propagates stop failures', async () => {
  for (const broken of [false, true]) {
    const s = setup();
    Object.assign(s.context, { reportAllowed: false, offersAllowed: false });
    if (broken) s.repo.stop.mockRejectedValue(Error('unavailable'));
    expect((await s.service.dispatch(s.send)).ok).toBe(!broken);
    expect(s.provider.send).not.toHaveBeenCalled();
  }
});
it.each(['html', 'text', 'subject', 'commercial', 'fixture', 'unsubscribe', 'render'])(
  'refuses invalid %s rendering without sending',
  async (kind) => {
    const s = setup(),
      base = await s.renderer.render(s.context, [
        { offer: s.offer, code: 'UNIT-CODE', reasons: [] },
      ]);
    if (kind === 'render') s.renderer.render.mockRejectedValue(Error('secret render error'));
    else {
      s.renderer.render.mockResolvedValue({
        ...base,
        ...{
          html: { html: 'x'.repeat(100000) },
          text: { text: 'x'.repeat(65537) },
          subject: { subject: 'bad\r\nheader' },
          commercial: { commercial: false },
          fixture: { fixture: false },
          unsubscribe: { unsubscribeUrl: 'http://unsafe.invalid' },
        }[kind],
      });
    }
    expect((await s.service.dispatch(s.send)).ok).toBe(false);
    expect(s.provider.send).not.toHaveBeenCalled();
    expect(s.repo.retry).toHaveBeenCalled();
  },
);
it('rerenders after a final claim recheck and bounds repeated permission changes', async () => {
  const s = setup();
  s.repo.claim.mockResolvedValueOnce(false);
  expect((await s.service.dispatch(s.send)).ok).toBe(true);
  expect(s.renderer.render).toHaveBeenCalledTimes(2);
  const t = setup();
  t.repo.claim.mockResolvedValue(false);
  expect((await t.service.dispatch(t.send)).ok).toBe(false);
  expect(t.renderer.render).toHaveBeenCalledTimes(3);
  expect(t.provider.send).not.toHaveBeenCalled();
});
it('refuses unavailable encryption, corrupted frozen bytes and unavailable private assets', async () => {
  for (const kind of ['kms', 'corrupt', 'asset', 'reserve', 'claim']) {
    const s = setup();
    if (kind === 'kms')
      vi.mocked(s.encryption.encrypt).mockRejectedValue(Error('KMS private key detail'));
    if (kind === 'corrupt') vi.mocked(s.files.get).mockResolvedValue(new Uint8Array([1]));
    if (kind === 'asset') vi.mocked(s.files.put).mockRejectedValue(Error('private bucket detail'));
    if (kind === 'reserve') s.repo.reservePayload.mockRejectedValue(Error('unavailable'));
    if (kind === 'claim') s.repo.claim.mockRejectedValue(Error('unavailable'));
    expect((await s.service.dispatch(s.send)).ok).toBe(false);
    expect(s.provider.send).not.toHaveBeenCalled();
  }
});
it('does not let renderer-owned objects change the encrypted/provider payload during I/O', async () => {
  const s = setup(),
    mail = await s.renderer.render(s.context, [{ offer: s.offer, code: 'UNIT-CODE', reasons: [] }]);
  s.renderer.render.mockResolvedValue(mail);
  const original = vi.mocked(s.encryption.encrypt).getMockImplementation()!;
  vi.mocked(s.encryption.encrypt).mockImplementation(async (...args) => {
    Object.assign(mail, { html: 'changed after snapshot' });
    return original(...args);
  });
  expect((await s.service.dispatch(s.send)).ok).toBe(true);
  expect(s.provider.send.mock.calls[0]![1].mail.html).toContain('Frozen unit message');
});
it.each(['throws', 'unknown', 'rejected', 'null'])(
  'quarantines %s results or releases a definitive refusal through the outcome port',
  async (kind) => {
    const s = setup();
    if (kind === 'throws') s.provider.send.mockRejectedValue(Error('private error'));
    if (kind === 'unknown')
      s.provider.send.mockResolvedValue({ outcome: 'invalid' as never, messageId: null });
    if (kind === 'null') s.provider.send.mockResolvedValue(null as never);
    if (kind === 'rejected')
      s.provider.send.mockResolvedValue({ outcome: 'definitive_rejection', messageId: null });
    const r = await s.service.dispatch(s.send);
    expect(r).toEqual(ok({ state: kind === 'rejected' ? 'failed' : 'uncertain' }));
    expect(s.repo.finish).toHaveBeenCalledWith(
      expect.anything(),
      s.lease,
      kind === 'rejected' ? 'definitive_rejection' : 'uncertain',
      null,
    );
  },
);
it('retains the handoff marker when outcome persistence fails after provider acceptance', async () => {
  const s = setup();
  s.repo.finish.mockRejectedValue(Error('SQL lost'));
  expect((await s.service.dispatch(s.send)).ok).toBe(false);
  expect(s.provider.send).toHaveBeenCalledOnce();
  expect(s.repo.retry).not.toHaveBeenCalled();
});
it('authorizes before private location encryption and keeps plaintext targeting out of the repository capture', async () => {
  const s = setup();
  s.repo.authorize.mockRejectedValueOnce(Error('foreign session'));
  expect((await s.service.request(s.keys, s.send, s.request)).ok).toBe(false);
  expect(s.encryption.encrypt).not.toHaveBeenCalled();
  expect(
    (
      await s.service.request(s.keys, s.send, {
        ...s.request,
        region: 'CA',
        postal: '90001',
        latitude: 34,
        longitude: -118,
      })
    ).ok,
  ).toBe(true);
  const box = s.repo.capture.mock.calls[0]![6];
  expect(box.hex).not.toContain('90001');
  expect(s.repo.capture.mock.calls[0]![7]).toMatch(/^[a-f0-9]{64}$/);
});
it.each(['digest', 'malformed', 'coordinates'])(
  'refuses corrupted private location %s before allocation',
  async (kind) => {
    const s = setup();
    if (kind === 'digest') Object.assign(s.context.geo, { digest: '0'.repeat(64) });
    else {
      const location =
        kind === 'malformed' ? null : { region: null, postal: null, latitude: 91, longitude: 0 };
      const box = await s.encryption.encrypt(
        new TextEncoder().encode(JSON.stringify(location)),
        'pilot_geo',
        s.send,
      );
      Object.assign(s.context.geo, { box, digest: s.deps.crypto.digest(location) });
    }
    expect((await s.service.dispatch(s.send)).ok).toBe(false);
    expect(s.repo.reserve).not.toHaveBeenCalled();
    expect(s.provider.send).not.toHaveBeenCalled();
  },
);
