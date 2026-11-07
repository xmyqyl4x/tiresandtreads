import { createAnalysisErasureServices } from '../../packages/application/src/analysis/analysis-lifecycle.ts';
import { createAnalysisErasureRepository } from '../../packages/db/src/repositories/analysis-lifecycle.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { analysisLifecycleFixture } from '../fixtures/phase2/analysis-lifecycle.ts';
import { composeAnalysisDelivery } from '../fixtures/phase2/compose-analysis-delivery.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
const cleanups: (() => Promise<void>)[] = [];
async function setup(...args: Parameters<typeof composeAnalysisDelivery>) {
  const s = await composeAnalysisDelivery(...args);
  cleanups.push(s.cleanup);
  return s;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
let f: Awaited<ReturnType<typeof analysisLifecycleFixture>>;
beforeAll(async () => {
  f = await analysisLifecycleFixture();
}, 90000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);

async function example(ai: Awaited<ReturnType<typeof composeReportAnalysis>>) {
  const e = await ai.example(),
    old = e.version.output.result as Record<string, unknown>,
    output = {
      ...e.version.output,
      result: {
        ...old,
        asOf: new Date().toISOString(),
        versions: {
          engine: 'synthetic-v1',
          schema: 1,
          policy: 'fixture',
          scoring: 'fixture',
          bundleId: f.bundleId,
          datasets: [],
          ruleVersionId: f.ruleId,
        },
      },
    },
    head = value(
      await f.scope.unitOfWork.run(async (tx) =>
        ok(
          await f.reports.create(tx, e.owner.identity, {
            id: uuid('report'),
            market: 'US',
            locale: 'en-US',
            expiresAt: new Date(
              Date.now() + 86400000,
            ).toISOString() as import('../../packages/domain/src/values/core.ts').Instant,
          }),
        ),
      ),
    ),
    report = value(
      await f.scope.unitOfWork.run(async (tx) =>
        ok(
          await f.reports.publish(
            tx,
            e.owner.identity,
            head.revision,
            { ...e.version, reportId: head.id, output },
            [
              {
                key: 'synthetic-pick',
                skuId: null,
                kind: 'picked',
                rank: 1,
                snapshot: { price: null },
              },
            ],
          ),
        ),
      ),
    );
  return { ...e, report: report.id, input: { ...e.input, reportId: report.id } };
}
it('captures explicit fallback once, deduplicates its command and rejects changed presentation identity', async () => {
  const s = await setup(f),
    command = uuid('command'),
    a = await s.request(command),
    b = await s.request(command);
  expect(a).toEqual(b);
  expect(
    (
      await s.service.request([s.owner.token], command, {
        ...s.input,
        analysis: { attachmentRevision: null, fallback: 'declined' },
      })
    ).ok,
  ).toBe(false);
  const row = await s.row(a.id);
  expect(row.document.analysisIdentity).toEqual({
    schema: 1,
    mode: 'none',
    fallback: 'unavailable',
  });
  expect(row.document).not.toHaveProperty('analysis');
  await s.due(a.id);
  value(await s.service.dispatch(a.id));
  expect(s.provider.send).toHaveBeenCalledOnce();
  expect(s.provider.send.mock.calls[0]![1].mail.text).toContain('AI assistance was not included');
});
it('freezes an exact attachment revision into retry bytes without regeneration or automatic resend', async () => {
  const ai = await composeReportAnalysis(f),
    e = await example(ai),
    pending = value(await ai.service.request(e.keys, e.input));
  value(await ai.service.execute(pending.id));
  const a = (
    await f.admin.query(
      'SELECT revision::text FROM app.report_analysis_attachments WHERE report_id=$1',
      [e.report],
    )
  ).rows[0]!;
  const s = await setup(f, undefined, { owner: e.owner, report: e.report }),
    send = await s.request(uuid('command'), {
      ...s.input,
      analysis: { attachmentRevision: a.revision, fallback: null },
    });
  await s.due(send.id);
  s.provider.send.mockResolvedValueOnce({ outcome: 'uncertain', messageId: null });
  value(await s.service.dispatch(send.id));
  const first = s.provider.send.mock.calls[0]![1],
    calls = ai.calls.length;
  await f.admin.query(
    'UPDATE email.delivery_work SET next_attempt_at=clock_timestamp() WHERE send_id=$1',
    [send.id],
  );
  value(await s.service.dispatch(send.id));
  expect(s.provider.send.mock.calls[1]![1]).toEqual(first);
  expect(ai.calls).toHaveLength(calls);
  expect(s.renderer.render).toHaveBeenCalledOnce();
  value(await s.service.dispatch(send.id));
  expect(s.provider.send).toHaveBeenCalledTimes(2);
  expect(first.mail.text).toContain('AI-assisted installer questions');
  expect(JSON.stringify((await s.row(send.id)).document)).not.toMatch(
    /PRIVATE_ZIP|omit-this-note|providerRequestId/,
  );
});
it('stops a selected presentation after withdrawal without replacing it with a different attachment or fallback', async () => {
  const ai = await composeReportAnalysis(f),
    e = await example(ai),
    pending = value(await ai.service.request(e.keys, e.input));
  value(await ai.service.execute(pending.id));
  const a = (
      await f.admin.query(
        'SELECT revision::text FROM app.report_analysis_attachments WHERE report_id=$1',
        [e.report],
      )
    ).rows[0]!,
    s = await setup(f, undefined, { owner: e.owner, report: e.report }),
    send = await s.request(uuid('command'), {
      ...s.input,
      analysis: { attachmentRevision: a.revision, fallback: null },
    });
  const scope = (
    await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [pending.id])
  ).rows[0]!.scope_id;
  value(
    await ai.service.choice(e.keys, {
      scopeId: scope,
      expectedRevision: '1',
      allowed: false,
      noticeVersion: ai.d.noticeVersion,
    }),
  );
  await s.due(send.id);
  await s.service.dispatch(send.id);
  expect(s.provider.send).not.toHaveBeenCalled();
  expect((await s.row(send.id)).document.analysisIdentity.attachmentRevision).toBe(a.revision);
});
it('rolls back the whole request when an unavailable attachment is selected', async () => {
  const s = await setup(f);
  expect(
    (
      await s.service.request([s.owner.token], uuid('command'), {
        ...s.input,
        analysis: { attachmentRevision: '999', fallback: null },
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await f.admin.query('SELECT id FROM email.email_sends WHERE owner_subject_id=$1', [
        s.owner.identity.subjectId,
      ])
    ).rows,
  ).toHaveLength(0);
});

it('does not upgrade an already captured fallback when assistance arrives later', async () => {
  const ai = await composeReportAnalysis(f),
    e = await example(ai),
    s = await setup(f, undefined, { owner: e.owner, report: e.report }),
    send = await s.request(),
    pending = value(await ai.service.request(e.keys, e.input));
  value(await ai.service.execute(pending.id));
  await s.due(send.id);
  value(await s.service.dispatch(send.id));
  expect(s.provider.send.mock.calls[0]![1].mail.text).toContain('AI assistance was not included');
  expect(s.provider.send).toHaveBeenCalledOnce();
});

async function makeRights(
  s: Awaited<ReturnType<typeof setup>>,
  erase: Parameters<typeof createAnalysisErasureServices>[0]['mail']['erase'] = async () =>
    'not_stored',
) {
  const worker = f.privacyAdapter(),
    owner = f.analysisServiceAdapter(),
    repository = createAnalysisErasureRepository(worker, 'fixture-private', ['fixture-kms']),
    owners = createAnalysisErasureRepository(owner, 'fixture-private', ['fixture-kms']);
  return createAnalysisErasureServices({
    uow: worker.unitOfWork,
    ownerUow: owner.unitOfWork,
    repository,
    owners,
    crypto: createPrivacyCrypto('local', { local: new Uint8Array(32).fill(37) }),
    now: () => new Date().toISOString(),
    journal: { async append() {} },
    encryption: s.encryption,
    objects: s.objects,
    mail: {
      async verify() {
        throw Error('Notifications held');
      },
      erase,
    },
    provider: {
      async erase() {
        return 'not_stored';
      },
    },
  });
}
async function eraseRights(
  rights: Awaited<ReturnType<typeof makeRights>>,
  job: Parameters<typeof rights.workOne>[0],
) {
  for (let n = 0; n < 100; n++) {
    const state = value(await rights.status(job));
    if (state !== 'pending') return state;
    expect((await rights.workOne(job)).ok).toBe(true);
  }
  return value(await rights.status(job));
}
it('review regression: fences every reserved ID while rendering is paused before asset registration', async () => {
  const ai = await composeReportAnalysis(f),
    e = await example(ai),
    pending = value(await ai.service.request(e.keys, e.input));
  value(await ai.service.execute(pending.id));
  const a = (
      await f.admin.query(
        'SELECT revision::text,authorization_scope_id FROM app.report_analysis_attachments WHERE report_id=$1',
        [e.report],
      )
    ).rows[0]!,
    s = await setup(f, undefined, { owner: e.owner, report: e.report }),
    send = await s.request(uuid('command'), {
      ...s.input,
      analysis: { attachmentRevision: a.revision, fallback: null },
    }),
    rights = await makeRights(s);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      enter = r;
    }),
    held = new Promise<void>((r) => {
      release = r;
    }),
    original = s.renderer.render.getMockImplementation()!;
  s.renderer.render.mockImplementation(async (document) => {
    enter();
    await held;
    return original(document);
  });
  await s.due(send.id);
  const dispatch = s.service.dispatch(send.id);
  await entered;
  try {
    const job = value(
      await rights.removeScope(e.keys, a.authorization_scope_id, 'reserved-' + uuid('command')),
    );
    expect(await eraseRights(rights, job)).toBe('complete');
    const ids = (
      await f.admin.query(
        'SELECT asset_id FROM email.delivery_asset_reservations WHERE send_id=$1',
        [send.id],
      )
    ).rows.map((x) => x.asset_id);
    expect(
      (
        await f.admin.query(
          'SELECT asset_id FROM privacy.asset_barriers WHERE asset_id=ANY($1::uuid[])',
          [ids],
        )
      ).rows,
    ).toHaveLength(2);
  } finally {
    release();
    await dispatch;
  }
  expect(s.objectsData.size).toBe(0);
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('review regression: waits for an admitted pending delivery write before acknowledging physical erasure', async () => {
  const ai = await composeReportAnalysis(f),
    e = await example(ai),
    pending = value(await ai.service.request(e.keys, e.input));
  value(await ai.service.execute(pending.id));
  const a = (
      await f.admin.query(
        'SELECT revision::text,authorization_scope_id FROM app.report_analysis_attachments WHERE report_id=$1',
        [e.report],
      )
    ).rows[0]!,
    s = await setup(f, undefined, { owner: e.owner, report: e.report }),
    send = await s.request(uuid('command'), {
      ...s.input,
      analysis: { attachmentRevision: a.revision, fallback: null },
    }),
    rights = await makeRights(s);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      enter = r;
    }),
    held = new Promise<void>((r) => {
      release = r;
    }),
    write = vi.spyOn(s.objects, 'put'),
    original = write.getMockImplementation()!;
  write.mockImplementation(async (...args) => {
    enter();
    await held;
    return original(...args);
  });
  await s.due(send.id);
  const dispatch = s.service.dispatch(send.id);
  await entered;
  let job: Parameters<typeof rights.workOne>[0] | undefined;
  try {
    job = value(
      await rights.removeScope(
        e.keys,
        a.authorization_scope_id,
        'pending-write-' + uuid('command'),
      ),
    );
    for (let n = 0; n < 35; n++) expect((await rights.workOne(job)).ok).toBe(true);
    expect(value(await rights.status(job))).toBe('pending');
  } finally {
    release();
    await dispatch;
  }
  expect(await eraseRights(rights, job!)).toBe('complete');
  expect(s.objectsData.size).toBe(0);
  expect(s.provider.send).not.toHaveBeenCalled();
});

it.each(['recent_claim', 'old_claim_active_lease', 'old_receipt_active_lease'])(
  'review regression: drains admitted email handoff before cleanup (%s)',
  async (mode) => {
    const ai = await composeReportAnalysis(f),
      e = await example(ai),
      pending = value(await ai.service.request(e.keys, e.input));
    value(await ai.service.execute(pending.id));
    const attachment = (
        await f.admin.query(
          'SELECT revision::text,authorization_scope_id FROM app.report_analysis_attachments WHERE report_id=$1',
          [e.report],
        )
      ).rows[0]!,
      s = await setup(f, undefined, { owner: e.owner, report: e.report }),
      send = await s.request(uuid('command'), {
        ...s.input,
        analysis: { attachmentRevision: attachment.revision, fallback: null },
      });
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      }),
      delivered = new Set<string>();
    s.provider.send.mockImplementation(async (key) => {
      enter();
      await held;
      delivered.add(key);
      return { outcome: 'accepted', messageId: 'synthetic-late-message' };
    });
    const erase = vi.fn<Parameters<typeof createAnalysisErasureServices>[0]['mail']['erase']>(
        async (x) => (delivered.delete(x.deliveryKey) ? 'erased' : 'not_stored'),
      ),
      rights = await makeRights(s, erase);
    await s.due(send.id);
    const dispatch = s.service.dispatch(send.id);
    await entered;
    let job: Parameters<typeof rights.workOne>[0] | undefined;
    try {
      if (mode !== 'recent_claim') {
        await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
        try {
          await f.admin.query(
            "UPDATE email.email_sends SET created_at=statement_timestamp()-interval '2 hours',cancel_deadline=statement_timestamp()-interval '61 minutes',send_after=statement_timestamp()-interval '61 minutes',claimed_at=statement_timestamp()-interval '1 hour',provider_message_id=$2 WHERE id=$1",
            [send.id, mode === 'old_receipt_active_lease' ? 'synthetic-prior-message' : null],
          );
        } finally {
          await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
        }
      }
      job = value(
        await rights.removeScope(
          e.keys,
          attachment.authorization_scope_id,
          'handoff-drain-' + uuid('command'),
        ),
      );
      for (let n = 0; n < 35; n++) expect((await rights.workOne(job)).ok).toBe(true);
      expect(value(await rights.status(job))).toBe('pending');
      expect(erase).not.toHaveBeenCalled();
      expect(delivered.size).toBe(0);
    } finally {
      release();
      await dispatch;
    }
    expect(delivered.size).toBe(1);
    // Owned fixture clock fast-forward after the paused provider has returned. No original
    // SQL/service policy or production deadline is changed by these synthetic observations.
    await f.admin.query(
      "UPDATE email.delivery_work SET lease_until=clock_timestamp()-interval '1 second' WHERE send_id=$1",
      [send.id],
    );
    await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
    try {
      await f.admin.query(
        "UPDATE email.email_sends SET claimed_at=clock_timestamp()-interval '46 seconds' WHERE id=$1",
        [send.id],
      );
    } finally {
      await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
    }
    expect(await eraseRights(rights, job!)).toBe('complete');
    expect(erase).toHaveBeenCalledOnce();
    expect(erase.mock.calls[0]![0].deliveryKey).toBe((await s.row(send.id)).provider_key);
    expect(delivered.size).toBe(0);
    expect(s.objectsData.size).toBe(0);
  },
);
