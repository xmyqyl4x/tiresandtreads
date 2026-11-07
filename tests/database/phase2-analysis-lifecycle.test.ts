import { afterAll, beforeAll, afterEach, expect, it } from 'vitest';
import { analysisLifecycleFixture } from '../fixtures/phase2/analysis-lifecycle.ts';
import { composePhotoServices } from '../fixtures/phase2/compose-photo-services.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
import { createAnalysisPrivacyRuntime } from '../../packages/integrations/src/analysis-privacy-runtime.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createAnalysisReferenceEncryption } from '../../packages/integrations/src/analysis-reference-encryption.ts';
import { createEnvelopeEncryption } from '../../packages/integrations/src/storage.ts';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import { ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import type { SignedPrivacyRecord } from '../../packages/application/src/ports/privacy-services.ts';
import { createAnalysisErasureRepository } from '../../packages/db/src/repositories/analysis-lifecycle.ts';
import { withFreshAnalysisScopes } from '../../packages/application/src/analysis/analysis-lifecycle.ts';
import { createReportAnalysisServices } from '../../packages/application/src/analysis/report-analysis.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
let runtimeOptions: Parameters<typeof createAnalysisPrivacyRuntime>[0];
let g: Awaited<ReturnType<typeof composePhotoServices>>,
  r: Awaited<ReturnType<typeof createAnalysisPrivacyRuntime>>,
  pg: ReturnType<Awaited<ReturnType<typeof analysisLifecycleFixture>>['privacyAdapter']>,
  kms: KMSClient;
const entries = new Map<string, SignedPrivacyRecord>(),
  erased: string[] = [],
  crypto = createPrivacyCrypto('local-v1', { 'local-v1': new Uint8Array(32).fill(34) });
let journalFails = false,
  providerResult: 'erased' | 'unsupported' = 'erased',
  objectFails = false;
let f: Awaited<ReturnType<typeof analysisLifecycleFixture>>;
beforeAll(async () => {
  f = await analysisLifecycleFixture();
  g = await composePhotoServices(f);
  pg = f.privacyAdapter();
  const e = await ready(),
    asset = (
      await f.admin.query('SELECT key_version FROM app.object_assets WHERE id=$1', [e.original_id])
    ).rows[0]!;
  kms = new KMSClient({
    endpoint: 'http://moto:5000',
    region: 'us-east-1',
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    maxAttempts: 1,
  });
  const key = (
    await kms.send(new CreateKeyCommand({ Description: 'Owned local reference envelope proof' }))
  ).KeyMetadata!.Arn!;
  const encryption = createEnvelopeEncryption(kms, key),
    referenceEncryption = createAnalysisReferenceEncryption(key, { [key]: encryption });
  for (const kind of ['delete', 'restrict'])
    await f.admin.query(
      "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'synthetic','local52',$2,now())",
      ['rights:' + kind, { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 }],
    );
  await f.admin.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='privacy_operator'",
    [f.staff],
  );
  runtimeOptions = {
    scope: pg,
    ownerScope: g.adapter,
    crypto,
    contacts: createContactCrypto(
      't1',
      { t1: new Uint8Array(32).fill(14) },
      { 'test-hmac-v1': new Uint8Array(32).fill(15) },
      new Uint8Array(32).fill(16),
    ),
    encryption,
    referenceEncryption,
    policyVersion: 'local52',
    now: () => new Date().toISOString(),
    assetBucket: g.bucket,
    assetKeyVersions: [asset.key_version],
    journal: { async append() {} },
    analysisJournal: {
      async append(k, record) {
        if (journalFails) throw Error('Synthetic journal unavailable');
        entries.set(k, record);
      },
    },
    objects: {
      ...g.objects,
      async erase(a) {
        if (objectFails) throw Error('Synthetic object timeout');
        await g.objects.erase(a);
      },
    },
    mail: {
      async verify() {
        throw Error('Actual notifications held');
      },
      async erase() {
        return 'not_stored';
      },
    },
    provider: {
      async erase(i) {
        erased.push(i.reference);
        return providerResult;
      },
    },
  };
  r = await createAnalysisPrivacyRuntime(runtimeOptions);
}, 90000);
afterAll(async () => {
  try {
    await g?.cleanup();
  } finally {
    kms?.destroy();
    await f?.cleanup();
  }
}, 60000);
it('applies the exact opt-in52 prefix and seven forced-RLS lifecycle tables', async () => {
  expect(f.lifecycleApplied).toBe(1);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(52);
  const rows = (
    await f.admin.query(
      "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN(('privacy','ai_scope_marks'),('privacy','ai_erasure_jobs'),('privacy','ai_erasure_targets'),('privacy','ai_erasure_receipts'),('privacy','ai_provider_objects'),('email','ai_delivery_bindings'),('app','photo_save_plans'))",
    )
  ).rows;
  expect(rows).toHaveLength(7);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
});

afterEach(() => {
  g?.reset();
  journalFails = false;
  objectFails = false;
  providerResult = 'erased';
});
async function ready() {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input));
  value(await g.service.finalize(e.keys, { uploadId: i.id, grant: i.grant }, e.bytes));
  const row = (
    await f.admin.query(
      'SELECT scope_id,original_id,sanitized_id FROM app.photo_service_intents WHERE id=$1',
      [i.id],
    )
  ).rows[0]!;
  return { ...e, i, ...row };
}
async function remove(e: Awaited<ReturnType<typeof ready>>) {
  return value(await r.analysis.removeScope(e.keys, e.scope_id, 'remove-' + uuid('command')));
}
async function drain(job: Parameters<typeof r.analysis.workOne>[0]) {
  for (let n = 0; n < 80; n++) {
    const state = value(await r.analysis.status(job));
    if (state !== 'pending') return state;
    const step = await r.analysis.workOne(job);
    if (!step.ok) throw Error(JSON.stringify(step));
  }
  throw Error(
    'Bounded erasure did not settle ' +
      JSON.stringify(
        (
          await f.admin.query(
            'SELECT phase,failures,blocked_phase,inflight_id FROM privacy.ai_erasure_jobs WHERE id=$1',
            [job],
          )
        ).rows,
      ),
  );
}
async function objectVersions(e: Awaited<ReturnType<typeof ready>>) {
  const v = await g.s3.send(new ListObjectVersionsCommand({ Bucket: g.bucket }));
  return [...(v.Versions ?? []), ...(v.DeleteMarkers ?? [])].filter((x) =>
    [e.original_id, e.sanitized_id].some((id) => x.Key === 'assets/' + id),
  );
}
it('revokes immediately, journals once, erases every real object version and private SQL graph', async () => {
  const e = await ready(),
    j = await remove(e);
  expect((await g.service.get(e.keys, e.i.id)).ok).toBe(false);
  expect(await objectVersions(e)).toHaveLength(2);
  expect(await drain(j)).toBe('complete');
  expect(await objectVersions(e)).toHaveLength(0);
  for (const table of [
    'app.ai_reuse_scopes',
    'app.photo_service_intents',
    'app.tire_photo_uploads',
  ])
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int n FROM ' +
            table +
            ' WHERE ' +
            (table.endsWith('ai_reuse_scopes') ? 'id' : 'scope_id') +
            '=$1',
          [e.scope_id],
        )
      ).rows[0]!.n,
    ).toBe(0);
  expect(
    (await f.admin.query('SELECT owner_id,target_id FROM privacy.ai_erasure_jobs WHERE id=$1', [j]))
      .rows[0],
  ).toEqual({ owner_id: null, target_id: null });
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM privacy.ai_scope_marks WHERE scope_hash=privacy.ai_scope_hash($1)',
        [e.scope_id],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it('uses one stable signed record when journal append fails and retries after key change', async () => {
  const e = await ready(),
    j = await remove(e);
  journalFails = true;
  expect(value(await r.analysis.workOne(j))?.status).toBe('retry_pending');
  const pinned = (
    await f.admin.query('SELECT journal_record FROM privacy.ai_erasure_jobs WHERE id=$1', [j])
  ).rows[0]!.journal_record;
  journalFails = false;
  const rotated = await createAnalysisPrivacyRuntime({
    ...runtimeOptions,
    crypto: createPrivacyCrypto('local-v2', {
      'local-v1': new Uint8Array(32).fill(34),
      'local-v2': new Uint8Array(32).fill(35),
    }),
  });
  value(await rotated.analysis.workOne(j));
  expect(entries.get(pinned.digest)).toEqual(pinned);
  expect(await drain(j)).toBe('complete');
});
it('bounds failures, refuses unauthorized recovery, then audits a reviewed retry', async () => {
  const e = await ready(),
    j = await remove(e);
  journalFails = true;
  for (let n = 0; n < 5; n++) value(await r.analysis.workOne(j));
  expect(value(await r.analysis.status(j))).toBe('blocked');
  expect((await r.analysis.retry(j, uuid('staff'), 'a'.repeat(64))).ok).toBe(false);
  journalFails = false;
  value(await r.analysis.retry(j, f.staff, 'a'.repeat(64)));
  expect(await drain(j)).toBe('complete');
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM admin.audit_events WHERE action='analysis.erasure_retry'",
      )
    ).rows[0]!.n,
  ).toBeGreaterThan(0);
});
it('retains an uncertain admitted object across worker loss and rejects a conflicting new hold', async () => {
  const e = await ready(),
    j = await remove(e);
  value(await r.analysis.workOne(j));
  value(await r.analysis.workOne(j));
  objectFails = true;
  for (let n = 0; n < 3; n++) value(await r.analysis.workOne(j));
  expect(
    (await f.admin.query('SELECT inflight_id FROM privacy.ai_erasure_jobs WHERE id=$1', [j]))
      .rows[0]!.inflight_id,
  ).not.toBeNull();
  await expect(
    f.admin.query(
      "INSERT INTO privacy.legal_holds(subject_id,resource_kind,resource_id,reason_code,approved_by,review_after) VALUES($1,'ai_scope',$2,'litigation',$3,clock_timestamp()+interval '1 day')",
      [e.owner.identity.subjectId, e.scope_id, f.staff],
    ),
  ).rejects.toThrow();
  objectFails = false;
  expect(await drain(j)).toBe('complete');
});
it('respects a legal hold committed before erasure admission and resumes after release', async () => {
  const e = await ready(),
    j = await remove(e),
    hold = uuid('hold');
  await f.admin.query(
    "INSERT INTO privacy.legal_holds(id,subject_id,resource_kind,resource_id,reason_code,approved_by,review_after) VALUES($1,$2,'ai_scope',$3,'litigation',$4,clock_timestamp()+interval '1 day')",
    [hold, e.owner.identity.subjectId, e.scope_id, f.staff],
  );
  value(await r.analysis.workOne(j));
  value(await r.analysis.workOne(j));
  for (let n = 0; n < 5; n++) value(await r.analysis.workOne(j));
  expect(value(await r.analysis.status(j))).toBe('blocked');
  expect(await objectVersions(e)).toHaveLength(2);
  await f.admin.query('UPDATE privacy.legal_holds SET released_at=clock_timestamp() WHERE id=$1', [
    hold,
  ]);
  value(await r.analysis.retry(j, f.staff, 'b'.repeat(64)));
  expect(await drain(j)).toBe('complete');
});
it('refuses a foreign owner and conflicting scope command before mutating anything', async () => {
  const e = await ready(),
    other = await f.owner();
  expect(
    (await r.analysis.removeScope([other.token], e.scope_id, 'foreign-' + uuid('command'))).ok,
  ).toBe(false);
  expect(await objectVersions(e)).toHaveLength(2);
  const command = 'same-' + uuid('command'),
    a = value(await r.analysis.removeScope(e.keys, e.scope_id, command));
  expect(value(await r.analysis.removeScope(e.keys, e.scope_id, command))).toBe(a);
  expect(await drain(a)).toBe('complete');
});
it('rejects unsigned/stale replay and replays authenticated opaque marks without reopening traffic', async () => {
  const e = await ready(),
    j = await remove(e);
  value(await r.analysis.workOne(j));
  const pinned = (
    await f.admin.query('SELECT journal_record FROM privacy.ai_erasure_jobs WHERE id=$1', [j])
  ).rows[0]!.journal_record;
  const snapshot = { version: 1, capturedAt: new Date().toISOString(), entries: [pinned.document] };
  expect((await r.analysis.replay({ ...crypto.sign(snapshot), digest: '0'.repeat(64) })).ok).toBe(
    false,
  );
  expect(value(await r.analysis.replay(crypto.sign(snapshot)))).toEqual({
    replayed: 1,
    trafficActivation: false,
  });
  expect(
    (await r.analysis.replay(crypto.sign({ ...snapshot, capturedAt: '2020-01-01T00:00:00Z' }))).ok,
  ).toBe(false);
  expect(JSON.stringify(pinned)).not.toContain(e.scope_id);
  expect(await drain(j)).toBe('complete');
});
it('purges a pending intent without requiring a completed photo upload claim', async () => {
  const e = await g.example(),
    i = value(await g.service.intent(e.keys, e.input)),
    row = (
      await f.admin.query('SELECT scope_id FROM app.photo_service_intents WHERE id=$1', [i.id])
    ).rows[0]!,
    j = value(await r.analysis.removeScope(e.keys, row.scope_id, 'pending-' + uuid('command')));
  expect(await drain(j)).toBe('complete');
});
it('requires a reviewed explicit saved-image choice and never extends on replay', async () => {
  const e = await ready(),
    input = {
      uploadId: e.i.id,
      noticeVersion: 'saved-photo-local-v1',
      command: 'save-' + uuid('command'),
    };
  expect((await r.analysis.save(e.keys, input)).ok).toBe(false);
  await f.admin.query(
    'INSERT INTO app.photo_save_plans(policy_id,max_days,notice_version,reviewed_by,evidence_hash) VALUES($1,30,$2,$3,$4)',
    [e.policy, input.noticeVersion, f.staff, 'c'.repeat(64)],
  );
  const until = value(await r.analysis.save(e.keys, input));
  expect(Date.parse(until) - Date.now()).toBeGreaterThan(29 * 86400000);
  expect(value(await r.analysis.save(e.keys, input))).toBe(until);
  expect(
    (await r.analysis.save(e.keys, { ...input, command: 'other-' + uuid('command') })).ok,
  ).toBe(false);
  expect(await drain(await remove(e))).toBe('complete');
});
it('removes analysis during a model return without attaching late output, while preserving report facts', async () => {
  const s = await composeReportAnalysis(f),
    e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input)),
    before = (
      await f.admin.query('SELECT output_snapshot FROM app.report_versions WHERE report_id=$1', [
        e.report,
      ])
    ).rows;
  let job: Parameters<typeof drain>[0] | undefined;
  s.setBehavior(async () => {
    const scope = (
      await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [pending.id])
    ).rows[0]!.scope_id;
    job = value(await r.analysis.removeScope(e.keys, scope, 'during-' + uuid('command')));
    return {
      state: 'complete',
      output: {
        schema: 1,
        summary: 'report_facts',
        claims: [],
        limitations: ['source_limits'],
        questions: ['verify_fitment'],
      },
      providerRequestId: 'synthetic',
      inputTokens: 1n,
      outputTokens: 1n,
      costMinor: 1n,
    };
  });
  expect(value(await s.service.execute(pending.id)).state).not.toBe('available');
  expect(await drain(job!)).toBe('complete');
  expect(
    (
      await f.admin.query('SELECT output_snapshot FROM app.report_versions WHERE report_id=$1', [
        e.report,
      ])
    ).rows,
  ).toEqual(before);
});

it('composes owner deletion through the AI graph before completing the existing P1 rights workflow', async () => {
  const e = await ready(),
    report = await f.report(e.owner.identity),
    request = value(
      await r.requestOwner(e.keys, 'delete', 'synthetic', 'owner-delete-' + uuid('command')),
    );
  await f.admin.query(
    'UPDATE privacy.request_work SET barrier_until=clock_timestamp(),next_attempt_at=clock_timestamp() WHERE request_id=$1',
    [request.id],
  );
  for (let n = 0; n < 100; n++) {
    expect((await r.workOne(request.id)).ok).toBe(true);
    const state = value(await r.status(request.proof));
    if (state.status === 'completed') break;
    if (state.status === 'manual_review')
      throw Error(
        'Unexpected manual review ' +
          JSON.stringify(
            (
              await f.admin.query('SELECT * FROM privacy.request_work WHERE request_id=$1', [
                request.id,
              ])
            ).rows,
          ),
      );
  }
  expect(value(await r.status(request.proof)).status).toBe('completed');
  expect(await objectVersions(e)).toHaveLength(0);
  expect(
    (await f.admin.query('SELECT id FROM app.reports WHERE id=$1', [report.head.id])).rows,
  ).toHaveLength(0);
});

it('refuses old-scope resurrection after purge and permits fresh explicit assistance under a new identity', async () => {
  const s = await composeReportAnalysis(f),
    e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  value(await s.service.execute(pending.id));
  const old = (
    await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [pending.id])
  ).rows[0]!.scope_id;
  const j = value(await r.analysis.removeScope(e.keys, old, 'old-scope-' + uuid('command')));
  expect(await drain(j)).toBe('complete');
  expect((await s.service.request(e.keys, { ...e.input, key: 'new-' + uuid('command') })).ok).toBe(
    false,
  );
  const rights = createAnalysisErasureRepository(s.adapter, g.bucket, ['unused']),
    fresh = createReportAnalysisServices({
      ...s.d,
      scopes: withFreshAnalysisScopes(s.d.scopes, rights, () => uuid('ai_scope')),
    }),
    next = value(await fresh.request(e.keys, { ...e.input, key: 'fresh-' + uuid('command') }));
  expect(next.state).toBe('pending');
  expect(
    (await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [next.id]))
      .rows[0]!.scope_id,
  ).not.toBe(old);
});
it.each(['erased', 'unsupported'] as const)(
  'registers late encrypted provider references before settlement and handles %s cleanup',
  async (result) => {
    const s = await composeReportAnalysis(f),
      e = await s.example(),
      pending = value(await s.service.request(e.keys, e.input)),
      resource = uuid('erasure_resource');
    let j: Parameters<typeof drain>[0] | undefined;
    s.setBehavior(async (input) => {
      const row = (
        await f.admin.query('SELECT id,scope_id FROM app.ai_attempts WHERE request_id=$1', [
          pending.id,
        ])
      ).rows[0]!;
      j = value(await r.analysis.removeScope(e.keys, row.scope_id, 'provider-' + uuid('command')));
      const registration = {
        id: resource,
        attemptId: row.id,
        scopeId: row.scope_id,
        provider: 'synthetic',
        kind: 'file',
        reference: 'file_synthetic_only',
      };
      value(await r.analysis.registerProvider(registration));
      value(await r.analysis.registerProvider(registration));
      expect(
        (await r.analysis.registerProvider({ ...registration, reference: 'different_reference' }))
          .ok,
      ).toBe(false);
      expect(
        (
          await f.admin.query(
            "SELECT encode(ciphertext,'hex') AS ciphertext FROM privacy.ai_provider_objects WHERE id=$1",
            [resource],
          )
        ).rows[0]!.ciphertext,
      ).not.toContain(Buffer.from(registration.reference).toString('hex'));
      return s.defaultBehavior(input);
    });
    const execution = await s.service.execute(pending.id);
    expect(execution.ok ? execution.value.state : 'unavailable').not.toBe('available');
    providerResult = result;
    expect(await drain(j!)).toBe(result === 'erased' ? 'complete' : 'blocked');
    expect(erased).toContain('file_synthetic_only');
    if (result === 'unsupported') {
      providerResult = 'erased';
      value(await r.analysis.retry(j!, f.staff, 'd'.repeat(64)));
      expect(await drain(j!)).toBe('complete');
    }
  },
);
it('holds unknown provider charges until explicit reconciliation and preserves aggregate spend', async () => {
  const s = await composeReportAnalysis(f),
    e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async () => {
    throw Error('Synthetic uncertain return');
  });
  value(await s.service.execute(pending.id));
  const row = (
      await f.admin.query('SELECT id,scope_id FROM app.ai_attempts WHERE request_id=$1', [
        pending.id,
      ])
    ).rows[0]!,
    j = value(await r.analysis.removeScope(e.keys, row.scope_id, 'charge-' + uuid('command')));
  expect(await drain(j)).toBe('blocked');
  value(
    await s.adapter.unitOfWork.run(async (tx) =>
      ok(
        await s.d.budgets.reconcile(tx, row.id, {
          state: 'settled',
          costMinor: 7n,
          reason: null,
          evidenceId: null,
        }),
      ),
    ),
  );
  value(await r.analysis.retry(j, f.staff, 'e'.repeat(64)));
  expect(await drain(j)).toBe('complete');
  expect(
    (
      await f.admin.query('SELECT spent_minor::text FROM app.ai_budget_windows WHERE id=$1', [
        e.budget,
      ])
    ).rows[0]!.spent_minor,
  ).toBe('7');
});

it('replays a newer signed erasure over an older fixture state and schedules physical cleanup without traffic activation', async () => {
  const e = await ready(),
    j = await remove(e);
  value(await r.analysis.workOne(j));
  const pinned = (
    await f.admin.query('SELECT journal_record FROM privacy.ai_erasure_jobs WHERE id=$1', [j])
  ).rows[0]!.journal_record;
  // Controlled old-state simulation only; latest-chain pg_restore acceptance remains held.
  await f.admin.query('DELETE FROM privacy.ai_erasure_targets WHERE job_id=$1', [j]);
  await f.admin.query('DELETE FROM privacy.ai_erasure_jobs WHERE id=$1', [j]);
  await f.admin.query(
    'DELETE FROM privacy.ai_scope_marks WHERE scope_hash=privacy.ai_scope_hash($1)',
    [e.scope_id],
  );
  await f.admin.query(
    "UPDATE app.ai_scope_guards SET state='active',processing_allowed=true,permission_revision=permission_revision+1 WHERE scope_id=$1",
    [e.scope_id],
  );
  expect(
    value(
      await r.analysis.replay(
        crypto.sign({
          version: 1,
          capturedAt: new Date().toISOString(),
          entries: [pinned.document],
        }),
      ),
    ),
  ).toEqual({ replayed: 1, trafficActivation: false });
  expect((await g.service.get(e.keys, e.i.id)).ok).toBe(false);
  const work = (
    await f.admin.query(
      "SELECT id FROM privacy.ai_erasure_jobs WHERE target_id=$1 AND phase='prepare'",
      [e.scope_id],
    )
  ).rows[0]!.id;
  expect(await drain(work)).toBe('complete');
  expect(await objectVersions(e)).toHaveLength(0);
});
it('purges candidates, confirmations, model artifacts, reuse and photo job links while retaining report facts', async () => {
  const e = await ready(),
    report = await f.report(e.owner.identity),
    request = value(
      await g.service.extract(e.keys, { uploadId: e.i.id, key: 'extract-' + uuid('command') }),
    );
  expect(value(await g.service.execute(request.id)).state).toBe('available');
  value(
    await g.service.confirm(e.keys, {
      uploadId: e.i.id,
      candidateId: null,
      field: 'tire_size',
      revision: '1',
      value: '225/65R17',
    }),
  );
  const before = (
    await f.admin.query('SELECT output_snapshot FROM app.report_versions WHERE report_id=$1', [
      report.head.id,
    ])
  ).rows;
  expect(await drain(await remove(e))).toBe('complete');
  expect(
    (await f.admin.query('SELECT id FROM app.photo_field_candidates WHERE upload_id=$1', [e.i.id]))
      .rows,
  ).toHaveLength(0);
  expect(
    (
      await f.admin.query('SELECT output_snapshot FROM app.report_versions WHERE report_id=$1', [
        report.head.id,
      ])
    ).rows,
  ).toEqual(before);
});

it('denies raw lifecycle reads and mutations to existing runtime roles', async () => {
  for (const scope of [g.adapter, pg, f.scope])
    for (const table of [
      'privacy.ai_scope_marks',
      'privacy.ai_erasure_jobs',
      'privacy.ai_provider_objects',
      'email.ai_delivery_bindings',
    ]) {
      const denied = await scope.unitOfWork.run(async (tx) => {
        await scope.query(tx, 'SELECT * FROM ' + table);
        return ok(null);
      });
      expect(denied.ok).toBe(false);
    }
});
it('rejects stale erasure lease generations after an owned fixture cold handoff', async () => {
  const e = await ready(),
    j = await remove(e),
    repo = createAnalysisErasureRepository(pg, g.bucket, [
      (
        await f.admin.query('SELECT key_version FROM app.object_assets WHERE id=$1', [
          e.original_id,
        ])
      ).rows[0]!.key_version,
    ]),
    lease = value(await pg.unitOfWork.run(async (tx) => ok(await repo.acquire(tx, j))));
  expect(lease).not.toBeNull();
  await f.admin.query(
    "UPDATE privacy.ai_erasure_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [j],
  );
  const next = value(await pg.unitOfWork.run(async (tx) => ok(await repo.acquire(tx, j))));
  expect(next!.generation > lease!.generation).toBe(true);
  expect(
    (
      await pg.unitOfWork.run(async (tx) => {
        await repo.release(tx, lease!, false);
        return ok(null);
      })
    ).ok,
  ).toBe(false);
  value(
    await pg.unitOfWork.run(async (tx) => {
      await repo.release(tx, next!, false);
      return ok(null);
    }),
  );
  expect(await drain(j)).toBe('complete');
});

it('review regression: returns from SQL cleanup to erase a provider reference registered after the provider phase', async () => {
  const s = await composeReportAnalysis(f),
    e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  let j: Parameters<typeof drain>[0] | undefined;
  s.setBehavior(async (input) => {
    const row = (
      await f.admin.query('SELECT id,scope_id FROM app.ai_attempts WHERE request_id=$1', [
        pending.id,
      ])
    ).rows[0]!;
    j = value(await r.analysis.removeScope(e.keys, row.scope_id, 'late-phase-' + uuid('command')));
    expect(await drain(j)).toBe('blocked');
    value(
      await r.analysis.registerProvider({
        id: uuid('erasure_resource'),
        attemptId: row.id,
        scopeId: row.scope_id,
        provider: 'synthetic',
        kind: 'file',
        reference: 'file_arrived_after_provider_phase',
      }),
    );
    return s.defaultBehavior(input);
  });
  const execution = await s.service.execute(pending.id);
  expect(execution.ok ? execution.value.state : 'unavailable').not.toBe('available');
  value(await r.analysis.retry(j!, f.staff, 'f'.repeat(64)));
  expect(await drain(j!)).toBe('complete');
  expect(erased).toContain('file_arrived_after_provider_phase');
});
it.each(['delete', 'restrict'] as const)(
  'review regression: completes a verified no-match email %s without a bound subject',
  async (kind) => {
    value(
      await r.requestEmail('unmatched-' + uuid('email') + '@example.invalid', kind, 'synthetic'),
    );
    const row = (
        await f.admin.query(
          "SELECT p.id FROM privacy.privacy_requests p WHERE p.status='pending' AND p.policy_version='local52' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0]!,
      proof = crypto.proof(row.id, crypto.current).raw;
    // Fixture-only proof possession/notification timestamp; no mail transport is called.
    await f.admin.query(
      'UPDATE privacy.request_work SET notified_at=clock_timestamp() WHERE request_id=$1',
      [row.id],
    );
    value(await r.confirm(proof));
    await f.admin.query(
      'UPDATE privacy.request_work SET barrier_until=clock_timestamp(),next_attempt_at=clock_timestamp() WHERE request_id=$1',
      [row.id],
    );
    for (let n = 0; n < 30; n++) {
      expect((await r.workOne(row.id)).ok).toBe(true);
      const state = value(await r.status(proof));
      if (state.status === 'completed' || state.status === 'manual_review') break;
      await f.admin.query(
        'UPDATE privacy.request_work SET next_attempt_at=clock_timestamp() WHERE request_id=$1',
        [row.id],
      );
    }
    expect(value(await r.status(proof)).status).toBe('completed');
    expect(
      (
        await f.admin.query('SELECT id FROM privacy.ai_erasure_jobs WHERE linked_request=$1', [
          row.id,
        ])
      ).rows,
    ).toHaveLength(0);
  },
);
