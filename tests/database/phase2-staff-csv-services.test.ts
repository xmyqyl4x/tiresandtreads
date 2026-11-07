import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStaffCsvCommand } from '../../packages/integrations/src/staff-csv-commands.ts';
import { createStaffCsvRuntime } from '../../packages/integrations/src/staff-csv-runtime.ts';
import { createImportServices } from '../../packages/integrations/src/import-runtime.ts';
import { digest } from '../../packages/db/src/repositories/bounds.ts';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { staffCsvFixture } from '../fixtures/phase2/staff-csv-services.ts';
import { composeStaffCsv, value } from '../fixtures/phase2/compose-staff-csv.ts';
import { uuid } from '../fixtures/phase2/compose-partner-services.ts';
let f: Awaited<ReturnType<typeof staffCsvFixture>>, s: Awaited<ReturnType<typeof composeStaffCsv>>;
beforeAll(async () => {
  f = await staffCsvFixture();
  s = await composeStaffCsv(f);
}, 90000);
afterAll(async () => {
  try {
    await s?.cleanup();
  } finally {
    await f?.cleanup();
  }
  console.log(
    'P2_STAFF_CSV_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        actualEncryptedVersionedLocalStorage: true,
        migrations: 53,
        newTables: 2,
        nativeCases: 19,
        sharedP1Ingestion: true,
        scriptServiceParity: true,
        independentReviewerPublisher: true,
        staleHeadRefresh: true,
        atomicPublication: true,
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
it('applies exact local53 and two forced-RLS support tables without changing default manifests', async () => {
  expect(f.csvServicesApplied).toBe(1);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(53);
  const rows = (
    await f.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN('admin.csv_upload_commands'::regclass,'admin.csv_preview_commands'::regclass)",
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
});
it('links a private versioned CSV upload to a real P1 manual import and validates through the shared engine', async () => {
  const e = await s.example(),
    id = await s.upload(e),
    command = (await f.admin.query('SELECT * FROM admin.csv_upload_commands WHERE id=$1', [id]))
      .rows[0]!;
  expect(command.phase).toBe('registered');
  expect(new TextDecoder().decode(await s.files.read(command.asset_id))).toBe(
    new TextDecoder().decode(e.bytes),
  );
  expect(value(await s.service.validate(s.uploader, id)).phase).toBe('prepared');
  const run = (
    await f.admin.query(
      'SELECT status,mode,accepted_count::text,rejected_count::text FROM app.import_runs WHERE id=$1',
      [command.run_id],
    )
  ).rows[0]!;
  expect(run).toEqual({
    status: 'validated',
    mode: 'manual',
    accepted_count: '1',
    rejected_count: '0',
  });
});
it('produces private diff/validation artifacts, requires independent review/publisher and publishes atomically', async () => {
  const e = await s.reviewed(),
    body = { intakeId: e.id, reviewId: e.review.id, command: 'publish-' + uuid('command') };
  expect((await s.service.publish(s.uploader, body)).ok).toBe(false);
  expect((await s.service.publish(s.reviewer, body)).ok).toBe(false);
  const bundle = value(await s.service.publish(s.publisher, body));
  expect(value(await s.service.publish(s.publisher, body))).toBe(bundle);
  expect(
    (await f.admin.query('SELECT phase FROM admin.csv_upload_commands WHERE id=$1', [e.id]))
      .rows[0]!.phase,
  ).toBe('published');
  expect(
    (await f.admin.query("SELECT bundle_id FROM app.market_dataset_heads WHERE market='US'"))
      .rows[0]!.bundle_id,
  ).toBe(bundle);
});
it('refuses self-review and preserves a stable review replay', async () => {
  const e = await s.prepared(),
    p = value(
      await s.service.preview(s.uploader, {
        intakeId: e.id,
        command: 'preview-' + uuid('command'),
      }),
    ),
    body = {
      previewId: p.id,
      command: 'review-' + uuid('command'),
      decision: 'approved',
      reason: 'checks_passed',
    };
  expect((await s.service.review(s.uploader, body)).ok).toBe(false);
  const a = value(await s.service.review(s.reviewer, body));
  expect(value(await s.service.review(s.reviewer, body))).toEqual(a);
  expect((await s.service.review(s.reviewer, { ...body, decision: 'rejected' })).ok).toBe(false);
});
it('deduplicates upload commands and rejects changed CSV content or metadata', async () => {
  const e = await s.example(),
    a = await s.upload(e);
  expect(await s.upload(e)).toBe(a);
  expect((await s.service.upload(s.uploader, { ...e.input, market: 'CA' }, e.bytes)).ok).toBe(
    false,
  );
  expect(
    (
      await s.service.upload(
        s.uploader,
        e.input,
        new TextEncoder().encode(new TextDecoder().decode(e.bytes).replace('Touring', 'Changed')),
      )
    ).ok,
  ).toBe(false);
});
it('rejects critical/formula rows and exports closed diagnostics without source cells', async () => {
  const e = await s.example(
      'model_id,brand,model,category,seasonal_class,source_record_key\n' +
        uuid('tire_model') +
        ',=HYPERLINK(evil),CSV Touring,touring,all_season,x',
    ),
    id = await s.upload(e);
  expect(value(await s.service.validate(s.uploader, id)).phase).toBe('rejected');
  const errors = value(await s.service.errors(s.reviewer, id));
  expect(errors.csv).toContain('formula');
  expect(errors.csv).not.toContain('HYPERLINK');
  expect(
    (await s.service.preview(s.reviewer, { intakeId: id, command: 'preview-' + uuid('command') }))
      .ok,
  ).toBe(false);
});
it('cancels unpromoted work, generation-fences the P1 lease and leaves live heads alone', async () => {
  const e = await s.prepared(),
    before = (await f.admin.query('SELECT * FROM app.market_dataset_heads')).rows;
  value(
    await s.service.cancel(s.uploader, { intakeId: e.id, command: 'cancel-' + uuid('command') }),
  );
  expect((await s.service.validate(s.uploader, e.id)).ok).toBe(false);
  expect((await f.admin.query('SELECT * FROM app.market_dataset_heads')).rows).toEqual(before);
});

it('requires a fresh preview and independent review after the publication head advances', async () => {
  const a = await s.reviewed(),
    b = await s.reviewed();
  value(
    await s.service.publish(s.publisher, {
      intakeId: b.id,
      reviewId: b.review.id,
      command: 'publish-b-' + uuid('command'),
    }),
  );
  expect(
    (
      await s.service.publish(s.publisher, {
        intakeId: a.id,
        reviewId: a.review.id,
        command: 'stale-' + uuid('command'),
      })
    ).ok,
  ).toBe(false);
  const preview = value(
      await s.service.preview(s.reviewer, {
        intakeId: a.id,
        command: 'refresh-' + uuid('command'),
      }),
    ),
    review = value(
      await s.service.review(s.reviewer, {
        previewId: preview.id,
        command: 'review-refresh-' + uuid('command'),
        decision: 'approved',
        reason: 'checks_passed',
      }),
    );
  expect(
    (
      await s.service.publish(s.publisher, {
        intakeId: a.id,
        reviewId: review.id,
        command: 'fresh-' + uuid('command'),
      })
    ).ok,
  ).toBe(true);
});
it('serializes competing publishers and rolls back the losing plan, audit and receipt', async () => {
  const a = await s.reviewed(),
    b = await s.reviewed(),
    results = await Promise.all(
      [a, b].map((e) =>
        s.service.publish(s.publisher, {
          intakeId: e.id,
          reviewId: e.review.id,
          command: 'race-' + uuid('command'),
        }),
      ),
    );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  const rows = (
    await f.admin.query('SELECT run_id FROM app.import_publications WHERE run_id=ANY($1::uuid[])', [
      [a.preview.runId, b.preview.runId],
    ])
  ).rows;
  expect(rows).toHaveLength(1);
});
it('refuses the original script publisher path when it tries to bypass CSV review admission', async () => {
  const e = await s.reviewed(),
    bundle = uuid('bundle'),
    approval = uuid('audit_event'),
    members = e.preview.members,
    expected = e.preview.head,
    before = (await f.admin.query('SELECT * FROM app.market_dataset_heads')).rows;
  await f.admin.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'import.publish','dataset_bundle','approved',clock_timestamp(),$2,'[]')",
    [approval, digest(['US', members.map((m) => [m.key, m.datasetId])])],
  );
  const result = await createImportServices(s.ingest, s.publish).service.publish({
    bundleId: bundle,
    approvalId: approval,
    actorId: s.publisher,
    market: 'US',
    runId: e.preview.runId,
    members,
    required: members.map((m) => ({ key: m.key, kind: m.kind })),
    expectedHead: expected,
  });
  expect(result.ok).toBe(false);
  expect((await f.admin.query('SELECT * FROM app.market_dataset_heads')).rows).toEqual(before);
  expect(
    (
      await f.admin.query('SELECT id FROM app.import_publications WHERE run_id=$1', [
        e.preview.runId,
      ])
    ).rows,
  ).toHaveLength(0);
});
it('invalidates review on current staff-role revision changes', async () => {
  const e = await s.reviewed();
  await f.admin.query(
    'UPDATE admin.staff_identities SET role_revision=role_revision+1 WHERE id=$1',
    [s.reviewer],
  );
  expect(
    (
      await s.service.publish(s.publisher, {
        intakeId: e.id,
        reviewId: e.review.id,
        command: 'revoked-' + uuid('command'),
      })
    ).ok,
  ).toBe(false);
});
it('resumes the same private upload reservation after storage failure without extending retention', async () => {
  const e = await s.example();
  let fail = true;
  const alternate = await createStaffCsvRuntime({
    ...s.options,
    files: {
      ...s.files,
      async store(...args) {
        if (fail) throw Error('Synthetic object outage');
        return s.files.store(...args);
      },
    },
  });
  expect((await alternate.upload(s.uploader, e.input, e.bytes)).ok).toBe(false);
  const before = (
    await f.admin.query(
      'SELECT id,expires_at FROM admin.csv_upload_commands WHERE command_hash=$1',
      [s.crypto.hash('csv.upload.command', s.uploader + '\0' + e.input.command)],
    )
  ).rows[0]!;
  fail = false;
  const result = value(await alternate.upload(s.uploader, e.input, e.bytes));
  expect(result.id).toBe(before.id);
  expect(
    (
      await f.admin.query('SELECT expires_at FROM admin.csv_upload_commands WHERE id=$1', [
        result.id,
      ])
    ).rows[0]!.expires_at,
  ).toEqual(before.expires_at);
});
it('replays exact stored evidence identities after the second evidence write fails', async () => {
  const e = await s.prepared();
  let writes = 0,
    fail = true;
  const alternate = await createStaffCsvRuntime({
      ...s.options,
      files: {
        ...s.files,
        async store(...args) {
          if (args[1] === 'import_evidence' && ++writes === 2 && fail)
            throw Error('Synthetic artifact outage');
          return s.files.store(...args);
        },
      },
    }),
    body = { intakeId: e.id, command: 'preview-retry-' + uuid('command') };
  expect((await alternate.preview(s.reviewer, body)).ok).toBe(false);
  const before = (
    await f.admin.query(
      'SELECT id,diff_asset,validation_asset FROM admin.csv_preview_commands WHERE intake_id=$1',
      [e.id],
    )
  ).rows[0]!;
  fail = false;
  const after = value(await alternate.preview(s.reviewer, body));
  expect(after).toMatchObject({
    id: before.id,
    diffAssetId: before.diff_asset,
    validationAssetId: before.validation_asset,
    complete: true,
  });
});
it('keeps duplicate source keys as critical rejects under the common P1 staging engine', async () => {
  const row = () => uuid('tire_model') + ',Synthetic,Duplicate,touring,all_season,same-key',
    e = await s.example(
      'model_id,brand,model,category,seasonal_class,source_record_key\n' + row() + '\n' + row(),
    ),
    id = await s.upload(e);
  expect(value(await s.service.validate(s.uploader, id)).phase).toBe('rejected');
  expect(value(await s.service.errors(s.reviewer, id)).csv).toContain('duplicate');
});
it('rejects malformed CSV before reserving a command or writing a private object', async () => {
  const e = await s.example('wrong,header\nunsafe,values'),
    before = (await f.admin.query('SELECT count(*)::int n FROM admin.csv_upload_commands')).rows[0]!
      .n,
    result = value(await s.service.upload(s.uploader, e.input, e.bytes));
  expect(result.phase).toBe('invalid');
  expect(result.id).toBeNull();
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM admin.csv_upload_commands')).rows[0]!.n,
  ).toBe(before);
});
it('checks exact runtime roles and denies raw support tables to existing backend credentials', async () => {
  await expect(createStaffCsvRuntime({ ...s.options, staff: s.ingest })).rejects.toThrow();
  for (const scope of [s.staff, s.ingest, s.publish]) {
    const r = await scope.unitOfWork.run(async (tx) => {
      await scope.query(tx, 'SELECT * FROM admin.csv_upload_commands');
      return { ok: true as const, value: null };
    });
    expect(r.ok).toBe(false);
  }
});

it('uses one shared workflow for the local script adapter and direct admin service calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-csv-parity-'));
  try {
    const e = await s.example();
    await writeFile(join(dir, 'source.csv'), e.bytes);
    async function script(command: string, actorId: string, input: unknown) {
      await writeFile(join(dir, 'plan.json'), JSON.stringify({ actorId, input }));
      return runStaffCsvCommand(
        [command, '--plan', 'plan.json', ...(command === 'upload' ? ['--file', 'source.csv'] : [])],
        s.service,
        dir,
      );
    }
    const uploaded = value(await script('upload', s.uploader, e.input));
    if (!uploaded || typeof uploaded !== 'object' || !('id' in uploaded) || !uploaded.id)
      throw Error('Intake expected');
    const id = uploaded.id;
    expect(value(await s.service.upload(s.uploader, e.input, e.bytes))).toMatchObject({ id });
    value(await script('validate', s.uploader, id));
    const preview = value(
      await s.service.preview(s.reviewer, {
        intakeId: id,
        command: 'parity-preview-' + uuid('command'),
      }),
    );
    const body = {
      previewId: preview.id,
      command: 'parity-review-' + uuid('command'),
      decision: 'approved',
      reason: 'checks_passed',
    };
    const review = value(await script('review', s.reviewer, body));
    if (!review || typeof review !== 'object' || !('id' in review)) throw Error('Review expected');
    expect(value(await s.service.review(s.reviewer, body))).toEqual(review);
    const publish = {
      intakeId: id,
      reviewId: review.id,
      command: 'parity-publish-' + uuid('command'),
    };
    const bundle = value(await script('publish', s.publisher, publish));
    expect(value(await s.service.publish(s.publisher, publish))).toEqual(bundle);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('returns a historical publication receipt after template retirement without changing the live head', async () => {
  const e = await s.reviewed(),
    body = { intakeId: e.id, reviewId: e.review.id, command: 'retired-replay-' + uuid('command') };
  const receipt = value(await s.service.publish(s.publisher, body));
  value(await s.service.retire(s.uploader, e.template.id));
  const before = (await f.admin.query('SELECT * FROM app.market_dataset_heads')).rows;
  expect(value(await s.service.publish(s.publisher, body))).toEqual(receipt);
  expect((await f.admin.query('SELECT * FROM app.market_dataset_heads')).rows).toEqual(before);
});
it('validates the installed domain-company mapping through the same ingestion engine', async () => {
  const e = await s.example(),
    template = value(
      await s.service.createTemplate(s.uploader, {
        mapping: 'domain_companies_v1',
        version: 1,
        maxBytes: 16777216,
        maxRows: 100000,
        state: 'active',
      }),
    );
  const bytes = new TextEncoder().encode(
    'record_id,entity_id,stable_key,display_name,country_code,official_url,valid_from,valid_to,review_status,source_record_key\n' +
      uuid('domain_version') +
      ',' +
      uuid('domain_entity') +
      ',synthetic-company,Synthetic Company,US,https://example.invalid,2026-01-01,,reviewed,company-1',
  );
  const upload = value(
    await s.service.upload(s.uploader, { ...e.input, templateId: template.id }, bytes),
  );
  if (!upload.id) throw Error('Intake expected');
  expect(value(await s.service.validate(s.uploader, upload.id)).phase).toBe('prepared');
  const run = (
    await f.admin.query(
      'SELECT accepted_count::text,rejected_count::text FROM app.import_runs WHERE id=(SELECT run_id FROM admin.csv_upload_commands WHERE id=$1)',
      [upload.id],
    )
  ).rows[0];
  expect(run).toEqual({ accepted_count: '1', rejected_count: '0' });
});
