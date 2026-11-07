import { beforeAll, afterAll, it, expect } from 'vitest';
import { staffCsvFixture, staffCsvSources } from '../fixtures/phase2/staff-csv-services.ts';
import { composeStaffCsv } from '../fixtures/phase2/compose-staff-csv.ts';
import {
  composePartnerServices,
  uuid,
  value,
} from '../fixtures/phase2/compose-partner-services.ts';
import { composePhotoServices } from '../fixtures/phase2/compose-photo-services.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { composeAnalysisDelivery } from '../fixtures/phase2/compose-analysis-delivery.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { ok, type Instant } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof staffCsvFixture>>,
  csv: Awaited<ReturnType<typeof composeStaffCsv>>,
  photo: Awaited<ReturnType<typeof composePhotoServices>>;
const closes: (() => Promise<void>)[] = [];
beforeAll(async () => {
  f = await staffCsvFixture();
  csv = await composeStaffCsv(f);
  closes.push(csv.cleanup);
  photo = await composePhotoServices(f);
  closes.push(photo.cleanup);
}, 90000);
afterAll(async () => {
  const errors: unknown[] = [];
  for (const close of closes.reverse()) {
    try {
      await close();
    } catch (e) {
      errors.push(e);
    }
  }
  try {
    await f?.cleanup();
  } catch (e) {
    errors.push(e);
  }
  if (errors.length) throw new AggregateError(errors, 'Owned service gate cleanup failed');
  console.log(
    'P2_SERVICE_GATE_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        applicationMigrations: 53,
        applicationTables: 223,
        nativeJourneys: 3,
        actualEncryptedVersionedPhotoAndCsvStorage: true,
        actualIsolatedPhotoCodec: true,
        modelAndScanner: 'synthetic-ports',
        delivery: 'synthetic-in-memory-sink',
        reportFacts: 'controlled-synthetic-repository-snapshot',
        latestChainArchiveProved: false,
        actualModelEvaluation: false,
        actualS3Acceptance: false,
        actualAuthenticationAccepted: false,
        productionBootstrapChanged: false,
        productionRuntimeChanged: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 60000);
it('runs partner onboarding, moderation and encrypted coupon import on the complete local53 chain', async () => {
  expect(await migrateApplication(f.target, staffCsvSources().sources)).toBe(0);
  const partner = await composePartnerServices(f),
    company = await partner.company(),
    offer = await partner.published(company.org, company.handle),
    queued = await partner.csvPool(
      company.org,
      company.handle,
      offer,
      'code\nLOCAL1\nLOCAL1\nLOCAL2',
    );
  const lease = value(await partner.consumer.lease(queued.queued.jobId));
  expect(lease).not.toBeNull();
  expect(value(await partner.consumer.process(lease!))).toMatchObject({
    state: 'ready',
    accepted: 2,
    duplicates: 1,
    rejected: 0,
  });
  expect(
    value(await partner.coupons.statistics(company.handle, company.org, queued.pool)),
  ).toMatchObject({ total: 2, available: 2 });
  const stranger = partner.session();
  expect((await partner.coupons.statistics(stranger, company.org, queued.pool)).ok).toBe(false);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(53);
});
it('carries only an explicit confirmed photo value into a controlled report, then freezes assistance and retries exact delivery bytes', async () => {
  const e = await photo.example(),
    intent = value(await photo.service.intent(e.keys, e.input));
  value(
    await photo.service.finalize(e.keys, { uploadId: intent.id, grant: intent.grant }, e.bytes),
  );
  const extraction = value(
    await photo.service.extract(e.keys, {
      uploadId: intent.id,
      key: 'gate-extract-' + uuid('command'),
    }),
  );
  value(await photo.service.execute(extraction.id));
  const view = value(await photo.service.get(e.keys, intent.id));
  expect(view.confirmations).toHaveLength(0);
  const candidate = view.candidates.find((c) => c.field === 'tire_size')!;
  const confirmation = value(
    await photo.service.confirm(e.keys, {
      uploadId: intent.id,
      field: 'tire_size',
      candidateId: candidate.id,
      revision: '1',
      value: '235/65R17',
    }),
  );
  expect(confirmation.origin).toBe('corrected_candidate');
  const ai = await composeReportAnalysis(f),
    basis = await ai.example(),
    head = value(
      await f.scope.unitOfWork.run(async (tx) =>
        ok(
          await f.reports.create(tx, e.owner.identity, {
            id: uuid('report'),
            market: 'US',
            locale: 'en-US',
            expiresAt: new Date(Date.now() + 86400000).toISOString() as Instant,
          }),
        ),
      ),
    );
  const output = {
    ...basis.version.output,
    result: {
      ...basis.version.output.result,
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
    prices: [],
    products: [],
  };
  const version = {
    ...basis.version,
    reportId: head.id,
    input: { ...basis.version.input, sizes: { front: confirmation.value, rear: null } },
    output,
  };
  value(
    await f.scope.unitOfWork.run(async (tx) =>
      ok(
        await f.reports.publish(tx, e.owner.identity, head.revision, version, [
          {
            key: 'synthetic-pick',
            skuId: null,
            kind: 'picked',
            rank: 1,
            snapshot: { price: null },
          },
        ]),
      ),
    ),
  );
  const before = (
    await f.admin.query(
      'SELECT input_snapshot,output_snapshot FROM app.report_versions WHERE report_id=$1',
      [head.id],
    )
  ).rows;
  const request = value(
    await ai.service.request(e.keys, {
      ...basis.input,
      reportId: head.id,
      key: 'gate-analysis-' + uuid('command'),
    }),
  );
  value(await ai.service.execute(request.id));
  expect(value(await ai.service.status(e.keys, request.id)).state).toBe('available');
  const attachment = (
      await f.admin.query(
        'SELECT revision::text FROM app.report_analysis_attachments WHERE report_id=$1',
        [head.id],
      )
    ).rows[0]!,
    delivery = await composeAnalysisDelivery(f, undefined, { owner: e.owner, report: head.id });
  closes.push(delivery.cleanup);
  const send = await delivery.request(uuid('command'), {
    ...delivery.input,
    analysis: { attachmentRevision: attachment.revision, fallback: null },
  });
  await delivery.due(send.id);
  delivery.provider.send.mockResolvedValueOnce({ outcome: 'uncertain', messageId: null });
  value(await delivery.service.dispatch(send.id));
  const first = delivery.provider.send.mock.calls[0]![1],
    calls = ai.calls.length;
  await f.admin.query(
    'UPDATE email.delivery_work SET next_attempt_at=clock_timestamp() WHERE send_id=$1',
    [send.id],
  );
  value(await delivery.service.dispatch(send.id));
  expect(delivery.provider.send.mock.calls[1]![1]).toEqual(first);
  expect(ai.calls).toHaveLength(calls);
  expect(delivery.renderer.render).toHaveBeenCalledOnce();
  expect(
    (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot FROM app.report_versions WHERE report_id=$1',
        [head.id],
      )
    ).rows,
  ).toEqual(before);
  expect(JSON.stringify(first)).not.toMatch(/rawText|PRIVATE_ZIP|omit-this-note|providerRequestId/);
});
it('publishes a reviewed CSV bundle on the combined chain without changing retained report facts or photo confirmation', async () => {
  const snapshot = (
      await f.admin.query(
        'SELECT report_id,version,input_snapshot,output_snapshot FROM app.report_versions ORDER BY report_id,version',
      )
    ).rows,
    confirmations = (
      await f.admin.query(
        'SELECT * FROM app.confirmed_photo_fields ORDER BY upload_id,field_code,revision',
      )
    ).rows;
  expect(snapshot.length).toBeGreaterThan(0);
  expect(confirmations.length).toBeGreaterThan(0);
  const e = await csv.reviewed(),
    bundle = value(
      await csv.service.publish(csv.publisher, {
        intakeId: e.id,
        reviewId: e.review.id,
        command: 'gate-csv-publish-' + uuid('command'),
      }),
    );
  expect(
    (await f.admin.query("SELECT bundle_id FROM app.market_dataset_heads WHERE market='US'"))
      .rows[0]!.bundle_id,
  ).toBe(bundle);
  expect(
    (
      await f.admin.query(
        'SELECT report_id,version,input_snapshot,output_snapshot FROM app.report_versions ORDER BY report_id,version',
      )
    ).rows,
  ).toEqual(snapshot);
  expect(
    (
      await f.admin.query(
        'SELECT * FROM app.confirmed_photo_fields ORDER BY upload_id,field_code,revision',
      )
    ).rows,
  ).toEqual(confirmations);
});
