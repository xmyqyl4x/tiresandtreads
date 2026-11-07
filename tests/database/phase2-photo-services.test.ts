import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { photoServiceFixture } from '../fixtures/phase2/photo-services.ts';
import { composePhotoServices } from '../fixtures/phase2/compose-photo-services.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
import { createPhotoServices } from '../../packages/application/src/analysis/photo-services.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof photoServiceFixture>>,
  g: Awaited<ReturnType<typeof composePhotoServices>>;
beforeAll(async () => {
  f = await photoServiceFixture();
  g = await composePhotoServices(f);
}, 90000);
afterAll(async () => {
  try {
    await g?.cleanup();
  } finally {
    await f?.cleanup();
  }
  if (g)
    console.log(
      'P2_PHOTO_SERVICE_EVIDENCE ' +
        JSON.stringify({
          actualPostgreSQL: true,
          migrations: 51,
          newTables: 3,
          nativeCases: 32,
          actualEncryptedVersionedLocalStorage: true,
          actualIsolatedImageCodec: true,
          syntheticScanner: true,
          syntheticModelTransport: true,
          syntheticModelCalls: g.calls.length,
          ownerBoundCaptures: true,
          explicitConfirmation: true,
          imageLifetimeHours: 24,
          actualAVAcceptance: false,
          actualModelEvaluation: false,
          actualPrivacyAcceptance: false,
          actualS3Acceptance: false,
          productionBootstrapChanged: false,
          productionRuntimeChanged: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
}, 60000);
afterEach(() => g?.reset());
async function ready() {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input));
  if (!i.id || !i.grant) throw Error('Expected owned intent');
  value(await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes));
  return { ...e, i };
}
async function versions(upload: string) {
  const rows = (
    await f.admin.query(
      'SELECT original_id,sanitized_id FROM app.photo_service_intents WHERE id=$1',
      [upload],
    )
  ).rows[0]!;
  const all = await g.s3.send(new ListObjectVersionsCommand({ Bucket: g.bucket }));
  return [...(all.Versions ?? []), ...(all.DeleteMarkers ?? [])].filter((v) =>
    [rows.original_id, rows.sanitized_id].some((id) => v.Key === 'assets/' + id),
  );
}
it('applies only the exact51 local prefix and three new forced-RLS service tables', async () => {
  expect(f.photoServicesApplied).toBe(1);
  const relations = (
    await f.admin.query(
      "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname=ANY($1::text[]) ORDER BY c.relname",
      [['photo_service_captures', 'photo_service_intents', 'photo_upload_plans']],
    )
  ).rows;
  expect(relations).toHaveLength(3);
  expect(relations.every((r) => r.relrowsecurity === true && r.relforcerowsecurity === true)).toBe(
    true,
  );

  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(51);
});
it('creates a private owner-bound short-lived intent and replays only its exact command', async () => {
  const e = await g.example(),
    a = value(await g.service.intent(e.keys, e.input)),
    b = value(await g.service.intent(e.keys, e.input));
  expect(a).toEqual(b);
  expect(Date.parse(a.grantUntil!) - Date.now()).toBeLessThanOrEqual(600000);
  expect(await versions(a.id!)).toHaveLength(0);
  expect((await g.service.intent(e.keys, { ...e.input, sha256: 'b'.repeat(64) })).ok).toBe(false);
});
it('preserves the manual path when optional photo processing is declined', async () => {
  const e = await g.example(),
    before = (await f.admin.query('SELECT count(*)::int n FROM app.photo_service_intents')).rows[0]!
      .n;
  expect(value(await g.service.intent(e.keys, { ...e.input, allowed: false })).state).toBe(
    'manual',
  );
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM app.photo_service_intents')).rows[0]!.n,
  ).toBe(before);
  expect(g.service.manual({ field: 'tire_size', value: '225/65R17' })).toMatchObject({
    ok: true,
    value: '225/65R17',
  });
  expect(g.service.manual({ field: 'condition', value: 'safe' }).ok).toBe(false);
  expect(g.service.manual(null).ok).toBe(false);
});
it('finalizes through actual versioned private storage and an isolated real codec, then replays without more writes', async () => {
  const e = await ready(),
    before = await versions(e.i.id!);
  expect(before).toHaveLength(2);
  expect(value(await g.service.get(e.keys, e.i.id)).state).toBe('ready');
  value(await g.service.finalize(e.keys, { uploadId: e.i.id, grant: e.i.grant }, e.bytes));
  expect(await versions(e.i.id!)).toEqual(before);
  expect(before.every((v) => v.Key?.startsWith('assets/'))).toBe(true);
});
it('refuses forged grants, foreign owners and modified finalized bytes', async () => {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input)),
    other = await f.owner();
  expect(
    (await g.service.finalize(e.keys, { uploadId: i.id, grant: '0'.repeat(64) }, e.bytes)).ok,
  ).toBe(false);
  expect(
    (await g.service.finalize([other.token], { uploadId: i.id, grant: i.grant }, e.bytes)).ok,
  ).toBe(false);
  const corrupt = new Uint8Array(e.bytes);
  corrupt[10] = corrupt[10]! ^ 1;
  expect((await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, corrupt)).ok).toBe(
    false,
  );
  expect(await versions(i.id!)).toHaveLength(0);
});
it('rejects expired grants using controlled disposable timestamps', async () => {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input));
  await f.admin.query('ALTER TABLE app.photo_service_intents DISABLE TRIGGER photo_intent_guard');
  try {
    await f.admin.query(
      "UPDATE app.photo_service_intents SET created_at=statement_timestamp()-interval '11 minutes',grant_until=statement_timestamp()-interval '1 minute',expires_at=statement_timestamp()+interval '23 hours' WHERE id=$1",
      [i.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE app.photo_service_intents ENABLE TRIGGER photo_intent_guard');
  }
  expect((await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes)).ok).toBe(
    false,
  );
});
it('serializes owner daily upload quotas across concurrent different commands', async () => {
  const e = await g.example({ daily: 2, bytes: 41943040, active: 4 }),
    rs = await Promise.all(
      [0, 1, 2].map(() =>
        g.service.intent(e.keys, {
          ...e.input,
          key: 'synthetic-' + uuid('command'),
        }),
      ),
    );
  expect(rs.filter((r) => r.ok)).toHaveLength(2);
});
it('rejects a byte quota before creating an object or dispatching a provider', async () => {
  const e = await g.example({ daily: 12, bytes: 1, active: 4 });
  expect((await g.service.intent(e.keys, e.input)).ok).toBe(false);
});
it('keeps the four-image batch cap after earlier images finish', async () => {
  const e = await g.example();
  for (let n = 0; n < 4; n++) {
    const i = value(
      await g.service.intent(e.keys, { ...e.input, key: 'synthetic-' + uuid('command') }),
    );
    value(await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes));
  }
  expect(
    (await g.service.intent(e.keys, { ...e.input, key: 'synthetic-' + uuid('command') })).ok,
  ).toBe(false);
}, 30000);
it.each(['unsafe', 'unavailable'] as const)(
  'fails closed when required scanning is %s',
  async (scan) => {
    const e = await g.example(),
      i = value(await g.service.intent(e.keys, e.input)),
      before = g.calls.length;
    g.setScan(scan);
    expect((await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes)).ok).toBe(
      false,
    );
    expect((await g.service.get(e.keys, i.id)).ok).toBe(false);
    expect(await versions(i.id!)).toHaveLength(0);
    expect(g.calls.length).toBe(before);
  },
);
it('rejects an unreadable codec result and purges the quarantined original', async () => {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input)),
    service = createPhotoServices({
      ...g.d,
      codec: {
        async sanitize() {
          throw Error('synthetic unreadable image');
        },
      },
    });
  expect((await service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes)).ok).toBe(
    false,
  );
  expect(await versions(i.id!)).toHaveLength(0);
});
it('extracts only sanitized private bytes and publishes unconfirmed suggestions with partial DOT status', async () => {
  const e = await ready(),
    before = g.calls.length,
    request = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  expect(value(await g.service.get(e.keys, e.i.id)).candidates).toEqual([]);
  expect(value(await g.service.execute(request.id)).state).toBe('available');
  expect(g.calls.length - before).toBe(1);
  expect(g.calls.at(-1)).toMatchObject({
    mime: 'image/jpeg',
    strict: true,
    store: false,
    tools: [],
    maxInputTokens: 1048576,
    maxOutputTokens: 1024,
  });
  const view = value(await g.service.get(e.keys, e.i.id));
  expect(view.candidates).toHaveLength(2);
  expect(view.confirmations).toEqual([]);
  expect(view.dotStatus).toBe('partial');
  expect(view.candidates.find((c) => c.field === 'dot_tin')).toMatchObject({
    value: null,
    unknownReason: 'not_visible',
    quality: 'unknown',
  });
  expect(view.limitations).toEqual([
    'confirmation_required',
    'no_condition_assessment',
    'no_fitment_clearance',
  ]);
  expect(
    value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ).state,
  ).toBe('accepted');
});
it('requires explicit accept/correct/manual commands using the shared ordinary field validator', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  value(await g.service.execute(r.id));
  const c = value(await g.service.get(e.keys, e.i.id)).candidates.find(
    (c) => c.field === 'tire_size',
  )!;
  expect(
    value(
      await g.service.confirm(e.keys, {
        uploadId: e.i.id,
        field: c.field,
        candidateId: c.id,
        revision: '1',
        value: c.value,
      }),
    ).origin,
  ).toBe('accepted_candidate');
  expect(
    value(
      await g.service.confirm(e.keys, {
        uploadId: e.i.id,
        field: c.field,
        candidateId: c.id,
        revision: '2',
        value: '235/65R17',
      }),
    ).origin,
  ).toBe('corrected_candidate');
  expect(
    value(
      await g.service.confirm(e.keys, {
        uploadId: e.i.id,
        field: 'load_index',
        candidateId: null,
        revision: '1',
        value: '102',
      }),
    ).origin,
  ).toBe('manual');
  expect(
    (
      await g.service.confirm(e.keys, {
        uploadId: e.i.id,
        field: 'date_code',
        candidateId: null,
        revision: '1',
        value: '9999',
      })
    ).ok,
  ).toBe(false);
});
it('rejects foreign owners/candidates and stale concurrent confirmation revisions', async () => {
  const e = await ready(),
    other = await f.owner(),
    input = {
      uploadId: e.i.id,
      field: 'load_index',
      candidateId: null,
      revision: '1',
      value: '102',
    };
  expect((await g.service.confirm([other.token], input)).ok).toBe(false);
  expect(
    (await g.service.confirm(e.keys, { ...input, candidateId: uuid('photo_candidate') })).ok,
  ).toBe(false);
  const rs = await Promise.all([
    g.service.confirm(e.keys, input),
    g.service.confirm(e.keys, { ...input, value: '103' }),
  ]);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
});
it('resets refused extraction to the manual path and permits only a new explicit command to retry', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  g.setBehavior(async () => ({
    state: 'refused',
    providerRequestId: 'synthetic-refusal',
    inputTokens: 1n,
    outputTokens: 0n,
    costMinor: 1n,
  }));
  expect(value(await g.service.execute(r.id)).state).toBe('unavailable');
  expect(value(await g.service.get(e.keys, e.i.id)).state).toBe('ready');
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM app.photo_extractions WHERE upload_id=$1 AND state IN('queued','processing')",
        [e.i.id],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ).state,
  ).toBe('queued');
});
it('does not publish invented condition/fitment output and preserves measured charge evidence', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  g.setBehavior(async () => ({
    state: 'complete',
    output: { schema: 1, fields: [], safe: true },
    providerRequestId: 'synthetic-invalid',
    inputTokens: 1n,
    outputTokens: 1n,
    costMinor: 5n,
  }));
  expect(value(await g.service.execute(r.id)).state).toBe('unavailable');
  expect(value(await g.service.get(e.keys, e.i.id)).candidates).toEqual([]);
  expect(
    (await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [r.id]))
      .rows[0]!.cost_minor,
  ).toBe('5');
});
it('retains uncertain reservations without a blind photo-provider retry', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ),
    before = g.calls.length;
  g.setBehavior(async () => {
    throw Error('synthetic provider disconnect');
  });
  expect(value(await g.service.execute(r.id)).state).toBe('unavailable');
  value(await g.service.execute(r.id));
  expect(g.calls.length - before).toBe(1);
  expect(
    (
      await f.admin.query(
        'SELECT state FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
        [r.id],
      )
    ).rows.every((r) => r.state === 'uncertain'),
  ).toBe(true);
});
it('cancels queued extraction and erases every private object version on owner deletion', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ),
    calls = g.calls.length;
  expect(value(await g.service.remove(e.keys, e.i.id)).cleanupPending).toBe(false);
  expect(await versions(e.i.id!)).toHaveLength(0);
  expect((await g.service.get(e.keys, e.i.id)).ok).toBe(false);
  expect((await g.service.execute(r.id)).ok).toBe(false);
  expect(g.calls.length).toBe(calls);
});
it('preserves costs but rejects publication when the owner deletes during extraction', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  g.setBehavior(async () => {
    value(await g.service.remove(e.keys, e.i.id));
    return {
      state: 'complete',
      output: { schema: 1, fields: [] },
      providerRequestId: 'synthetic-return',
      inputTokens: 1n,
      outputTokens: 1n,
      costMinor: 5n,
    };
  });
  expect((await g.service.execute(r.id)).ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        r.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [r.id]))
      .rows[0]!.cost_minor,
  ).toBe('5');
});
it('commits immediate hiding before a storage cleanup outage and replays erasure', async () => {
  const e = await ready(),
    service = createPhotoServices({
      ...g.d,
      objects: {
        ...g.d.objects,
        async erase() {
          throw Error('synthetic storage outage');
        },
      },
    });
  expect(value(await service.remove(e.keys, e.i.id)).cleanupPending).toBe(true);
  expect((await g.service.get(e.keys, e.i.id)).ok).toBe(false);
  expect(value(await g.service.remove(e.keys, e.i.id)).cleanupPending).toBe(false);
  expect(await versions(e.i.id!)).toHaveLength(0);
});
it('blocks late finalizer publication and waits past its write lease before replayable erasure', async () => {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input));
  let arrived!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      arrived = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    }),
    service = createPhotoServices({
      ...g.d,
      codec: {
        async sanitize(bytes, mime) {
          arrived();
          await wait;
          return g.d.codec.sanitize(bytes, mime);
        },
      },
    });
  const pending = service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes);
  await entered;
  expect(value(await g.service.remove(e.keys, i.id)).cleanupPending).toBe(true);
  release();
  expect((await pending).ok).toBe(false);
  expect((await g.service.get(e.keys, i.id)).ok).toBe(false);
  await f.admin.query('ALTER TABLE app.photo_service_intents DISABLE TRIGGER photo_intent_guard');
  try {
    await f.admin.query(
      "UPDATE app.photo_service_intents SET cleanup_after=clock_timestamp()-interval '1 second' WHERE id=$1",
      [i.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE app.photo_service_intents ENABLE TRIGGER photo_intent_guard');
  }
  expect(value(await g.service.remove(e.keys, i.id)).cleanupPending).toBe(false);
  expect(await versions(i.id!)).toHaveLength(0);
});
it('honors scope withdrawal before finalize without publishing an upload', async () => {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input));
  const row = (
    await f.admin.query('SELECT scope_id FROM app.photo_service_intents WHERE id=$1', [i.id])
  ).rows[0]!;
  value(
    await g.adapter.unitOfWork.run(async (tx) => {
      const scope = await g.d.scopes.scope(
        tx,
        row.scope_id as import('../../packages/domain/src/values/core.ts').Id<'ai_scope'>,
      );
      if (!scope) throw Error('Missing scope');
      await g.d.scopes.choice(tx, {
        scopeId: scope.id,
        expectedRevision: scope.permissionRevision,
        subjectRevision: scope.subjectRevision,
        allowed: false,
        noticeVersion: g.d.noticeVersion,
        evidenceHash: 'a'.repeat(64),
      });
      return ok(null);
    }),
  );
  expect((await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes)).ok).toBe(
    false,
  );
});
it('expires and erases bounded owned records using controlled disposable timestamps', async () => {
  const e = await ready();
  await f.admin.query('ALTER TABLE app.photo_service_intents DISABLE TRIGGER photo_intent_guard');
  try {
    await f.admin.query(
      "UPDATE app.photo_service_intents SET created_at=statement_timestamp()-interval '25 hours',grant_until=statement_timestamp()-interval '24 hours 50 minutes',expires_at=statement_timestamp()-interval '1 hour' WHERE id=$1",
      [e.i.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE app.photo_service_intents ENABLE TRIGGER photo_intent_guard');
  }
  expect((await g.service.get(e.keys, e.i.id)).ok).toBe(false);
  expect(value(await g.service.expire()).processed).toBeGreaterThan(0);
  expect(await versions(e.i.id!)).toHaveLength(0);
});

it('issues idempotent server-bound capture groups instead of trusting arbitrary upload batch identifiers', async () => {
  const e = await g.example(),
    input = { policyId: e.policy, key: 'capture-' + uuid('command') },
    a = value(await g.service.capture(e.keys, input));
  expect(value(await g.service.capture(e.keys, input))).toEqual(a);
  expect((await g.service.intent(e.keys, { ...e.input, batchId: uuid('photo_batch') })).ok).toBe(
    false,
  );
});
it('refuses another owner capture group before creating an upload intent', async () => {
  const e = await g.example(),
    other = await f.owner();
  expect((await g.service.intent([other.token], e.input)).ok).toBe(false);
});
it('also bounds empty capture creation with a reviewed owner daily limit', async () => {
  const e = await g.example();
  for (let n = 0; n < 3; n++)
    value(
      await g.service.capture(e.keys, { policyId: e.policy, key: 'capture-' + uuid('command') }),
    );
  expect(
    (await g.service.capture(e.keys, { policyId: e.policy, key: 'capture-' + uuid('command') })).ok,
  ).toBe(false);
});

it('publishes empty not-visible readings as unknown rather than violating sealed row bounds', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  g.setBehavior(async () => ({
    state: 'complete',
    output: {
      schema: 1,
      fields: [
        {
          field: 'dot_tin',
          rawText: '',
          value: null,
          quality: 'unknown',
          unknownReason: 'not_visible',
          region: null,
        },
      ],
    },
    providerRequestId: 'synthetic-empty',
    inputTokens: 1n,
    outputTokens: 1n,
    costMinor: 5n,
  }));
  expect(value(await g.service.execute(r.id)).state).toBe('available');
  expect(value(await g.service.get(e.keys, e.i.id))).toMatchObject({
    dotStatus: 'not_visible',
    candidates: [{ rawText: null, value: null, unknownReason: 'not_visible' }],
  });
});
it('restores the manual path after an atomic publication failure while retaining its measured charge', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ),
    service = createPhotoServices({
      ...g.d,
      artifacts: {
        ...g.d.artifacts,
        async publish() {
          throw Error('synthetic publication failure');
        },
      },
    });
  expect((await service.execute(r.id)).ok).toBe(false);
  expect(value(await g.service.get(e.keys, e.i.id))).toMatchObject({
    state: 'ready',
    candidates: [],
  });
  expect(
    (await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [r.id]))
      .rows[0]!.cost_minor,
  ).toBe('5');
  expect(
    value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ).state,
  ).toBe('queued');
});

it('coalesces exact concurrent photo extraction misses and reuses the accepted result without a second model call', async () => {
  const e = await ready(),
    calls = g.calls.length;
  const [a, b] = await Promise.all([
    g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
  ]);
  const request = value(a);
  expect(value(b).id).toBe(request.id);
  expect(value(await g.service.execute(request.id)).state).toBe('available');
  expect(
    value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ),
  ).toMatchObject({ id: request.id, state: 'accepted' });
  expect(g.calls.length - calls).toBe(1);
});
it('restores manual entry after a lost extraction job lease without losing charges or blocking a new explicit request', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    );
  g.setBehavior(async () => {
    await f.admin.query(
      "UPDATE app.job_runs SET lease_until=updated_at+interval '1 microsecond' WHERE job_type='p2.photo.extract' AND resource_id=$1",
      [r.id],
    );
    return {
      state: 'complete',
      output: { schema: 1, fields: [] },
      providerRequestId: 'synthetic-lost-lease',
      inputTokens: 1n,
      outputTokens: 1n,
      costMinor: 5n,
    };
  });
  expect((await g.service.execute(r.id)).ok).toBe(false);
  expect(value(await g.service.get(e.keys, e.i.id)).state).toBe('ready');
  expect(
    (await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [r.id]))
      .rows[0]!.cost_minor,
  ).toBe('5');
  g.reset();
  const next = value(
    await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
  );
  expect(next.id).not.toBe(r.id);
});
it('recovers an expired synthetic dispatch and cancels its photo work without redispatching unknown charges', async () => {
  const e = await ready(),
    r = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'synthetic-' + uuid('command') }),
    ),
    calls = g.calls.length;
  const broken = createPhotoServices({
    ...g.d,
    provider: {
      async extract() {
        throw Error('synthetic interrupted dispatch');
      },
    },
    requests: {
      ...g.d.requests,
      async finish() {
        throw Error('synthetic unavailable persistence');
      },
    },
  });
  expect((await broken.execute(r.id)).ok).toBe(false);
  await f.admin.query('ALTER TABLE app.ai_execution_states DISABLE TRIGGER ai_execution_identity');
  try {
    await f.admin.query(
      "UPDATE app.ai_execution_states SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
      [r.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE app.ai_execution_states ENABLE TRIGGER ai_execution_identity');
  }
  value(await g.service.execute(r.id));
  expect(g.calls.length).toBe(calls);
  expect(value(await g.service.get(e.keys, e.i.id)).state).toBe('ready');
  expect(
    (
      await f.admin.query(
        'SELECT state FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
        [r.id],
      )
    ).rows.every((r) => r.state === 'uncertain'),
  ).toBe(true);
});
