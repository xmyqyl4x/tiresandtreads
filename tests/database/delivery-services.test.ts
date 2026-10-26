import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { privateFixture, uid, time, success } from '../fixtures/private/database.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createContactRuntime } from '../../packages/integrations/src/contact-runtime.ts';
import { createDeliveryRuntime } from '../../packages/integrations/src/delivery-runtime.ts';
import { createDeliveryServices } from '../../packages/application/src/services/delivery.ts';
import { createDeliveryWorkRepository } from '../../packages/db/src/repositories/delivery-work.ts';
import {
  createDeliveryFiles,
  deliveryChecksum,
} from '../../packages/integrations/src/delivery-files.ts';
import { createFixtureReportRenderer } from '../../packages/integrations/src/delivery-renderer.ts';
import { createContentPublicationRepository } from '../../packages/db/src/repositories/content.ts';
import type {
  ContactPolicy,
  ContactRequest,
} from '../../packages/application/src/ports/contact-services.ts';
import type { PrivateObjects } from '../../packages/application/src/ports/assets.ts';
import type { MailProvider } from '../../packages/application/src/ports/delivery-services.ts';
import type { JsonObject } from '../../packages/application/src/ports/catalog-records.ts';
import { ok, type Result } from '../../packages/domain/src/values/core.ts';
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
function output(): JsonObject {
  return {
    purpose: 'technical_evaluation',
    issuanceAuthorized: false,
    result: {
      asOf: time(),
      versions: {
        engine: 'fixture',
        schema: 1,
        policy: 'fixture',
        scoring: 'fixture',
        bundleId: f.bundleId,
        datasets: [],
        ruleVersionId: f.ruleId,
      },
      picks: [],
      decisions: [],
    },
    prices: [],
    products: [],
  };
}
async function setup() {
  const crypto = createContactCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(4) },
    { l1: new Uint8Array(32).fill(5) },
    new Uint8Array(32).fill(6),
  );
  const notices = {} as ContactPolicy['notices'];
  for (const purpose of [
    'report',
    'offers',
    'analytics',
    'ads',
    'targeted_ads',
    'necessary',
  ] as const)
    (notices as Record<string, string>)[purpose] = await f.notice(purpose);
  const contactPolicy = { version: 'synthetic', notices },
    encrypted = new Map<string, Uint8Array>();
  const encryption = {
    encrypt: vi.fn(async (bytes: Uint8Array, purpose: string, id: string) => {
      encrypted.set(purpose + id, bytes);
      return { keyVersion: 'fixture', hex: deliveryChecksum(bytes) };
    }),
    decrypt: vi.fn(async (_e: unknown, purpose: string, id: string) =>
      encrypted.get(purpose + id)!,
    ),
  };
  const contacts = await createContactRuntime({
    scope: f.scope,
    crypto,
    encryption,
    policy: contactPolicy,
    now: () => time(),
  });
  const templateId = await f.template(),
    hash = (
      await f.admin.query('SELECT renderer_hash FROM email.template_versions WHERE id=$1', [
        templateId,
      ])
    ).rows[0].renderer_hash;
  const fixture = createFixtureReportRenderer(hash),
    renderer = { ...fixture, render: vi.fn(fixture.render) };
  const objectsData = new Map<string, Uint8Array>();
  const objects: PrivateObjects = {
    put: vi.fn(async (a, b) => {
      const old = objectsData.get(a.id);
      if (old && deliveryChecksum(old) !== deliveryChecksum(b)) throw Error('Conflicting bytes');
      objectsData.set(a.id, new Uint8Array(b));
      return 'fixture-v1';
    }),
    get: vi.fn(async (a) => new Uint8Array(objectsData.get(a.id)!)),
    erase: async (a) => {
      objectsData.delete(a.id);
    },
  };
  const assetScope = f.adapter('tt_asset_runtime'),
    files = createDeliveryFiles({
      scope: assetScope,
      objects,
      bucket: 'fixture-private',
      keyVersion: 'fixture-kms',
    });
  const messageId = uid('message'),
    provider = {
      name: 'fixture' as const,
      fixture: true,
      send: vi.fn<MailProvider['send']>(async () => ({
        outcome: 'accepted' as 'accepted' | 'uncertain' | 'definitive_rejection',
        messageId: messageId as string | null,
      })),
    };
  const policy = {
    version: 'fixture-v1',
    sender: 'Tires & Tread <fixture@example.invalid>',
    templateId,
    fixture: true,
  };
  const work = createDeliveryWorkRepository(f.scope, contactPolicy, crypto.lookupVersions),
    deps = {
      uow: f.scope.unitOfWork,
      owners: f.owners,
      reports: f.reports,
      contacts,
      delivery: f.delivery,
      work,
      reliability: f.reliability,
      crypto,
      encryption,
      files,
      renderer,
      provider,
      policy,
      checksum: deliveryChecksum,
      now: () => time(),
    };
  const service = createDeliveryServices(deps),
    owner = await f.owner(),
    report = await f.report(owner.identity, output()),
    email = uid('email') + '@example.invalid';
  const input: ContactRequest = {
    email,
    report: { id: report.head.id, version: 1 },
    offers: false,
    notices: { report: notices.report },
  };
  async function request(command = uid('command'), body = input) {
    return value(await service.request([owner.token], command, body));
  }
  async function due(id: string) {
    // Fixture-only clock fast-forward. Production identity guards are re-enabled before any service call.
    await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
    try {
      await f.admin.query(
        "UPDATE email.email_sends SET created_at=now()-interval '2 minutes',cancel_deadline=now()-interval '1 minute',send_after=now()-interval '1 minute' WHERE id=$1",
        [id],
      );
    } finally {
      await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
    }
    await f.admin.query(
      "UPDATE email.delivery_work SET next_attempt_at=now()-interval '1 second' WHERE send_id=$1",
      [id],
    );
  }
  async function row(id: string) {
    return (
      await f.admin.query(
        'SELECT s.*,d.document,w.first_attempt_at,w.failures,w.payload_asset_id AS frozen_asset,w.pdf_asset_id,w.lease_token FROM email.email_sends s JOIN email.delivery_snapshots d ON d.send_id=s.id JOIN email.delivery_work w ON w.send_id=s.id WHERE s.id=$1',
        [id],
      )
    ).rows[0];
  }
  return {
    deps,
    service,
    work,
    owner,
    report,
    input,
    email,
    request,
    due,
    row,
    provider,
    renderer,
    contacts,
    encryption,
    encrypted,
    objects,
    objectsData,
    files,
    policy,
    crypto,
    contactPolicy,
    assetScope,
  };
}
it('UC06 freezes exact source identity, commits one request/outbox and returns server cancellation times', async () => {
  const s = await setup(),
    command = uid('command'),
    a = await s.request(command),
    b = await s.request(command);
  expect(b).toEqual(a);
  expect(Date.parse(a.sendAfter) - Date.parse((await s.row(a.id)).created_at.toISOString())).toBe(
    60000,
  );
  expect(await s.service.dispatch(a.id)).toEqual(ok(null));
  expect(s.provider.send).not.toHaveBeenCalled();
  const r = await s.row(a.id);
  expect(r.report_version).toBe(1);
  expect(r.document.report.issuanceAuthorized).toBe(false);
  expect(JSON.stringify(r.document)).not.toContain(s.email);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM app.outbox WHERE aggregate_id=$1 AND event_type='report.delivery_requested'",
        [a.id],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    await s.service.request([s.owner.token], command, { ...s.input, comparisonRevision: '1' }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('separates command identities when contact and delivery reuse the same key', async () => {
  const s = await setup(),
    command = uid('command');
  const contact = value(await s.contacts.request([s.owner.token], command, s.input));
  const send = await s.request(command);
  expect(send.id).not.toBe(contact.resource_id);
  expect(await s.request(command)).toEqual(send);
  expect(
    (
      await f.admin.query(
        'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1',
        [s.owner.identity.subjectId],
      )
    ).rowCount,
  ).toBe(2);
});
it('rolls contact, purpose, send, snapshot and outbox back when scheduling cannot complete', async () => {
  const s = await setup(),
    broken = createDeliveryServices({
      ...s.deps,
      work: {
        ...s.work,
        capture: async (tx, i) => {
          await s.work.capture(tx, i);
          throw Error('injected');
        },
      },
    });
  expect((await broken.request([s.owner.token], uid('command'), s.input)).ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT id FROM email.email_sends WHERE owner_subject_id=$1', [
        s.owner.identity.subjectId,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await f.admin.query(
        'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1',
        [s.owner.identity.subjectId],
      )
    ).rowCount,
  ).toBe(0);
});
it('allows the explicit one-off unverified report request without confirming any marketing permission', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  value(await s.service.dispatch(r.id));
  expect(s.provider.send).toHaveBeenCalledOnce();
  const row = await s.row(r.id);
  expect(row.dispatch_state).toBe('accepted');
  expect(s.provider.send.mock.calls[0]![1].mail.fixture).toBe(true);
  expect(
    (
      await f.admin.query('SELECT verified_at FROM privacy.contacts WHERE id=$1', [
        row.recipient_contact_id,
      ])
    ).rows[0].verified_at,
  ).toBeNull();
  expect(
    (
      await f.admin.query(
        "SELECT status FROM privacy.consent_state WHERE subject_id=(SELECT subject_id FROM privacy.contacts WHERE id=$1) AND purpose='report'",
        [row.recipient_contact_id],
      )
    ).rows[0].status,
  ).toBe('pending');
  expect(value(await s.service.status([s.owner.token], r.id))).not.toHaveProperty('contactId');
});
it('UC07 cancels the report independently while preserving a separate offers request', async () => {
  const s = await setup(),
    r = await s.request(uid('command'), {
      ...s.input,
      offers: true,
      notices: { ...s.input.notices, offers: s.contactPolicy.notices.offers },
    });
  expect(value(await s.service.cancel([s.owner.token], r.id, r.revision)).state).toBe('cancelled');
  expect(value(await s.service.cancel([s.owner.token], r.id, r.revision)).state).toBe('cancelled');
  await s.due(r.id);
  expect(await s.service.dispatch(r.id)).toEqual(ok(null));
  expect(
    (
      await f.admin.query(
        'SELECT v.purpose,v.invalidated_at FROM privacy.verification_challenges v JOIN privacy.contact_intents i ON i.challenge_id=v.id WHERE i.owner_subject_id=$1',
        [s.owner.identity.subjectId],
      )
    ).rows.every((v) =>
      v.purpose === 'offers' ? v.invalidated_at === null : v.invalidated_at !== null,
    ),
  ).toBe(true);
  expect(s.provider.send).not.toHaveBeenCalled();
  const other = await f.owner();
  expect((await s.service.status([other.token], r.id)).ok).toBe(false);
});
it('two connections serialize a winning cancel ahead of a waiting dispatch', async () => {
  const s = await setup(),
    r = await s.request();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((res) => {
      entered = res;
    }),
    gate = new Promise<void>((res) => {
      release = res;
    });
  const cancel = createDeliveryServices({
    ...s.deps,
    delivery: {
      ...f.delivery,
      cancel: async (...args) => {
        const result = await f.delivery.cancel(...args);
        entered();
        await gate;
        return result;
      },
    },
  });
  const cancelled = cancel.cancel([s.owner.token], r.id, r.revision);
  await ready;
  const dispatched = s.service.dispatch(r.id);
  release();
  expect(value(await cancelled).state).toBe('cancelled');
  expect(await dispatched).toEqual(ok(null));
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('reports already sending when dispatch wins; duplicate workers produce one handoff', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((res) => {
      entered = res;
    }),
    gate = new Promise<void>((res) => {
      release = res;
    });
  s.provider.send.mockImplementationOnce(async () => {
    entered();
    await gate;
    return { outcome: 'accepted', messageId: uid('message') };
  });
  const sending = s.service.dispatch(r.id);
  await ready;
  expect((await s.service.cancel([s.owner.token], r.id, r.revision)).ok).toBe(false);
  expect(await s.service.dispatch(r.id)).toEqual(ok(null));
  release();
  expect(value(await sending)).toHaveProperty('state', 'accepted');
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it('DB05 accepted-timeout retry preserves exact key and payload with one simulated provider side effect', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  const seen = new Map<string, string>();
  let effects = 0;
  s.provider.send.mockImplementation(async (k, p) => {
    const body = JSON.stringify(p);
    if (!seen.has(k)) {
      seen.set(k, body);
      effects++;
      throw Error('accepted then disconnected');
    }
    expect(body).toBe(seen.get(k));
    return { outcome: 'accepted', messageId: uid('message') };
  });
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'uncertain');
  await s.due(r.id);
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'accepted');
  expect(effects).toBe(1);
  expect(s.renderer.render).toHaveBeenCalledOnce();
  expect(
    (
      await f.admin.query(
        'SELECT attempt_no FROM email.send_attempts WHERE send_id=$1 ORDER BY attempt_no',
        [r.id],
      )
    ).rows.map((a) => a.attempt_no),
  ).toEqual([1, 2]);
});
it('recovers a crash after provider acceptance and before the SQL acknowledgement using the same bytes', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  const broken = createDeliveryServices({
    ...s.deps,
    delivery: {
      ...f.delivery,
      finish: async () => {
        throw Error('lost database commit');
      },
    },
  });
  expect((await broken.dispatch(r.id)).ok).toBe(false);
  expect((await s.row(r.id)).dispatch_state).toBe('dispatching');
  await f.admin.query(
    "UPDATE email.delivery_work SET lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE send_id=$1",
    [r.id],
  );
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'accepted');
  expect(s.provider.send.mock.calls[0]![0]).toBe(s.provider.send.mock.calls[1]![0]);
  expect(s.provider.send.mock.calls[0]![1]).toEqual(s.provider.send.mock.calls[1]![1]);
  expect(s.renderer.render).toHaveBeenCalledOnce();
});
it('stops uncertain retries at five provider attempts and retains permanent identity', async () => {
  const s = await setup(),
    r = await s.request();
  s.provider.send.mockResolvedValue({ outcome: 'uncertain', messageId: null });
  for (let n = 0; n < 5; n++) {
    await s.due(r.id);
    expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'uncertain');
  }
  await s.due(r.id);
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'stopped');
  expect((await s.row(r.id)).dispatch_state).toBe('manual_review');
  expect(s.provider.send).toHaveBeenCalledTimes(5);
  expect(
    value(await success(f.scope.unitOfWork, async (tx) => ok(await f.delivery.receipt(tx, r.id)))),
  ).toHaveProperty('outcome', 'manual_review');
});
it('current suppression after decryption denies the final claim and makes no provider call', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  const row = await s.row(r.id);
  s.encryption.decrypt.mockImplementationOnce(async (_e, purpose, id) => {
    value(await s.contacts.suppress(row.recipient_contact_id, 'hard_bounce', uid('event')));
    return s.encrypted.get(purpose + id)!;
  });
  expect((await s.service.dispatch(r.id)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
  expect((await s.row(r.id)).dispatch_state).toBe('suppressed');
});
it('a changed current permission after frozen-payload read is checked again before handoff', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  const row = await s.row(r.id),
    original = s.files.get;
  const service = createDeliveryServices({
    ...s.deps,
    files: {
      ...s.files,
      get: async (id) => {
        const bytes = await original(id);
        value(await s.contacts.suppress(row.recipient_contact_id, 'complaint', uid('event')));
        return bytes;
      },
    },
  });
  expect((await service.dispatch(r.id)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('defers a render failure without handoff and later uses the fixed renderer version', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  s.renderer.render.mockRejectedValueOnce(Error('private renderer error'));
  expect(await s.service.dispatch(r.id)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  expect(s.provider.send).not.toHaveBeenCalled();
  await s.due(r.id);
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'accepted');
});
it('rejects production issuance while specialist/data gates remain open', async () => {
  const s = await setup(),
    prod = createDeliveryServices({ ...s.deps, policy: { ...s.policy, fixture: false } });
  expect(await prod.request([s.owner.token], uid('command'), s.input)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('composes separate private/asset roles and refuses a public role', async () => {
  const s = await setup(),
    args = {
      privateScope: f.scope,
      assetScope: s.assetScope,
      crypto: s.crypto,
      encryption: s.encryption,
      contactPolicy: s.contactPolicy,
      policy: s.policy,
      renderer: s.renderer,
      provider: s.provider,
      objects: s.objects,
      bucket: 'fixture-private',
      keyVersion: 'fixture-kms',
      now: () => time(),
    };
  const runtime = await createDeliveryRuntime(args);
  const r = value(await runtime.request([s.owner.token], uid('command'), s.input));
  expect(r.state).toBe('scheduled');
  await expect(
    createDeliveryRuntime({ ...args, assetScope: f.adapter('tt_public_runtime') }),
  ).rejects.toThrow('role');
});
it('freezes the requested report/comparison instead of a later refinement', async () => {
  const s = await setup(),
    comparison = await success(f.scope.unitOfWork, (tx) =>
      f.reports.compare(tx, s.owner.identity, s.report.head.id, 1, null, {}, [
        { slot: 1, sourceKey: 'fixture', kind: 'catalog', snapshot: { productKnown: false } },
      ]),
    );
  const r = value(
    await s.service.request([s.owner.token], uid('command'), {
      ...s.input,
      comparisonRevision: String(comparison.revision),
    }),
  );
  await success(f.scope.unitOfWork, (tx) =>
    f.reports.publish(
      tx,
      s.owner.identity,
      s.report.head.revision,
      {
        ...s.report.version,
        version: 2,
        baseVersion: 1,
        output: { ...output(), products: [{ id: 'new', brand: 'New fixture' }] },
      },
      [],
    ),
  );
  await s.due(r.id);
  value(await s.service.dispatch(r.id));
  const doc = s.renderer.render.mock.calls[0]![0];
  expect(doc.report.version).toBe(1);
  expect(doc.comparison?.revision).toBe(String(comparison.revision));
  expect(doc.report.products).toEqual([]);
  expect(doc.template.id).toBe(s.policy.templateId);
});
it('does not reuse a stale worker lease after another replica takes over', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  const original = s.renderer.render.getMockImplementation()!;
  s.renderer.render.mockImplementationOnce(async (doc) => {
    await f.admin.query(
      "UPDATE email.delivery_work SET lease_until=now()-interval '1 second' WHERE send_id=$1",
      [r.id],
    );
    const next = await success(f.scope.unitOfWork, (tx) => s.work.acquire(tx, r.id));
    expect(next).not.toBeNull();
    return original(doc);
  });
  expect((await s.service.dispatch(r.id)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
  expect((await s.row(r.id)).dispatch_state).toBe('scheduled');
});
it('quarantines an uncertain send beyond the conservative deduplication window', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  s.provider.send.mockResolvedValue({ outcome: 'uncertain', messageId: null });
  value(await s.service.dispatch(r.id));
  // Shift the fixture clock origin, then restore the immutable-work guard before execution.
  await f.admin.query('ALTER TABLE email.delivery_work DISABLE TRIGGER delivery_work_identity');
  try {
    await f.admin.query(
      "UPDATE email.delivery_work SET first_attempt_at=now()-interval '23 hours',next_attempt_at=now()-interval '1 second' WHERE send_id=$1",
      [r.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE email.delivery_work ENABLE TRIGGER delivery_work_identity');
  }
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'stopped');
  expect((await s.row(r.id)).dispatch_state).toBe('manual_review');
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it('stops repeated render failures without creating a provider attempt', async () => {
  const s = await setup(),
    r = await s.request();
  s.renderer.render.mockRejectedValue(Error('unavailable'));
  for (let n = 0; n < 8; n++) {
    await s.due(r.id);
    expect((await s.service.dispatch(r.id)).ok).toBe(false);
  }
  await s.due(r.id);
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'stopped');
  expect((await s.row(r.id)).dispatch_state).toBe('suppressed');
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('does not regenerate or transmit corrupt frozen bytes after an uncertain result', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  s.provider.send.mockResolvedValue({ outcome: 'uncertain', messageId: null });
  value(await s.service.dispatch(r.id));
  const row = await s.row(r.id);
  s.objectsData.set(row.frozen_asset, new TextEncoder().encode('corrupt'));
  await s.due(r.id);
  expect((await s.service.dispatch(r.id)).ok).toBe(false);
  expect(s.renderer.render).toHaveBeenCalledOnce();
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it('address correction creates a fresh send while preserving the cancelled identity', async () => {
  const s = await setup(),
    a = await s.request(uid('command'), {
      ...s.input,
      offers: true,
      notices: { ...s.input.notices, offers: s.contactPolicy.notices.offers },
    });
  value(await s.service.cancel([s.owner.token], a.id, a.revision));
  value(await s.service.cancel([s.owner.token], a.id, a.revision, 'correct_address'));
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int AS n FROM privacy.verification_challenges v JOIN privacy.contact_intents i ON i.challenge_id=v.id WHERE i.owner_subject_id=$1 AND v.invalidated_at IS NOT NULL',
        [s.owner.identity.subjectId],
      )
    ).rows[0].n,
  ).toBe(2);
  const b = await s.request(uid('command'), { ...s.input, email: 'corrected-' + s.email });
  expect(b.id).not.toBe(a.id);
  expect((await s.row(a.id)).dispatch_state).toBe('cancelled');
  expect((await s.row(b.id)).recipient_contact_id).not.toBe(
    (await s.row(a.id)).recipient_contact_id,
  );
  expect(await s.service.cancel([s.owner.token], b.id, '999')).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
});
it('fails closed for changed dispatch policy and exposes only bounded due work', async () => {
  const s = await setup(),
    r = await s.request();
  expect(value(await s.service.reconcile())).not.toContain(r.id);
  await s.due(r.id);
  expect(value(await s.service.reconcile())).toContain(r.id);
  const changed = createDeliveryServices({
    ...s.deps,
    policy: { ...s.policy, version: 'next-policy' },
  });
  expect((await changed.dispatch(r.id)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('validates request boundaries and does not expose send existence to unrelated owners', async () => {
  const s = await setup();
  for (const bad of [
    { ...s.input, report: null },
    { ...s.input, comparisonRevision: 'invalid' },
    { ...s.input, secret: true },
  ])
    expect((await s.service.request([s.owner.token], uid('command'), bad)).ok).toBe(false);
  const r = await s.request(),
    other = await f.owner();
  expect((await s.service.cancel([other.token], r.id, r.revision)).ok).toBe(false);
  expect(await s.service.status([other.token], uid('send'))).toMatchObject({ ok: false });
});
it('freezes reviewed education selected from versioned topic weights and no interaction history', async () => {
  const s = await setup(),
    reason = uid('reason'),
    path = '/learn/' + uid('article'),
    contentKey = uid('content'),
    documentId = uid('document');
  const page = {
    kind: 'article',
    contentKey,
    path,
    canonical: path,
    locale: 'en-US',
    market: 'US',
    title: 'Reviewed fixture',
    summary: 'Public summary',
    paragraphs: ['Public paragraph'],
    topics: ['buying'],
    related: [],
    author: 'Fixture author',
    reviewer: 'Fixture reviewer',
    reviewedAt: time(-3600000),
    modifiedAt: time(-60000),
    expiresAt: time(3600000),
  };
  const contentScope = f.adapter('tt_content_runtime'),
    publish = createContentPublicationRepository(contentScope);
  await success(contentScope.unitOfWork, (tx) =>
    publish.publish(tx, {
      key: contentKey,
      locale: 'en-US',
      market: 'US',
      generation: 1n,
      cmsRevision: 'fixture:1',
      publishedAt: time(-60000),
      expiresAt: time(3600000),
      content: { title: page.title, summary: page.summary, paragraphs: page.paragraphs },
    }),
  );
  await f.admin.query(
    "INSERT INTO app.public_page_details(content_key,locale,market,generation,document_id,collection,public_path,document) VALUES($1,'en-US','US',1,$2,'articles',$3,$4)",
    [contentKey, documentId, path, JSON.stringify(page)],
  );
  await f.admin.query(
    "INSERT INTO admin.seo_page_registry(public_path,locale,market,content_key,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,'en-US','US',$2,'education',$3,now()+interval '1 hour','eligible',$1)",
    [path, contentKey, f.staff],
  );
  await f.admin.query(
    "INSERT INTO email.education_topic_map(rule_version_id,reason_code,topic_key,weight) VALUES($1,$2,'buying',10)",
    [f.ruleId, reason],
  );
  const out = output();
  (out.result as Record<string, unknown>).decisions = [
    { id: 'fixture', status: 'excluded', reasons: [reason], scoreBp: null },
  ];
  const report = await f.report(s.owner.identity, out),
    r = await s.request(uid('command'), { ...s.input, report: { id: report.head.id, version: 1 } });
  expect((await s.row(r.id)).document.learning).toEqual([
    expect.objectContaining({ path, title: page.title }),
  ]);
  await success(contentScope.unitOfWork, (tx) =>
    publish.publish(tx, {
      key: contentKey,
      locale: 'en-US',
      market: 'US',
      generation: 2n,
      cmsRevision: 'fixture:2',
      publishedAt: time(-1000),
      expiresAt: time(3600000),
      content: { title: 'Updated fixture', summary: page.summary, paragraphs: page.paragraphs },
    }),
  );
  await f.admin.query(
    "INSERT INTO app.public_page_details(content_key,locale,market,generation,document_id,collection,public_path,document) VALUES($1,'en-US','US',2,$2,'articles',$3,$4)",
    [
      contentKey,
      documentId,
      path,
      JSON.stringify({ ...page, title: 'Updated fixture', modifiedAt: time(-1000) }),
    ],
  );
  await s.due(r.id);
  value(await s.service.dispatch(r.id));
  expect(s.renderer.render.mock.calls[0]![0].learning[0]?.title).toBe(page.title);
  const removed = await s.request(uid('command'), {
    ...s.input,
    report: { id: report.head.id, version: 1 },
  });
  await f.admin.query(
    "UPDATE admin.seo_page_registry SET index_status='removed',revision=revision+1 WHERE public_path=$1",
    [path],
  );
  await s.due(removed.id);
  expect((await s.service.dispatch(removed.id)).ok).toBe(false);
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it('reads a large fixed snapshot without truncating its approved schema bound', async () => {
  const s = await setup(),
    out = {
      ...output(),
      products: Array.from({ length: 600 }, (_, i) => ({
        id: String(i),
        brand: 'b'.repeat(150),
        model: 'm'.repeat(50),
      })),
    };
  const report = await f.report(s.owner.identity, out),
    r = await s.request(uid('command'), { ...s.input, report: { id: report.head.id, version: 1 } });
  expect(JSON.stringify((await s.row(r.id)).document).length).toBeGreaterThan(65536);
  await s.due(r.id);
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'accepted');
});
it('refuses a mismatched renderer and a missing comparison before committing a request', async () => {
  const s = await setup(),
    bad = createDeliveryServices({ ...s.deps, renderer: { ...s.renderer, hash: '0'.repeat(64) } });
  expect(await bad.request([s.owner.token], uid('command'), s.input)).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(
    await s.service.request([s.owner.token], uid('command'), {
      ...s.input,
      comparisonRevision: '99',
    }),
  ).toMatchObject({ ok: false, error: { code: 'not_found' } });
});
it('definitive provider refusal is terminal and never regenerated or automatically retried', async () => {
  const s = await setup(),
    r = await s.request();
  await s.due(r.id);
  s.provider.send.mockResolvedValue({ outcome: 'definitive_rejection', messageId: null });
  expect(value(await s.service.dispatch(r.id))).toHaveProperty('state', 'failed');
  await s.due(r.id);
  expect(await s.service.dispatch(r.id)).toEqual(ok(null));
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it('checks private file byte identity and denies expired objects', async () => {
  const s = await setup(),
    id = uid('asset'),
    bytes = new TextEncoder().encode('{"fixture":true}');
  await s.files.put(id, 'email_payload', bytes);
  await s.files.put(id, 'email_payload', bytes);
  expect(await s.files.get(id)).toEqual(bytes);
  await expect(
    s.files.put(id, 'email_payload', new TextEncoder().encode('changed')),
  ).rejects.toThrow();
  await f.admin.query(
    "UPDATE app.object_assets SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
    [id],
  );
  await expect(s.files.get(id)).rejects.toThrow();
});
it('keeps orchestration snapshots and private storage locations outside public reader roles', async () => {
  const s = await setup(),
    r = await s.request(),
    publicScope = f.adapter('tt_public_runtime');
  const denied = await publicScope.unitOfWork.run(async (tx) =>
    ok(
      await publicScope.query(
        tx,
        'SELECT document FROM email.delivery_snapshots WHERE send_id=$1',
        [r.id],
      ),
    ),
  );
  expect(denied).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  const privateLocation = await f.scope.unitOfWork.run(async (tx) =>
    ok(await f.scope.query(tx, 'SELECT object_key FROM app.object_assets')),
  );
  expect(privateLocation).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(
    (
      await f.admin.query(
        "SELECT has_table_privilege('tt_public_runtime','email.delivery_snapshots','SELECT') AS snapshot,has_column_privilege('tt_private_runtime','app.object_assets','object_key','SELECT') AS location",
      )
    ).rows[0],
  ).toEqual({ snapshot: false, location: false });
});
