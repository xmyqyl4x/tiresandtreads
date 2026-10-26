import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { privateFixture, uid, time, key, success } from '../fixtures/private/database.ts';
import { createContactServices } from '../../packages/application/src/services/contacts.ts';
import { createContactServiceRepository } from '../../packages/db/src/repositories/contact-services.ts';
import { createPrivacyRepository } from '../../packages/db/src/repositories/privacy.ts';
import { createCommandRepository } from '../../packages/db/src/repositories/jobs.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createContactRuntime } from '../../packages/integrations/src/contact-runtime.ts';
import type {
  ContactPolicy,
  ContactRequest,
  ContactIntent,
} from '../../packages/application/src/ports/contact-services.ts';
import type { Result } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
async function setup() {
  const crypto = createContactCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(9) },
    { l1: new Uint8Array(32).fill(10) },
    new Uint8Array(32).fill(11),
  );
  const notices = {} as Record<keyof ContactPolicy['notices'], ReturnType<typeof uid<'notice'>>>;
  for (const p of ['report', 'offers', 'analytics', 'ads', 'targeted_ads', 'necessary'] as const)
    notices[p] = await f.notice(p);
  const stored = new Map<string, Uint8Array>();
  const encryption = {
    encrypt: vi.fn(async (bytes: Uint8Array, purpose: string, id: string) => {
      const hex = createHash('sha256')
        .update(purpose + id)
        .digest('hex');
      stored.set(purpose + id, bytes);
      return { keyVersion: 'fixture', hex };
    }),
    decrypt: vi.fn(async (_e: unknown, purpose: string, id: string) => stored.get(purpose + id)!),
  };
  const contacts = createContactServiceRepository(f.scope, crypto.lookupVersions),
    privacy = createPrivacyRepository(f.scope, crypto.lookupVersions),
    policy = { version: 'synthetic', notices };
  const deps = {
    uow: f.scope.unitOfWork,
    owners: f.owners,
    reports: f.reports,
    privacy,
    contacts,
    commands: createCommandRepository(f.scope),
    reliability: f.reliability,
    crypto,
    encryption,
    policy,
    now: () => time(),
  };
  const service = createContactServices(deps),
    owner = await f.owner(),
    email = uid('mail') + '@example.invalid';
  const request: ContactRequest = {
    email,
    report: null,
    offers: true,
    notices: { offers: notices.offers },
  };
  async function intents() {
    const rows = await f.admin.query(
      'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1 ORDER BY challenge_id',
      [owner.identity.subjectId],
    );
    return await success(f.scope.unitOfWork, async (tx) => {
      const all: ContactIntent[] = [];
      for (const r of rows.rows) all.push((await contacts.intent(tx, r.challenge_id))!);
      return all;
    });
  }
  async function requested(body = request, command = uid('command')) {
    const receipt = value(await service.request([owner.token], command, body)),
      all = await intents();
    return { receipt, all, command, body };
  }
  return {
    deps,
    service,
    owner,
    email,
    request,
    requested,
    intents,
    crypto,
    encryption,
    contacts,
    privacy,
  };
}
it('UC06/AT19 report-only flow needs inbox proof and never implies marketing, analytics or assessment gating', async () => {
  const s = await setup(),
    report = await f.report(s.owner.identity),
    scope = `report:${report.head.id}:1`;
  // A complete assessment already exists before any contact is requested.
  const r = await s.requested({
      email: s.email,
      report: { id: report.head.id, version: 1 },
      offers: false,
      notices: { report: s.deps.policy.notices.report },
    }),
    i = r.all[0]!;
  expect(r.all).toHaveLength(1);
  expect(i.purpose).toBe('report');
  expect(r.receipt).toEqual({
    schema_version: 1,
    resource_id: r.receipt.resource_id,
    status: 'accepted',
  });
  expect((await s.service.permission(i.contactId, 'report', scope)).ok).toBe(false);
  const message = value(await s.service.verificationMessage(i.id));
  expect(message).toMatchObject({ email: s.email, purpose: 'report', scope });
  expect(
    value(await s.service.permission(i.contactId, 'report', scope, i.id)).confirmationOnly,
  ).toBe(true);
  expect(value(await s.service.confirm(message.verificationToken, 'POST'))).toEqual({
    status: 'confirmed',
  });
  expect(value(await s.service.confirm(message.verificationToken, 'POST'))).toEqual({
    status: 'confirmed',
  });
  expect(value(await s.service.permission(i.contactId, 'report', scope)).confirmationOnly).toBe(
    false,
  );
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
  expect(
    value(await s.service.browser([s.owner.token], { gpc: false, cmpAvailable: true })),
  ).toMatchObject({ analytics: false, ads: false, targeted_ads: false });
  expect((await s.service.verificationMessage(i.id)).ok).toBe(false);
});
it('offers-only double opt-in commits pending grant and identifier-only outbox, with no report or promotion', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    m = value(await s.service.verificationMessage(i.id));
  const pending = await success(f.scope.unitOfWork, (tx) =>
    s.privacy.permission(tx, i.subjectId, 'offers', 'offers'),
  );
  expect(pending.status).toBe('pending');
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
  expect((await s.service.confirm(m.verificationToken, 'GET')).ok).toBe(false);
  expect((await s.service.withdraw(m.unsubscribeToken, 'GET')).ok).toBe(false);
  value(await s.service.confirm(m.verificationToken, 'POST'));
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(true);
  const out = await f.admin.query('SELECT payload FROM app.outbox WHERE aggregate_id=$1', [i.id]);
  expect(out.rows[0].payload).toEqual({ resource_id: i.id, resource_kind: 'contact_verification' });
  expect(
    (
      await f.admin.query('SELECT id FROM app.reports WHERE owner_subject_id=$1', [
        s.owner.identity.subjectId,
      ])
    ).rows,
  ).toHaveLength(0);
  const db = await f.admin.query('SELECT encrypted_email FROM privacy.contacts WHERE id=$1', [
    i.contactId,
  ]);
  expect(db.rows[0].encrypted_email.includes(Buffer.from(s.email))).toBe(false);
});
it('independent report/offers proofs survive unrelated purpose revisions and withdrawn offers leave a requested report permitted', async () => {
  const s = await setup(),
    report = await f.report(s.owner.identity),
    r = await s.requested({
      ...s.request,
      report: { id: report.head.id, version: 1 },
      notices: { ...s.request.notices, report: s.deps.policy.notices.report },
    });
  const reportIntent = r.all.find((i) => i.purpose === 'report')!,
    offers = r.all.find((i) => i.purpose === 'offers')!,
    a = value(await s.service.verificationMessage(reportIntent.id)),
    b = value(await s.service.verificationMessage(offers.id));
  value(await s.service.confirm(a.verificationToken, 'POST'));
  value(await s.service.confirm(b.verificationToken, 'POST'));
  value(await s.service.withdraw(b.unsubscribeToken, 'POST'));
  value(await s.service.withdraw(b.unsubscribeToken, 'POST'));
  expect((await s.service.permission(offers.contactId, 'offers', 'offers')).ok).toBe(false);
  expect(
    (await s.service.permission(reportIntent.contactId, 'report', reportIntent.scope)).ok,
  ).toBe(true);
  expect((await s.service.confirm(b.verificationToken, 'POST')).ok).toBe(false);
});
it('DB01 concurrent duplicate commands deduplicate contact/grant/outbox and reject changed-body reuse', async () => {
  const s = await setup(),
    cmd = uid('command'),
    r = await Promise.all([
      s.service.request([s.owner.token], cmd, s.request),
      s.service.request([s.owner.token], cmd, s.request),
    ]);
  expect(r[0]).toEqual(r[1]);
  value(r[0]!);
  expect(await s.intents()).toHaveLength(1);
  expect(
    await s.service.request([s.owner.token], cmd, { ...s.request, email: 'other@example.invalid' }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  const out = await f.admin.query(
    'SELECT count(*)::int n FROM privacy.contact_intents WHERE owner_subject_id=$1',
    [s.owner.identity.subjectId],
  );
  expect(out.rows[0].n).toBe(1);
  expect(s.encryption.encrypt).toHaveBeenCalledTimes(2);
  value(await s.service.request([s.owner.token], cmd, s.request));
  expect(s.encryption.encrypt).toHaveBeenCalledTimes(2);
});
it('rejects forged verification/unsubscribe tokens, audience confusion and arbitrary IDs without writes', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    m = value(await s.service.verificationMessage(i.id));
  for (const token of ['garbage', m.verificationToken.slice(0, -3) + 'abc', m.unsubscribeToken])
    expect((await s.service.confirm(token, 'POST')).ok).toBe(false);
  expect((await s.service.withdraw(m.verificationToken, 'POST')).ok).toBe(false);
  const missing = s.crypto.token('verify', uid('verification'), 'v1').raw;
  expect((await s.service.confirm(missing, 'POST')).ok).toBe(false);
  expect((await s.service.verificationMessage(uid('verification'))).ok).toBe(false);
  expect((await s.service.permission(i.contactId, 'offers', 'wrong')).ok).toBe(false);
  expect(
    (await s.service.permission(i.contactId, 'offers', 'offers', uid('verification'))).ok,
  ).toBe(false);
  expect((await s.service.permission(i.contactId, 'report', 'invalid')).ok).toBe(false);
});
it('invalid notices, revoked owners, foreign/missing report versions and malformed commands cannot grant or encrypt a contact', async () => {
  const s = await setup(),
    other = await f.owner(),
    report = await f.report(other.identity);
  const invalid = [
    { ...s.request, email: 'bad' },
    { ...s.request, offers: false },
    { ...s.request, report: { id: report.head.id, version: 1 } },
    { ...s.request, notices: { offers: uid('notice') } },
    { ...s.request, report: { id: report.head.id, version: 0 } },
  ];
  for (const body of invalid)
    expect((await s.service.request([s.owner.token], uid('command'), body)).ok).toBe(false);
  expect((await s.service.request([s.owner.token], 'short', s.request)).ok).toBe(false);
  expect((await s.service.request([key()], uid('command'), s.request)).ok).toBe(false);
  await success(f.scope.unitOfWork, (tx) => f.owners.revoke(tx, s.owner.identity));
  expect((await s.service.request([s.owner.token], uid('command'), s.request)).ok).toBe(false);
  expect(s.encryption.encrypt).not.toHaveBeenCalled();
  expect(await s.intents()).toHaveLength(0);
});
it('DB07 withdrawal racing confirmation leaves no usable stale grant or queued confirmation', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    m = value(await s.service.verificationMessage(i.id));
  const results = await Promise.all([
    s.service.confirm(m.verificationToken, 'POST'),
    s.service.withdraw(m.unsubscribeToken, 'POST'),
  ]);
  value(results[1]!);
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
  expect((await s.service.confirm(m.verificationToken, 'POST')).ok).toBe(false);
  expect((await s.service.verificationMessage(i.id)).ok).toBe(false);
});
it('a fresh verified opt-in can lift only the matching withdrawal and stale challenges cannot restore it', async () => {
  const s = await setup(),
    r = await s.requested(),
    old = r.all[0]!,
    m = value(await s.service.verificationMessage(old.id));
  value(await s.service.withdraw(m.unsubscribeToken, 'POST'));
  const next = await s.requested(),
    i = next.all.find((v) => v.id !== old.id)!,
    n = value(await s.service.verificationMessage(i.id));
  expect((await s.service.confirm(m.verificationToken, 'POST')).ok).toBe(false);
  value(await s.service.confirm(n.verificationToken, 'POST'));
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(true);
  expect(
    (
      await f.admin.query(
        "SELECT lifted_at FROM privacy.suppressions WHERE subject_id=$1 AND reason_code='withdrawn'",
        [i.subjectId],
      )
    ).rows[0].lifted_at,
  ).not.toBeNull();
});
it.each(['hard_bounce', 'complaint', 'deletion'] as const)(
  'global %s suppression survives re-entry and invalidates queued permission and confirmation',
  async (reason) => {
    const s = await setup(),
      r = await s.requested(),
      i = r.all[0]!,
      m = value(await s.service.verificationMessage(i.id)),
      event = uid('event');
    value(await s.service.confirm(m.verificationToken, 'POST'));
    const first = value(await s.service.suppress(i.contactId, reason, event));
    expect(value(await s.service.suppress(i.contactId, reason, event))).toEqual(first);
    expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
    expect((await s.service.request([s.owner.token], uid('command'), s.request)).ok).toBe(false);
    expect((await s.service.confirm(m.verificationToken, 'POST')).ok).toBe(false);
    const ks = await success(f.scope.unitOfWork, (tx) => s.contacts.contactKeys(tx, i.contactId));
    expect(
      await success(f.scope.unitOfWork, (tx) => s.contacts.tombstoned(tx, ks, ['all-email'])),
    ).toBe(true);
  },
);
it('a suppression tombstone alone denies re-entry even after the live suppression projection is absent', async () => {
  const s = await setup();
  await success(f.scope.unitOfWork, (tx) =>
    s.contacts.tombstone(tx, s.crypto.emailKeys(s.email), 'all-email', 'deletion'),
  );
  expect((await s.service.request([s.owner.token], uid('command'), s.request)).ok).toBe(false);
  expect(await s.intents()).toHaveLength(0);
});
it('expired inbox proof and stale notice cannot grant permission', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    id = uid('verification'),
    t = s.crypto.token('verify', id, 'v1');
  await f.admin.query(
    "INSERT INTO privacy.verification_challenges(id,subject_id,purpose,token_hash,key_version,notice_id,created_at,expires_at) VALUES($1,$2,'offers',$3,'v1',$4,now()-interval '8 days',now()-interval '1 day')",
    [id, i.subjectId, Buffer.from(t.key.digest, 'hex'), i.noticeId],
  );
  await f.admin.query(
    'INSERT INTO privacy.contact_intents(challenge_id,contact_id,owner_subject_id,scope_key,policy_version,grant_event_id) VALUES($1,$2,$3,$4,$5,$6)',
    [id, i.contactId, i.ownerId, i.scope, i.policyVersion, i.eventId],
  );
  expect((await s.service.confirm(t.raw, 'POST')).ok).toBe(false);
  expect((await s.service.verificationMessage(id)).ok).toBe(false);
  const service = createContactServices({
    ...s.deps,
    policy: { ...s.deps.policy, notices: { ...s.deps.policy.notices, offers: uid('notice') } },
  });
  expect((await service.verificationMessage(i.id)).ok).toBe(false);
});
it('lookup overlap deduplicates on rotation and retains old tombstones', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    rotated = createContactCrypto(
      'v2',
      { v1: new Uint8Array(32).fill(9), v2: new Uint8Array(32).fill(12) },
      { l1: new Uint8Array(32).fill(10), l2: new Uint8Array(32).fill(13) },
      new Uint8Array(32).fill(11),
    );
  const contacts = createContactServiceRepository(f.scope, rotated.lookupVersions),
    service = createContactServices({
      ...s.deps,
      crypto: rotated,
      contacts,
      privacy: createPrivacyRepository(f.scope, rotated.lookupVersions),
    });
  value(await service.request([s.owner.token], uid('command'), s.request));
  const all = await s.intents();
  expect(new Set(all.map((v) => v.contactId)).size).toBe(1);
  const ks = await success(f.scope.unitOfWork, (tx) => contacts.contactKeys(tx, i.contactId));
  expect(ks).toHaveLength(2);
  await success(f.scope.unitOfWork, (tx) =>
    contacts.tombstone(tx, [ks[0]!], 'all-email', 'complaint'),
  );
  expect((await service.request([s.owner.token], uid('command'), s.request)).ok).toBe(false);
});
it('browser consent defaults off, cannot override GPC, and changes purpose projections atomically with a receipt', async () => {
  const s = await setup(),
    keys = [s.owner.token],
    initial = value(await s.service.browser(keys, { gpc: false, cmpAvailable: true })),
    cmd = uid('command'),
    body = {
      expectedRevision: initial.revision,
      allowed: ['analytics', 'ads', 'targeted_ads'] as const,
      gpc: true,
      notices: s.deps.policy.notices,
    };
  const receipt = value(await s.service.setBrowserChoices(keys, cmd, body, 'POST'));
  expect(value(await s.service.setBrowserChoices(keys, cmd, body, 'POST'))).toEqual(receipt);
  const current = value(await s.service.browser(keys, { gpc: false, cmpAvailable: true }));
  expect(current).toMatchObject({
    necessary: true,
    analytics: true,
    ads: true,
    targeted_ads: false,
    identity_sharing: false,
  });
  expect(value(await s.service.browser(keys, { gpc: true, cmpAvailable: false }))).toMatchObject({
    analytics: false,
    ads: false,
  });
  expect((await s.service.setBrowserChoices(keys, uid('command'), body, 'POST')).ok).toBe(false);
  value(
    await s.service.setBrowserChoices(
      keys,
      uid('command'),
      { ...body, expectedRevision: current.revision, allowed: [] },
      'POST',
    ),
  );
  expect(value(await s.service.browser(keys, { gpc: false, cmpAvailable: true }))).toMatchObject({
    analytics: false,
    ads: false,
  });
});
it('forged CMP fields and GET requests never change server permission', async () => {
  const s = await setup(),
    keys = [s.owner.token],
    initial = value(await s.service.browser(keys, { gpc: false, cmpAvailable: true })),
    body = {
      expectedRevision: initial.revision,
      allowed: ['analytics'] as const,
      gpc: false,
      notices: s.deps.policy.notices,
    };
  expect((await s.service.setBrowserChoices(keys, uid('command'), body, 'GET')).ok).toBe(false);
  expect(
    (
      await s.service.setBrowserChoices(
        keys,
        uid('command'),
        { ...body, notices: { ...body.notices, analytics: uid('notice') } },
        'POST',
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await s.service.setBrowserChoices(
        keys,
        uid('command'),
        { ...body, allowed: ['offers'] as never },
        'POST',
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await s.service.setBrowserChoices(
        keys,
        uid('command'),
        { ...body, allowed: ['analytics', 'analytics'] },
        'POST',
      )
    ).ok,
  ).toBe(false);
  expect(value(await s.service.browser(keys, { gpc: false, cmpAvailable: true })).revision).toBe(
    initial.revision,
  );
});
it('parallel CMP grant/withdraw with the same revision cannot overwrite each other', async () => {
  const s = await setup(),
    keys = [s.owner.token],
    initial = value(await s.service.browser(keys, { gpc: false, cmpAvailable: true })),
    body = { expectedRevision: initial.revision, gpc: false, notices: s.deps.policy.notices };
  const r = await Promise.all([
    s.service.setBrowserChoices(keys, uid('command'), { ...body, allowed: ['analytics'] }, 'POST'),
    s.service.setBrowserChoices(keys, uid('command'), { ...body, allowed: [] }, 'POST'),
  ]);
  expect(r.filter((v) => v.ok)).toHaveLength(1);
  expect(r.filter((v) => !v.ok)).toMatchObject([{ error: { code: 'conflict' } }]);
});
it('post-decrypt permission recheck closes a withdrawal race and never returns an address', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    m = value(await s.service.verificationMessage(i.id));
  s.encryption.decrypt.mockImplementationOnce(async () => {
    value(await s.service.withdraw(m.unsubscribeToken, 'POST'));
    return new TextEncoder().encode(s.email);
  });
  expect((await s.service.verificationMessage(i.id)).ok).toBe(false);
});
it('encryption failure and late notice changes roll back grant/outbox/receipt together', async () => {
  const s = await setup();
  s.encryption.encrypt.mockRejectedValueOnce(Error('private provider details'));
  expect(await s.service.request([s.owner.token], uid('command'), s.request)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  expect(await s.intents()).toHaveLength(0);
  const original = s.deps.contacts.createIntent,
    spy = vi.spyOn(s.deps.contacts, 'createIntent').mockImplementationOnce(async () => {
      throw Error('failure after pending grant');
    });
  expect((await s.service.request([s.owner.token], uid('command'), s.request)).ok).toBe(false);
  spy.mockRestore();
  expect(s.deps.contacts.createIntent).toBe(original);
  expect(await s.intents()).toHaveLength(0);
  expect(
    (
      await f.admin.query(
        'SELECT id FROM privacy.contacts WHERE subject_id IN (SELECT subject_id FROM privacy.subject_links WHERE event_id IN (SELECT id FROM privacy.consent_events WHERE notice_id=$1))',
        [s.deps.policy.notices.offers],
      )
    ).rows,
  ).toHaveLength(0);
});
it('runtime composition requires the intended private role and grants no public/catalog access', async () => {
  const s = await setup();
  const runtime = await createContactRuntime({
    scope: f.scope,
    crypto: s.crypto,
    encryption: s.encryption,
    policy: s.deps.policy,
    now: () => time(),
  });
  value(await runtime.request([s.owner.token], uid('command'), s.request));
  await expect(
    createContactRuntime({
      scope: f.readScope,
      crypto: s.crypto,
      encryption: s.encryption,
      policy: s.deps.policy,
      now: () => time(),
    }),
  ).rejects.toThrow('Invalid contact runtime role');
  const denied = await f.readScope.unitOfWork.run(async (tx) => {
    await f.readScope.query(tx, 'SELECT * FROM privacy.contact_intents');
    return { ok: true as const, value: null };
  });
  expect(denied.ok).toBe(false);
  const missingKeys = createContactCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(9) },
    { missing: new Uint8Array(32).fill(99) },
    new Uint8Array(32).fill(11),
  );
  await expect(
    createContactRuntime({
      scope: f.scope,
      crypto: missingKeys,
      encryption: s.encryption,
      policy: s.deps.policy,
      now: () => time(),
    }),
  ).rejects.toThrow('Invalid contact lookup key coverage');
});
it('the final SQL dispatch claim rechecks withdrawal and tombstones after a queued permission decision', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    m = value(await s.service.verificationMessage(i.id));
  value(await s.service.confirm(m.verificationToken, 'POST'));
  const decision = value(await s.service.permission(i.contactId, 'offers', 'offers')),
    template = await f.template('offers'),
    asset = await f.asset('email_payload');
  const send = await success(f.scope.unitOfWork, (tx) =>
    f.delivery.schedule(tx, {
      id: uid('send'),
      owner: s.owner.identity,
      contactId: i.contactId,
      kind: 'offers',
      reportId: null,
      reportVersion: null,
      comparisonRevision: null,
      templateId: template,
      provider: 'synthetic',
      providerKey: uid('provider_key'),
      delaySeconds: 60,
      policyVersion: 'synthetic',
      noticeId: i.noticeId,
      purposes: ['offers'],
    }),
  );
  await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
  try {
    await f.admin.query(
      "UPDATE email.email_sends SET created_at=now()-interval '2 minutes',cancel_deadline=now()-interval '1 minute',send_after=now()-interval '1 minute' WHERE id=$1",
      [send.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
  }
  const claim = {
    id: send.id,
    expected: send.revision,
    recipientSubjectId: i.subjectId,
    permissionRevision: decision.revision,
    purpose: 'offers' as const,
    scope: 'offers',
    payloadAssetId: asset.id,
    payloadHash: asset.hash,
  };
  // A retained address tombstone denies dispatch even if no live suppression row exists.
  await success(f.scope.unitOfWork, (tx) =>
    s.contacts.tombstone(tx, s.crypto.emailKeys(s.email), 'all-email', 'complaint'),
  );
  const denied = await f.scope.unitOfWork.run(async (tx) => ({
    ok: true as const,
    value: await f.delivery.claim(tx, claim),
  }));
  expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(
    (await f.admin.query('SELECT id FROM email.send_attempts WHERE send_id=$1', [send.id])).rows,
  ).toHaveLength(0);
  value(await s.service.withdraw(m.unsubscribeToken, 'POST'));
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
});
it('contact restriction, stale policy and decryption failures fail closed without leaking an address', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!;
  s.encryption.decrypt.mockRejectedValueOnce(Error('secret provider message'));
  expect(await s.service.verificationMessage(i.id)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  const m = value(await s.service.verificationMessage(i.id));
  value(await s.service.confirm(m.verificationToken, 'POST'));
  const changed = createContactServices({
    ...s.deps,
    policy: {
      ...s.deps.policy,
      notices: { ...s.deps.policy.notices, offers: await f.notice('offers') },
    },
  });
  expect((await changed.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
  await success(f.scope.unitOfWork, (tx) => s.privacy.restrict(tx, i.subjectId));
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(false);
  expect((await s.service.confirm(m.verificationToken, 'POST')).ok).toBe(false);
});
it('FR-DEL-07 entering an existing address cannot alter its confirmed preferences before new inbox proof', async () => {
  const s = await setup(),
    r = await s.requested(),
    i = r.all[0]!,
    m = value(await s.service.verificationMessage(i.id));
  value(await s.service.confirm(m.verificationToken, 'POST'));
  const prior = await success(f.scope.unitOfWork, (tx) =>
      s.privacy.permission(tx, i.subjectId, 'offers', 'offers'),
    ),
    other = await f.owner();
  value(
    await s.service.request([other.token], uid('command'), {
      ...s.request,
      email: s.email.toUpperCase(),
    }),
  );
  expect(
    await success(f.scope.unitOfWork, (tx) =>
      s.privacy.permission(tx, i.subjectId, 'offers', 'offers'),
    ),
  ).toEqual(prior);
  expect((await s.service.permission(i.contactId, 'offers', 'offers')).ok).toBe(true);
  const row = (
    await f.admin.query(
      'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1',
      [other.identity.subjectId],
    )
  ).rows[0];
  const fresh = value(await s.service.verificationMessage(row.challenge_id));
  expect(fresh.email).toBe(s.email);
  value(await s.service.withdraw(m.unsubscribeToken, 'POST'));
  expect((await s.service.confirm(fresh.verificationToken, 'POST')).ok).toBe(false);
});
