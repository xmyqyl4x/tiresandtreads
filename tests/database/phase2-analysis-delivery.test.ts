import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
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
