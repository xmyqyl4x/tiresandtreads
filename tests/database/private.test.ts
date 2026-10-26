import { beforeAll, afterAll, it, expect } from 'vitest';
import {
  privateFixture,
  uid,
  time,
  key,
  encrypted,
  success,
  result,
} from '../fixtures/private/database.ts';
import { rev, rid, lockSubjects } from '../../packages/db/src/repositories/private-values.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
import { createPrivacyRepository } from '../../packages/db/src/repositories/privacy.ts';
import type { Quote } from '../../packages/application/src/ports/private-records.ts';
import type { ScheduleSend } from '../../packages/application/src/ports/delivery.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function page(limit = 25, after: string | null = null) {
  const p = pageRequest(limit, after);
  if (!p.ok) throw new Error('page');
  return p.value;
}
function run<T>(work: Parameters<typeof success<T>>[1]) {
  return success(f.scope.unitOfWork, work);
}
function attempt<T>(work: Parameters<typeof result<T>>[1]) {
  return result(f.scope.unitOfWork, work);
}
const conflict = { ok: false, error: { code: 'conflict' } };
it('rotates owner sessions atomically, rejects revoked authority and ambiguous or expired tokens', async () => {
  const a = await f.owner(),
    b = await f.owner();
  expect(await run((tx) => f.owners.resolve(tx, [a.token]))).toEqual(a.identity);
  expect(await run((tx) => f.owners.resolve(tx, [key()]))).toBeNull();
  expect(
    await attempt((tx) => f.owners.resolve(tx, [a.token, { ...b.token, keyVersion: 'second' }])),
  ).toMatchObject({ ok: true });
  const token = key('next');
  const rotated = await run((tx) =>
    f.owners.rotate(tx, a.identity, {
      sessionId: uid('owner_session'),
      key: token,
      expiresAt: time(60000),
    }),
  );
  expect(await run((tx) => f.owners.resolve(tx, [a.token]))).toBeNull();
  expect(await attempt((tx) => f.owners.revoke(tx, a.identity))).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  expect(await run((tx) => f.owners.resolve(tx, [token]))).toEqual(rotated);
  await run((tx) => f.owners.revoke(tx, rotated));
  expect(await run((tx) => f.owners.resolve(tx, [token]))).toBeNull();
  await f.admin.query(
    "UPDATE app.owner_sessions SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [b.identity.sessionId],
  );
  expect(await run((tx) => f.owners.resolve(tx, [b.token]))).toBeNull();
});
it('isolates report owners and advances immutable versions with stale revision rollback', async () => {
  const a = await f.owner(),
    b = await f.owner(),
    r = await f.report(a.identity);
  expect(await run((tx) => f.reports.head(tx, b.identity, r.head.id))).toBeNull();
  expect(await attempt((tx) => f.reports.version(tx, b.identity, r.head.id, 1))).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
  expect(await run((tx) => f.reports.version(tx, a.identity, r.head.id, 1))).toEqual(r.version);
  expect(await run((tx) => f.reports.items(tx, a.identity, r.head.id, 1))).toEqual([
    { key: 'excluded', skuId: null, kind: 'excluded', rank: null, snapshot: { price: null } },
  ]);
  expect(await run((tx) => f.reports.version(tx, a.identity, r.head.id, 99))).toBeNull();
  expect(await run((tx) => f.reports.head(tx, a.identity, r.head.id))).toEqual(r.head);
  const next = { ...r.version, version: 2, baseVersion: 1 };
  expect(
    await attempt((tx) => f.reports.publish(tx, a.identity, rev('1'), next, [])),
  ).toMatchObject(conflict);
  const advanced = await run((tx) => f.reports.publish(tx, a.identity, r.head.revision, next, []));
  expect(advanced.currentVersion).toBe(2);
  const count = await f.admin.query(
    'SELECT count(*)::int n FROM app.report_versions WHERE report_id=$1',
    [r.head.id],
  );
  expect(count.rows[0].n).toBe(2);
  expect(
    await attempt(async (tx) => {
      try {
        await f.reports.publish(
          tx,
          a.identity,
          advanced.revision,
          { ...next, version: 3, baseVersion: 2 },
          [{ key: 'bad', skuId: uid('tire_sku'), kind: 'picked', rank: 1, snapshot: {} }],
        );
      } catch {
        /* intentionally swallowed */
      }
      return 'must rollback';
    }),
  ).toMatchObject({ ok: false });
  expect((await run((tx) => f.reports.head(tx, a.identity, r.head.id)))?.currentVersion).toBe(2);
});
it('round trips draft revisions, four comparison slots, nullable evidence and bigint quotes', async () => {
  const a = await f.owner(),
    r = await f.report(a.identity);
  expect(await run((tx) => f.reports.draft(tx, a.identity, r.head.id))).toBeNull();
  const d = {
    baseVersion: 1,
    schemaVersion: 1 as const,
    input: { pressure: null },
    expiresAt: time(60000),
  };
  const saved = await run((tx) => f.reports.saveDraft(tx, a.identity, r.head.id, null, d));
  expect(await run((tx) => f.reports.draft(tx, a.identity, r.head.id))).toEqual(saved);
  expect(
    await attempt((tx) => f.reports.saveDraft(tx, a.identity, r.head.id, null, d)),
  ).toMatchObject(conflict);
  const changed = await run((tx) =>
    f.reports.saveDraft(tx, a.identity, r.head.id, saved.revision, {
      ...d,
      input: { pressure: 'unknown' },
    }),
  );
  expect(changed.revision).toBe(2n);
  expect(
    await attempt((tx) => f.reports.saveDraft(tx, a.identity, r.head.id, saved.revision, d)),
  ).toMatchObject(conflict);
  const items = ([1, 2, 3, 4] as const).map((slot) => ({
    slot,
    sourceKey: 'q' + slot,
    kind: 'quote' as const,
    snapshot: { price: null },
  }));
  const comparison = await run((tx) =>
    f.reports.compare(tx, a.identity, r.head.id, 1, null, { budget: null }, items),
  );
  expect(
    await run((tx) => f.reports.comparison(tx, a.identity, r.head.id, 1, comparison.revision)),
  ).toEqual(comparison);
  expect(
    await run((tx) => f.reports.comparison(tx, a.identity, r.head.id, 1, rev('99'))),
  ).toBeNull();
  expect(
    await attempt((tx) => f.reports.compare(tx, a.identity, r.head.id, 1, null, {}, items)),
  ).toMatchObject(conflict);
  expect(
    (
      await run((tx) =>
        f.reports.compare(tx, a.identity, r.head.id, 1, comparison.revision, {}, items),
      )
    ).revision,
  ).toBe(2n);
  const quote: Quote = {
    id: uid('quote'),
    reportId: r.head.id,
    sourceKey: 'quote-1',
    skuId: null,
    currency: 'USD',
    totalMinor: 999999999999n,
    quantity: 4,
    basis: 'installed_set',
    observedOn: '2026-10-24',
    components: [{ kind: 'tax', minor: '123' }],
    expiresAt: time(60000),
  };
  const v = await run((tx) => f.reports.saveQuote(tx, a.identity, null, quote));
  expect(v).toBe(1n);
  expect((await run((tx) => f.reports.quotes(tx, a.identity, r.head.id, page()))).items).toEqual([
    { ...quote, revision: v },
  ]);
  expect(
    await run((tx) => f.reports.saveQuote(tx, a.identity, v, { ...quote, totalMinor: 0n })),
  ).toBe(2n);
  expect(await attempt((tx) => f.reports.saveQuote(tx, a.identity, v, quote))).toMatchObject(
    conflict,
  );
  await run((tx) =>
    f.reports.publish(
      tx,
      a.identity,
      r.head.revision,
      { ...r.version, version: 2, baseVersion: 1 },
      [],
    ),
  );
  expect(await run((tx) => f.reports.draft(tx, a.identity, r.head.id))).toBeNull();
});
it('bounds and scopes keyset pages and keeps another owner out of cursors', async () => {
  const a = await f.owner(),
    b = await f.owner();
  for (let n = 0; n < 3; n++) await f.report(a.identity);
  const first = await run((tx) => f.reports.list(tx, a.identity, page(2))),
    last = await run((tx) => f.reports.list(tx, a.identity, page(2, first.next)));
  expect(first.items.length).toBe(2);
  expect(last.items.length).toBe(1);
  expect(last.next).toBeNull();
  expect(await attempt((tx) => f.reports.list(tx, b.identity, page(2, first.next)))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it('deduplicates simultaneous contact registration and resolves overlap keys during rotation', async () => {
  const token = key(),
    input = { id: uid('contact'), subjectId: uid('subject'), keys: [token], envelope: encrypted() };
  const [a, b] = await Promise.all([
    run((tx) => f.privacy.registerContact(tx, input)),
    run((tx) =>
      f.privacy.registerContact(tx, { ...input, id: uid('contact'), subjectId: uid('subject') }),
    ),
  ]);
  expect(a).toEqual(b);
  expect(a.verifiedAt).toBeNull();
  const rotated = createPrivacyRepository(f.scope, ['test-hmac-v1', 'test-hmac-v2']),
    newKey = key('test-hmac-v2');
  expect(
    (await run((tx) => rotated.registerContact(tx, { ...input, keys: [token, newKey] }))).id,
  ).toBe(a.id);
  expect(await attempt((tx) => rotated.registerContact(tx, input))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  const newer = createPrivacyRepository(f.scope, ['test-hmac-v2']);
  expect((await run((tx) => newer.registerContact(tx, { ...input, keys: [newKey] }))).id).toBe(
    a.id,
  );
  expect(await run((tx) => f.privacy.contact(tx, uid('contact')))).toBeNull();
  const other = await f.contact();
  expect(
    await attempt((tx) => rotated.registerContact(tx, { ...input, keys: [other.token, newKey] })),
  ).toMatchObject({ ok: false, error: { code: 'integrity' } });
  await run((tx) => f.privacy.restrict(tx, a.subjectId));
  expect(await attempt((tx) => f.privacy.registerContact(tx, input))).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
it('stores purpose-scoped consent with a shared revision and explicit unknown or expired states', async () => {
  const c = await f.contact(),
    notice = await f.notice();
  const unknown = await run((tx) =>
    f.privacy.permission(tx, c.value.subjectId, 'report', 'report:one'),
  );
  expect(unknown.status).toBe('unknown');
  const input = {
    id: uid('consent_event'),
    subjectId: c.value.subjectId,
    purpose: 'report' as const,
    scope: 'report:one',
    expectedRevision: unknown.revision,
    action: 'grant' as const,
    noticeId: notice,
    policyVersion: 'v1',
    method: 'synthetic',
    expiresAt: null,
  };
  const pending = await run((tx) => f.privacy.consent(tx, input));
  expect(pending.status).toBe('pending');
  expect(
    await attempt((tx) => f.privacy.consent(tx, { ...input, id: uid('consent_event') })),
  ).toMatchObject(conflict);
  const confirmed = await run((tx) =>
    f.privacy.consent(tx, {
      ...input,
      id: uid('consent_event'),
      action: 'confirm',
      expectedRevision: pending.revision,
      expiresAt: time(5000),
    }),
  );
  expect(confirmed.status).toBe('confirmed');
  expect(
    (await run((tx) => f.privacy.permission(tx, c.value.subjectId, 'report', 'report:two'))).status,
  ).toBe('unknown');
  await f.admin.query(
    "UPDATE privacy.consent_state SET effective_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE subject_id=$1",
    [c.value.subjectId],
  );
  expect(
    (await run((tx) => f.privacy.permission(tx, c.value.subjectId, 'report', 'report:one'))).status,
  ).toBe('expired');
  const withdrawn = await run((tx) =>
    f.privacy.consent(tx, {
      ...input,
      id: uid('consent_event'),
      action: 'withdraw',
      expectedRevision: confirmed.revision,
    }),
  );
  expect(withdrawn.status).toBe('withdrawn');
  expect(await run((tx) => f.privacy.suppressed(tx, c.value.subjectId, ['all-email']))).toBe(false);
  await run((tx) =>
    f.privacy.suppress(tx, {
      subjectId: c.value.subjectId,
      scope: 'offers',
      reason: 'recipient',
      expiresAt: null,
    }),
  );
  expect(
    await run((tx) => f.privacy.suppressed(tx, c.value.subjectId, ['all-email', 'offers'])),
  ).toBe(true);
  expect(await run((tx) => f.privacy.suppressed(tx, c.value.subjectId, ['report']))).toBe(false);
});
it('round trips private envelopes and records bounded deletion work without falsely declaring erasure', async () => {
  const a = await f.owner(),
    r = await f.report(a.identity),
    e = encrypted();
  expect(await run((tx) => f.privacy.privateReport(tx, a.identity, r.head.id))).toBeNull();
  const expires = time(60000),
    v = await run((tx) => f.privacy.savePrivateReport(tx, a.identity, r.head.id, null, e, expires));
  expect(await run((tx) => f.privacy.privateReport(tx, a.identity, r.head.id))).toEqual({
    envelope: e,
    expiresAt: expires,
    revision: v,
  });
  expect(
    await run((tx) =>
      f.privacy.savePrivateReport(tx, a.identity, r.head.id, v, encrypted('rotated'), expires),
    ),
  ).toBe(2n);
  expect(
    await attempt((tx) => f.privacy.savePrivateReport(tx, a.identity, r.head.id, v, e, expires)),
  ).toMatchObject(conflict);
  const requestId = uid('privacy_request');
  await run((tx) =>
    f.privacy.request(tx, {
      id: requestId,
      subjectId: a.identity.subjectId,
      kind: 'delete',
      jurisdiction: 'US',
      policyVersion: 'v1',
      dueAt: time(86400000),
      steps: [
        { store: 'application', action: 'erase' },
        { store: 'object', action: 'erase' },
      ],
    }),
  );
  const steps = await run((tx) => f.privacy.steps(tx, a.identity.subjectId, requestId));
  expect(steps).toHaveLength(2);
  expect(
    await run((tx) =>
      f.privacy.finishStep(
        tx,
        a.identity.subjectId,
        requestId,
        steps[0]!.id,
        steps[0]!.revision,
        'completed',
        key().digest,
      ),
    ),
  ).toBe(2n);
  expect(
    await attempt((tx) =>
      f.privacy.finishStep(
        tx,
        a.identity.subjectId,
        requestId,
        steps[0]!.id,
        steps[0]!.revision,
        'completed',
        key().digest,
      ),
    ),
  ).toMatchObject(conflict);
  for (const kind of ['report', 'session', 'request', 'contact', 'asset', 'send'] as const) {
    const resources = await run((tx) =>
      f.privacy.resources(tx, a.identity.subjectId, kind, page()),
    );
    if (['report', 'session', 'request'].includes(kind))
      expect(resources.items.length).toBeGreaterThan(0);
  }
  const marker = { kind: 'subject', key: key(), policyVersion: 'v1', expiresAt: null };
  expect(await run((tx) => f.privacy.marked(tx, 'subject', [marker.key]))).toBe(false);
  await run((tx) => f.privacy.marker(tx, marker));
  await run((tx) => f.privacy.marker(tx, marker));
  expect(await run((tx) => f.privacy.marked(tx, 'subject', [marker.key]))).toBe(true);
  await run((tx) => f.privacy.restrict(tx, a.identity.subjectId));
  expect(await run((tx) => f.owners.resolve(tx, [a.token]))).toBeNull();
  expect(
    (await f.admin.query('SELECT status FROM privacy.privacy_requests WHERE id=$1', [requestId]))
      .rows[0].status,
  ).toBe('pending');
});
it('keeps share references and download grants scoped, revocable and free of private locations', async () => {
  const a = await f.owner(),
    b = await f.owner(),
    r = await f.report(a.identity),
    asset = await f.asset(),
    shareKey = key(),
    shareId = uid('report_capability');
  await run((tx) =>
    f.caps.asset(tx, a.identity, {
      assetId: asset.id,
      reportId: r.head.id,
      version: 1,
      comparisonRevision: null,
      rendererVersion: 'v1',
      locale: 'en-US',
      scope: 'shared',
      renderKey: uid('render'),
    }),
  );
  await run((tx) =>
    f.caps.share(tx, a.identity, {
      id: shareId,
      reportId: r.head.id,
      version: null,
      key: shareKey,
      expiresAt: time(60000),
    }),
  );
  const share = await run((tx) => f.caps.resolveShare(tx, [shareKey]));
  expect(share).toEqual({
    capabilityId: shareId,
    reportId: r.head.id,
    version: 1,
    versionBinding: 0,
    comparisonRevision: null,
  });
  expect(await run((tx) => f.caps.resolveShare(tx, [key()]))).toBeNull();
  const grantKey = key(),
    grant = {
      id: uid('download_grant'),
      assetId: asset.id,
      reportId: r.head.id,
      version: 1,
      scope: 'shared' as const,
      key: grantKey,
      expiresAt: time(60000),
    };
  expect(
    await attempt((tx) =>
      f.caps.grant(tx, { shareKeys: [shareKey] }, { ...grant, scope: 'owner' }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(await attempt((tx) => f.caps.grant(tx, { owner: b.identity }, grant))).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
  await run((tx) => f.caps.grant(tx, { shareKeys: [shareKey] }, grant));
  expect(await run((tx) => f.caps.download(tx, [grantKey]))).toEqual({
    assetId: asset.id,
    reportId: r.head.id,
    version: 1,
    scope: 'shared',
    sha256: asset.hash,
    sizeBytes: 12345n,
    mimeType: 'application/pdf',
  });
  expect(await run((tx) => f.caps.download(tx, [key()]))).toBeNull();
  await run((tx) => f.caps.revokeShare(tx, a.identity, r.head.id, shareId));
  expect(await run((tx) => f.caps.download(tx, [grantKey]))).toBeNull();
  expect(await run((tx) => f.caps.resolveShare(tx, [shareKey]))).toBeNull();
  const ownerKey = key();
  await run((tx) =>
    f.caps.grant(tx, { owner: a.identity }, { ...grant, id: uid('download_grant'), key: ownerKey }),
  );
  expect(await run((tx) => f.caps.download(tx, [ownerKey]))).not.toBeNull();
  await run((tx) => f.owners.revoke(tx, a.identity));
  expect(await run((tx) => f.caps.download(tx, [ownerKey]))).toBeNull();
});
async function scheduled() {
  const a = await f.owner(),
    c = await f.contact(),
    r = await f.report(a.identity),
    template = await f.template(),
    notice = await f.notice();
  await run((tx) => f.privacy.confirmContact(tx, c.value.id, c.value.revision));
  const permission = await run((tx) =>
    f.privacy.consent(tx, {
      id: uid('consent_event'),
      subjectId: c.value.subjectId,
      purpose: 'report',
      scope: 'report:' + r.head.id,
      expectedRevision: rev('1'),
      action: 'confirm',
      noticeId: notice,
      policyVersion: 'v1',
      method: 'synthetic',
      expiresAt: null,
    }),
  );
  const i: ScheduleSend = {
    id: uid('send'),
    owner: a.identity,
    contactId: c.value.id,
    kind: 'report',
    reportId: r.head.id,
    reportVersion: 1,
    comparisonRevision: null,
    templateId: template,
    provider: 'fake',
    providerKey: uid('provider_key'),
    delaySeconds: 60,
    policyVersion: 'v1',
    noticeId: notice,
    purposes: ['report'],
  };
  const send = await run((tx) => f.delivery.schedule(tx, i)),
    asset = await f.asset('email_payload');
  const claim = {
    id: send.id,
    expected: send.revision,
    recipientSubjectId: c.value.subjectId,
    permissionRevision: permission.revision,
    purpose: 'report' as const,
    scope: permission.scope,
    payloadAssetId: asset.id,
    payloadHash: asset.hash,
  };
  return { a, c, r, send, claim, notice, i };
}
async function due(id: string) {
  // Move the synthetic schedule into the past before any attempt, preserving real constraints.
  await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
  try {
    await f.admin.query(
      "UPDATE email.email_sends SET created_at=now()-interval '2 minutes',cancel_deadline=now()-interval '1 minute',send_after=now()-interval '1 minute' WHERE id=$1",
      [id],
    );
  } finally {
    await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
  }
}
it('enforces cancellation deadlines and keeps owner/recipient distinct', async () => {
  const x = await scheduled(),
    other = await f.owner();
  expect(await run((tx) => f.delivery.owned(tx, other.identity, x.send.id))).toBeNull();
  expect(await run((tx) => f.delivery.owned(tx, x.a.identity, x.send.id))).toEqual(x.send);
  expect(await attempt((tx) => f.delivery.claim(tx, x.claim))).toMatchObject(conflict);
  expect(
    await attempt((tx) => f.delivery.cancel(tx, other.identity, x.send.id, x.send.revision)),
  ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  const cancelled = await run((tx) =>
    f.delivery.cancel(tx, x.a.identity, x.send.id, x.send.revision),
  );
  expect(cancelled.state).toBe('cancelled');
  expect((await run((tx) => f.delivery.receipt(tx, x.send.id)))?.outcome).toBe('cancelled');
  expect(await attempt((tx) => f.delivery.claim(tx, x.claim))).toMatchObject(conflict);
  expect(await run((tx) => f.delivery.receipt(tx, uid('send')))).toBeNull();
});
it.each(['accepted', 'definitive_rejection', 'uncertain'] as const)(
  'persists attempt and %s receipt with a frozen payload and no implicit retry',
  async (outcome) => {
    const x = await scheduled();
    await due(x.send.id);
    const claimed = await run((tx) => f.delivery.claim(tx, x.claim));
    expect(
      await attempt((tx) => f.delivery.cancel(tx, x.a.identity, x.send.id, claimed.send.revision)),
    ).toMatchObject(conflict);
    const finished = await run((tx) =>
      f.delivery.finish(tx, {
        id: x.send.id,
        attemptId: claimed.attemptId,
        expected: claimed.send.revision,
        outcome,
        providerMessageId: outcome === 'accepted' ? uid('message') : null,
        errorCode: outcome === 'definitive_rejection' ? 'fake_rejected' : null,
      }),
    );
    expect(finished.state).toBe(outcome === 'definitive_rejection' ? 'failed' : outcome);
    expect((await run((tx) => f.delivery.receipt(tx, x.send.id)))?.outcome).toBe(outcome);
    expect(
      await attempt((tx) => f.delivery.claim(tx, { ...x.claim, expected: finished.revision })),
    ).toMatchObject(conflict);
  },
);
it('serializes withdrawal before dispatch and rejects stale permission decisions', async () => {
  const x = await scheduled();
  await due(x.send.id);
  let release!: () => void, locked!: () => void;
  const wait = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      locked = r;
    });
  const withdrawal = run(async (tx) => {
    await lockSubjects(f.scope, tx, [x.a.identity.subjectId, x.c.value.subjectId]);
    locked();
    await wait;
    return f.privacy.consent(tx, {
      id: uid('consent_event'),
      subjectId: x.c.value.subjectId,
      purpose: 'report',
      scope: x.claim.scope,
      expectedRevision: x.claim.permissionRevision,
      action: 'withdraw',
      noticeId: x.notice,
      policyVersion: 'v1',
      method: 'synthetic',
      expiresAt: null,
    });
  });
  await ready;
  const dispatch = attempt((tx) => f.delivery.claim(tx, x.claim));
  release();
  await withdrawal;
  expect(await dispatch).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect((await run((tx) => f.delivery.owned(tx, x.a.identity, x.send.id)))?.state).toBe(
    'scheduled',
  );
});
it('rolls report, contact, consent, send and outbox back on the same transaction after a late failure', async () => {
  const a = await f.owner(),
    c = await f.contact(),
    r = await f.report(a.identity),
    notice = await f.notice(),
    template = await f.template(),
    sendId = uid('send'),
    eventId = uid('event'),
    newContactId = uid('contact');
  const failed = await attempt(async (tx) => {
    await f.privacy.registerContact(tx, {
      id: newContactId,
      subjectId: uid('subject'),
      keys: [key()],
      envelope: encrypted(),
    });
    await lockSubjects(f.scope, tx, [a.identity.subjectId, c.value.subjectId]);
    await f.reports.saveDraft(tx, a.identity, r.head.id, null, {
      baseVersion: 1,
      schemaVersion: 1,
      input: {},
      expiresAt: time(60000),
    });
    await f.privacy.consent(tx, {
      id: uid('consent_event'),
      subjectId: c.value.subjectId,
      purpose: 'report',
      scope: 'one',
      expectedRevision: rev('1'),
      action: 'grant',
      noticeId: notice,
      policyVersion: 'v1',
      method: 'synthetic',
      expiresAt: null,
    });
    await f.delivery.schedule(tx, {
      id: sendId,
      owner: a.identity,
      contactId: c.value.id,
      kind: 'report',
      reportId: r.head.id,
      reportVersion: 1,
      comparisonRevision: null,
      templateId: template,
      provider: 'fake',
      providerKey: uid('provider_key'),
      delaySeconds: 60,
      policyVersion: 'v1',
      noticeId: notice,
      purposes: ['report'],
    });
    await f.reliability.append(tx, {
      eventId,
      aggregateId: rid('aggregate', sendId),
      aggregateKind: 'send',
      type: 'send.requested',
      version: 1,
      payload: { resource_id: sendId, resource_kind: 'send' },
    });
    await f.reports.saveDraft(tx, a.identity, r.head.id, rev('99'), {
      baseVersion: 1,
      schemaVersion: 1,
      input: {},
      expiresAt: time(60000),
    });
  });
  expect(failed).toMatchObject(conflict);
  expect(await run((tx) => f.privacy.contact(tx, newContactId))).toBeNull();
  expect(await run((tx) => f.reports.draft(tx, a.identity, r.head.id))).toBeNull();
  expect(await run((tx) => f.delivery.owned(tx, a.identity, sendId))).toBeNull();
  expect(
    (await run((tx) => f.privacy.permission(tx, c.value.subjectId, 'report', 'one'))).status,
  ).toBe('unknown');
  expect(
    (await f.admin.query('SELECT id FROM app.outbox WHERE event_id=$1', [eventId])).rowCount,
  ).toBe(0);
});
it('deduplicates inbox/outbox identities, fences leases and rejects stale processing', async () => {
  const e = {
    eventId: uid('event'),
    aggregateId: uid('aggregate'),
    aggregateKind: 'send',
    type: 'send.requested',
    version: 1,
    payload: { resource_id: uid('send'), resource_kind: 'send', revision: '9007199254740993' },
  };
  const id = await run((tx) => f.reliability.append(tx, e));
  expect(await run((tx) => f.reliability.append(tx, e))).toBe(id);
  expect(await attempt((tx) => f.reliability.append(tx, { ...e, type: 'changed' }))).toMatchObject(
    conflict,
  );
  const lease = await run((tx) => f.reliability.lease(tx, 'fixture', 30));
  expect(lease?.id).toBe(id);
  if (!lease) throw new Error('lease');
  expect(await run((tx) => f.reliability.lease(tx, 'fixture2', 30))).toBeNull();
  expect(
    await attempt((tx) => f.reliability.acknowledge(tx, { ...lease, token: uid('lease') })),
  ).toMatchObject(conflict);
  await run((tx) => f.reliability.acknowledge(tx, lease));
  expect(await attempt((tx) => f.reliability.acknowledge(tx, lease))).toMatchObject(conflict);
  const input = {
    provider: 'fake',
    eventId: uid('provider_event'),
    digest: key().digest,
    assetId: null,
    receivedAt: time(),
    verifiedAt: time(100),
  };
  const inbox = await run((tx) => f.reliability.receive(tx, input));
  expect(await run((tx) => f.reliability.receive(tx, input))).toEqual(inbox);
  expect(
    await attempt((tx) => f.reliability.receive(tx, { ...input, digest: key().digest })),
  ).toMatchObject(conflict);
  expect(
    await attempt((tx) => f.reliability.process(tx, inbox.id, inbox.revision, 'processed')),
  ).toMatchObject(conflict);
  const processing = await run((tx) =>
    f.reliability.process(tx, inbox.id, inbox.revision, 'processing'),
  );
  expect(processing.state).toBe('processing');
  expect(
    (await run((tx) => f.reliability.process(tx, inbox.id, processing.revision, 'processed')))
      .state,
  ).toBe('processed');
  expect(
    await attempt((tx) => f.reliability.process(tx, inbox.id, processing.revision, 'failed')),
  ).toMatchObject(conflict);
});
it('denies private-role storage locations, staff administration, publication and history deletion', async () => {
  for (const sql of [
    'SELECT bucket,object_key FROM app.object_assets',
    'SELECT * FROM admin.staff_identities',
    'DELETE FROM app.report_versions',
    "UPDATE app.dataset_bundles SET status='rejected'",
  ])
    expect(await attempt((tx) => f.scope.query(tx, sql))).toMatchObject({ ok: false });
  expect(
    await result(f.readScope.unitOfWork, (tx) =>
      f.readScope.query(tx, 'SELECT * FROM privacy.contacts'),
    ),
  ).toMatchObject({ ok: false });
});
it('serializes competing cancellation and claim without creating duplicate attempts', async () => {
  for (const makeDue of [false, true]) {
    const x = await scheduled();
    if (makeDue) await due(x.send.id);
    const [cancel, claim] = await Promise.all([
      attempt((tx) => f.delivery.cancel(tx, x.a.identity, x.send.id, x.send.revision)),
      attempt((tx) => f.delivery.claim(tx, x.claim)),
    ]);
    expect(cancel.ok).toBe(!makeDue);
    expect(claim.ok).toBe(makeDue);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM email.send_attempts WHERE send_id=$1', [
          x.send.id,
        ])
      ).rows[0].n,
    ).toBe(makeDue ? 1 : 0);
  }
});
it('allows one competing report revision and replaces an expired draft safely', async () => {
  const a = await f.owner(),
    r = await f.report(a.identity),
    d = { baseVersion: 1, schemaVersion: 1 as const, input: {}, expiresAt: time(60000) };
  const old = await run((tx) => f.reports.saveDraft(tx, a.identity, r.head.id, null, d));
  await f.admin.query(
    "UPDATE app.report_drafts SET created_at=now()-interval '2 days',updated_at=now()-interval '1 day',expires_at=now()-interval '1 hour' WHERE report_id=$1",
    [r.head.id],
  );
  expect(await run((tx) => f.reports.draft(tx, a.identity, r.head.id))).toBeNull();
  expect(
    (await run((tx) => f.reports.saveDraft(tx, a.identity, r.head.id, null, d))).revision,
  ).toBe(old.revision + 1n);
  expect(
    await attempt((tx) =>
      f.reports.saveDraft(tx, a.identity, r.head.id, old.revision, {
        ...d,
        input: { stale: true },
      }),
    ),
  ).toMatchObject(conflict);
  const next = { ...r.version, version: 2, baseVersion: 1 };
  const results = await Promise.all([
    attempt((tx) => f.reports.publish(tx, a.identity, r.head.revision, next, [])),
    attempt((tx) => f.reports.publish(tx, a.identity, r.head.revision, next, [])),
  ]);
  expect(results.filter((x) => x.ok)).toHaveLength(1);
  expect(results.filter((x) => !x.ok)[0]).toMatchObject(conflict);
});
it('confirms and rotates contact ciphertext without changing identity or silently overwriting revisions', async () => {
  const c = await f.contact(),
    a = await f.owner();
  const found = await run((tx) =>
    f.privacy.registerContact(tx, { ...c.input, guardSubjects: [a.identity.subjectId] }),
  );
  expect(found.id).toBe(c.value.id);
  const confirmed = await run((tx) => f.privacy.confirmContact(tx, c.value.id, c.value.revision));
  expect(confirmed.verifiedAt).not.toBeNull();
  const e = encrypted('next-enc'),
    rotated = await run((tx) => f.privacy.rotateContact(tx, c.value.id, confirmed.revision, e));
  expect(rotated.envelope).toEqual(e);
  expect(rotated.subjectId).toBe(c.value.subjectId);
  expect(rotated.verifiedAt).toBe(confirmed.verifiedAt);
  expect(
    await attempt((tx) => f.privacy.rotateContact(tx, c.value.id, confirmed.revision, e)),
  ).toMatchObject(conflict);
  expect(
    await attempt((tx) => f.privacy.confirmContact(tx, uid('contact'), rev('1'))),
  ).toMatchObject({ ok: false, error: { code: 'not_found' } });
});
it('reclaims an expired outbox lease while rejecting the old worker fence', async () => {
  const e = {
    eventId: uid('event'),
    aggregateId: uid('aggregate'),
    aggregateKind: 'send',
    type: 'send.requested',
    version: 1,
    payload: { resource_id: uid('send'), resource_kind: 'send' },
  };
  await run((tx) => f.reliability.append(tx, e));
  const old = await run((tx) => f.reliability.lease(tx, 'old', 30));
  if (!old) throw new Error('lease');
  await f.admin.query(
    "UPDATE app.outbox SET created_at=now()-interval '2 minutes',updated_at=now()-interval '1 minute',lease_until=now()-interval '1 second' WHERE id=$1",
    [old.id],
  );
  const fresh = await run((tx) => f.reliability.lease(tx, 'fresh', 30));
  expect(fresh?.generation).toBe(old.generation + 1n);
  expect(await attempt((tx) => f.reliability.acknowledge(tx, old))).toMatchObject(conflict);
  if (!fresh) throw new Error('lease');
  await run((tx) => f.reliability.acknowledge(tx, fresh));
});
