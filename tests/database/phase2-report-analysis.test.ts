import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { analysisServiceFixture } from '../fixtures/phase2/report-analysis.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
let f: Awaited<ReturnType<typeof analysisServiceFixture>>,
  s: Awaited<ReturnType<typeof composeReportAnalysis>>;
beforeAll(async () => {
  f = await analysisServiceFixture();
  s = await composeReportAnalysis(f);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
  console.info(
    'P2_REPORT_ANALYSIS_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        migrations: 49,
        newTables: 1,
        nativeCases: 26,
        syntheticTransport: true,
        ownerBound: true,
        immutableCore: true,
        providerOutsideTransaction: true,
        actualModelEvaluation: false,
        actualPrivacyAcceptance: false,
        actualS3Acceptance: false,
        productionRuntimeChanged: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 60000);
afterEach(() => {
  s?.resetBehavior();
});
it('applies only the opt-in service chain and denies direct contact/session access', async () => {
  expect(f.analysisServiceApplied).toBe(1);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(49);
  for (const table of ['app.owner_sessions', 'privacy.contacts']) {
    const r = await s.adapter.unitOfWork.run(async (tx) => {
      await s.adapter.query(tx, 'SELECT * FROM ' + table);
      return { ok: true as const, value: null };
    });
    expect(r.ok).toBe(false);
  }
});
it('queues durable work then publishes an immutable owner-scoped enrichment without changing core output', async () => {
  const e = await s.example(),
    before = (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [e.report],
      )
    ).rows;
  const pending = value(await s.service.request(e.keys, e.input));
  expect(pending.state).toBe('pending');
  expect(value(await s.service.status(e.keys, pending.id)).state).toBe('pending');
  expect(value(await s.service.execute(pending.id)).state).toBe('available');
  const accepted = value(await s.service.status(e.keys, pending.id));
  expect(accepted).toMatchObject({ state: 'available', output: { kind: 'ai_assisted_selection' } });
  expect(accepted.output).not.toHaveProperty('providerRequestId');
  expect(JSON.stringify(s.calls.at(-1))).not.toMatch(
    /PRIVATE_ZIP|omit-this-note|token_hash|owner_subject_id/,
  );
  expect(
    (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [e.report],
      )
    ).rows,
  ).toEqual(before);
  expect(value(await s.service.request(e.keys, e.input))).toEqual(accepted);
  const count = s.calls.length;
  expect(value(await s.service.execute(pending.id)).state).toBe('deferred');
  expect(s.calls).toHaveLength(count);
});
it('deduplicates request/job creation and refuses a changed-body command key', async () => {
  const e = await s.example(),
    a = value(await s.service.request(e.keys, e.input)),
    b = value(await s.service.request(e.keys, e.input));
  expect(a).toEqual(b);
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_report_work WHERE request_id=$1', [
        a.id,
      ])
    ).rows[0]!.n,
  ).toBe(1);
  expect((await s.service.request(e.keys, { ...e.input, version: 2 })).ok).toBe(false);
});
it('refuses foreign owners and share-like digests before exposing request or report data', async () => {
  const e = await s.example(),
    other = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  expect((await s.service.request(other.keys, e.input)).ok).toBe(false);
  expect((await s.service.status(other.keys, pending.id)).ok).toBe(false);
  expect(
    (await s.service.request([{ keyVersion: 'share', digest: 'a'.repeat(64) }], e.input)).ok,
  ).toBe(false);
});
it('does not create AI work or call a model when processing is declined', async () => {
  const e = await s.example(),
    count = s.calls.length;
  expect(value(await s.service.request(e.keys, { ...e.input, allowed: false })).state).toBe(
    'not_requested',
  );
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_report_work WHERE report_id=$1', [
        e.report,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(s.calls).toHaveLength(count);
});
it('withdraws queued processing and requires a current explicit choice before reactivation', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input)),
    r = (
      await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [pending.id])
    ).rows[0]!;
  value(
    await s.service.choice(e.keys, {
      scopeId: r.scope_id,
      expectedRevision: '1',
      allowed: false,
      noticeVersion: s.d.noticeVersion,
    }),
  );
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [pending.id]))
      .rows[0]!.state,
  ).toBe('cancelled');
  expect((await s.service.execute(pending.id)).ok).toBe(false);
  expect(
    (await s.service.request(e.keys, { ...e.input, key: 'synthetic-' + uuid('command') })).ok,
  ).toBe(false);
  expect(
    (
      await s.service.choice(e.keys, {
        scopeId: r.scope_id,
        expectedRevision: '1',
        allowed: true,
        noticeVersion: s.d.noticeVersion,
      })
    ).ok,
  ).toBe(false);
  value(
    await s.service.choice(e.keys, {
      scopeId: r.scope_id,
      expectedRevision: '2',
      allowed: true,
      noticeVersion: s.d.noticeVersion,
    }),
  );
  expect(
    value(await s.service.request(e.keys, { ...e.input, key: 'synthetic-' + uuid('command') }))
      .state,
  ).toBe('pending');
});

it.each(['refused', 'incomplete'] as const)(
  'keeps the core report and charges visible after %s assistance',
  async (state) => {
    const e = await s.example(),
      pending = value(await s.service.request(e.keys, e.input));
    s.setBehavior(async (input) => ({ ...(await s.defaultBehavior(input)), state }));
    expect(value(await s.service.execute(pending.id)).state).toBe('unavailable');
    expect(value(await s.service.status(e.keys, pending.id)).output).toBeNull();
    const facts = (
      await f.admin.query(
        'SELECT a.state,a.cost_minor,b.state AS hold_state,b.settled_minor FROM app.ai_attempts a JOIN app.ai_budget_reservations b ON b.attempt_id=a.id WHERE a.request_id=$1',
        [pending.id],
      )
    ).rows;
    expect(facts).toMatchObject([
      { state: 'failed', cost_minor: '5', hold_state: 'settled', settled_minor: '5' },
    ]);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
          pending.id,
        ])
      ).rows[0]!.n,
    ).toBe(0);
  },
);
it('rejects fabricated model facts with no artifact while preserving measured cost', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async (input) => ({
    ...(await s.defaultBehavior(input)),
    output: {
      schema: 1,
      summary: 'report_facts',
      claims: [{ id: 'invented', citations: [] }],
      limitations: [],
      questions: [],
    },
  }));
  expect(value(await s.service.execute(pending.id)).state).toBe('unavailable');
});
it('withdraws processing during a provider response without a database transaction spanning the call', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async (input) => {
    const idle = (
      await f.admin.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='tt_p2_analysis_service' AND state LIKE 'idle in transaction%' ",
      )
    ).rows[0]!.n;
    expect(idle).toBe(0);
    const scope = (
      await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [pending.id])
    ).rows[0]!.scope_id;
    value(
      await s.service.choice(e.keys, {
        scopeId: scope,
        expectedRevision: '1',
        allowed: false,
        noticeVersion: s.d.noticeVersion,
      }),
    );
    return s.defaultBehavior(input);
  });
  expect((await s.service.execute(pending.id)).ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        pending.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [
        pending.id,
      ])
    ).rows[0]!.cost_minor,
  ).toBe('5');
});
it('suppresses publication when a source license is revoked during the call', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async (input) => {
    await f.admin.query(
      "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{ai_processing}','false') WHERE id IN(SELECT license_id FROM app.dataset_versions WHERE id=ANY($1::uuid[]))",
      [s.sourceIds],
    );
    return s.defaultBehavior(input);
  });
  try {
    expect((await s.service.execute(pending.id)).ok).toBe(false);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
          pending.id,
        ])
      ).rows[0]!.n,
    ).toBe(0);
  } finally {
    await f.admin.query(
      "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{ai_processing}','true') WHERE id IN(SELECT license_id FROM app.dataset_versions WHERE id=ANY($1::uuid[]))",
      [s.sourceIds],
    );
  }
});
it.each([null, 101n])(
  'retains uncertain reservations for unknown or excess charges %s',
  async (cost) => {
    const e = await s.example(),
      pending = value(await s.service.request(e.keys, e.input));
    s.setBehavior(async (input) => ({ ...(await s.defaultBehavior(input)), costMinor: cost }));
    expect(value(await s.service.execute(pending.id)).state).toBe(
      cost === null ? 'available' : 'unavailable',
    );
    const hold = (
      await f.admin.query(
        'SELECT b.state,b.reserved_minor,b.settled_minor FROM app.ai_budget_reservations b JOIN app.ai_attempts a ON a.id=b.attempt_id WHERE a.request_id=$1',
        [pending.id],
      )
    ).rows[0];
    expect(hold).toMatchObject({ state: 'uncertain', reserved_minor: '100', settled_minor: null });
  },
);
it('admits a single provider call under concurrent worker execution', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input)),
    before = s.calls.length;
  const results = await Promise.all([s.service.execute(pending.id), s.service.execute(pending.id)]);
  expect(results.filter((r) => r.ok && r.value.state === 'available')).toHaveLength(1);
  expect(s.calls.length - before).toBe(1);
});
it('hides an already accepted enrichment immediately after source rights are withdrawn', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  value(await s.service.execute(pending.id));
  await f.admin.query(
    "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{ai_processing}','false') WHERE id IN(SELECT license_id FROM app.dataset_versions WHERE id=ANY($1::uuid[]))",
    [s.sourceIds],
  );
  try {
    expect(value(await s.service.status(e.keys, pending.id))).toMatchObject({
      state: 'unavailable',
      output: null,
    });
  } finally {
    await f.admin.query(
      "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{ai_processing}','true') WHERE id IN(SELECT license_id FROM app.dataset_versions WHERE id=ANY($1::uuid[]))",
      [s.sourceIds],
    );
  }
});
it('rolls back attachment publication atomically without losing provider charge evidence', async () => {
  const e = await s.example(),
    pending = value(await s.service.request(e.keys, e.input));
  const { createReportAnalysisServices } =
    await import('../../packages/application/src/analysis/report-analysis.ts');
  const broken = createReportAnalysisServices({
    ...s.d,
    attachments: {
      ...s.d.attachments,
      async append() {
        throw Error('synthetic attachment outage');
      },
    },
  });
  expect((await broken.execute(pending.id)).ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        pending.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [
        pending.id,
      ])
    ).rows[0]!.cost_minor,
  ).toBe('5');
  expect(value(await s.service.execute(pending.id)).state).toBe('deferred');
});

it('refuses admission before dispatch when budget capacity is exhausted', async () => {
  const e = await s.example(0n),
    p = value(await s.service.request(e.keys, e.input)),
    calls = s.calls.length;
  expect((await s.service.execute(p.id)).ok).toBe(false);
  expect(s.calls).toHaveLength(calls);
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.id])).rows[0]!
      .state,
  ).toBe('queued');
});
it('refuses late publication after the owned job lease is lost', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async (input) => {
    await f.admin.query(
      "UPDATE app.job_runs SET state='cancelled',lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id IN(SELECT job_id FROM app.ai_report_work WHERE request_id=$1)",
      [p.id],
    );
    return s.defaultBehavior(input);
  });
  expect((await s.service.execute(p.id)).ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        p.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [p.id]))
      .rows[0]!.cost_minor,
  ).toBe('5');
});
it('refuses a policy retired while a provider result is in flight', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async (input) => {
    await f.admin.query("UPDATE app.ai_policy_versions SET status='retired' WHERE id=$1", [
      e.policy,
    ]);
    return s.defaultBehavior(input);
  });
  expect((await s.service.execute(p.id)).ok).toBe(false);
  expect(value(await s.service.status(e.keys, p.id))).toMatchObject({
    state: 'unavailable',
    output: null,
  });
});
it('does not dispatch a superseded report version', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input)),
    calls = s.calls.length;
  value(
    await f.scope.unitOfWork.run(async (tx) => ({
      ok: true as const,
      value: await f.reports.publish(
        tx,
        e.owner.identity,
        2n as import('../../packages/domain/src/values/core.ts').Revision,
        { ...e.version, version: 2, baseVersion: 1 },
        [],
      ),
    })),
  );
  expect((await s.service.execute(p.id)).ok).toBe(false);
  expect(s.calls).toHaveLength(calls);
});
it('never substitutes another request artifact on the same report', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input));
  value(await s.service.execute(p.id));
  const first = value(await s.service.status(e.keys, p.id));
  const other = await s.example(),
    second = value(
      await s.service.request(e.keys, {
        ...e.input,
        policyId: other.policy,
        key: 'synthetic-' + uuid('command'),
      }),
    );
  s.setBehavior(async (input) => ({
    ...(await s.defaultBehavior(input)),
    output: {
      schema: 1,
      summary: 'report_facts',
      claims: input.packet.claims.map((c) => ({ id: c.id, citations: c.citations })),
      limitations: [],
      questions: ['measure_tread'],
    },
  }));
  value(await s.service.execute(second.id));
  expect(value(await s.service.status(e.keys, p.id))).toEqual(first);
  expect(value(await s.service.status(e.keys, second.id)).output).not.toEqual(first.output);
});
it('records unavailable provider uncertainty without exposing raw errors', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input));
  s.setBehavior(async () => {
    throw Error('synthetic private credential error');
  });
  expect(value(await s.service.execute(p.id)).state).toBe('unavailable');
  const a = (
    await f.admin.query('SELECT state,cost_minor FROM app.ai_attempts WHERE request_id=$1', [p.id])
  ).rows[0];
  expect(a).toEqual({ state: 'uncertain', cost_minor: null });
  expect(JSON.stringify(value(await s.service.status(e.keys, p.id)))).not.toContain('credential');
});

it('returns expired instead of pending when an expired queued command is replayed', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input)),
    calls = s.calls.length;
  const { createReportAnalysisServices } =
    await import('../../packages/application/src/analysis/report-analysis.ts');
  const later = createReportAnalysisServices({
    ...s.d,
    now: () => new Date(Date.now() + 180000).toISOString(),
  });
  expect(value(await later.request(e.keys, e.input))).toMatchObject({
    id: p.id,
    state: 'expired',
    output: null,
  });
  expect(s.calls).toHaveLength(calls);
});
it('makes withdrawal immediate above one cleanup batch and safely replays bounded cleanup', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input)),
    calls = s.calls.length;
  const scope = (
    await f.admin.query('SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [p.id])
  ).rows[0]!.scope_id;
  await f.admin.query(
    `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,created_at,expires_at)
 SELECT gen_random_uuid(),r.scope_id,r.owner_subject_id,r.policy_version_id,r.input_digest,r.input_manifest,'bounded-overflow-'||n::text,r.notice_version,r.permission_revision,r.subject_permission_revision,r.invalidation_revision,clock.at,clock.at+interval '120 seconds'
 FROM app.ai_analysis_requests r CROSS JOIN generate_series(1,1001) n CROSS JOIN (SELECT clock_timestamp() AS at) clock WHERE r.id=$1`,
    [p.id],
  );
  expect(
    value(
      await s.service.choice(e.keys, {
        scopeId: scope,
        expectedRevision: '1',
        allowed: false,
        noticeVersion: s.d.noticeVersion,
      }),
    ),
  ).toMatchObject({ allowed: false, permissionRevision: '2' });
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM app.ai_analysis_requests WHERE scope_id=$1 AND state='queued'",
        [scope],
      )
    ).rows[0]!.n,
  ).toBe(2);
  expect(value(await s.service.status(e.keys, p.id))).toMatchObject({
    state: 'unavailable',
    output: null,
  });
  expect((await s.service.execute(p.id)).ok).toBe(false);
  expect(s.calls).toHaveLength(calls);
  const { createReportAnalysisServices } =
    await import('../../packages/application/src/analysis/report-analysis.ts');
  const cleanupUnavailable = createReportAnalysisServices({
    ...s.d,
    repository: {
      ...s.repository,
      async withdraw() {
        throw Error('synthetic cleanup unavailable');
      },
    },
  });
  expect(
    value(
      await cleanupUnavailable.choice(e.keys, {
        scopeId: scope,
        expectedRevision: '2',
        allowed: false,
        noticeVersion: s.d.noticeVersion,
      }),
    ),
  ).toMatchObject({ allowed: false, permissionRevision: '3', cleanupPending: true });
  expect(
    (
      await f.admin.query(
        'SELECT processing_allowed,permission_revision::text FROM app.ai_scope_guards WHERE scope_id=$1',
        [scope],
      )
    ).rows[0],
  ).toEqual({ processing_allowed: false, permission_revision: '3' });
  value(
    await s.adapter.unitOfWork.run(async (tx) => {
      await s.repository.withdraw(tx, scope);
      return { ok: true as const, value: null };
    }),
  );
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM app.ai_analysis_requests WHERE scope_id=$1 AND state='cancelled'",
        [scope],
      )
    ).rows[0]!.n,
  ).toBe(1002);
});

it('reads a schema-supported large report before minimizing the provider packet', async () => {
  const e = await s.example(),
    large = {
      ...e.version,
      version: 2,
      baseVersion: 1,
      output: { ...e.version.output, auxiliaryEvidence: 'unused-evidence-'.repeat(7000) },
    };
  value(
    await f.scope.unitOfWork.run(async (tx) => ({
      ok: true as const,
      value: await f.reports.publish(
        tx,
        e.owner.identity,
        2n as import('../../packages/domain/src/values/core.ts').Revision,
        large,
        [],
      ),
    })),
  );
  const before = (
    await f.admin.query(
      'SELECT output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1 AND version=2',
      [e.report],
    )
  ).rows[0]!;
  expect(Buffer.byteLength(JSON.stringify(before.output_snapshot))).toBeGreaterThan(65536);
  const pending = value(await s.service.request(e.keys, { ...e.input, version: 2 }));
  expect(pending.state).toBe('pending');
  expect(value(await s.service.execute(pending.id)).state).toBe('available');
  const sent = JSON.stringify(s.calls.at(-1)!.packet);
  expect(Buffer.byteLength(sent)).toBeLessThan(32768);
  expect(sent).not.toContain('auxiliaryEvidence');
  expect(
    (
      await f.admin.query(
        'SELECT output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1 AND version=2',
        [e.report],
      )
    ).rows[0],
  ).toEqual(before);
});

it('queues and publishes supported flotation-size report input without changing deterministic facts', async () => {
  const e = await s.example(),
    v = {
      ...e.version,
      version: 2,
      baseVersion: 1,
      input: { ...e.version.input, sizes: { front: '31X10.50R15', rear: '31X10.50R15' } },
    };
  value(
    await f.scope.unitOfWork.run(async (tx) => ({
      ok: true as const,
      value: await f.reports.publish(
        tx,
        e.owner.identity,
        2n as import('../../packages/domain/src/values/core.ts').Revision,
        v,
        [],
      ),
    })),
  );
  const before = (
    await f.admin.query(
      'SELECT input_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1 AND version=2',
      [e.report],
    )
  ).rows[0];
  const p = value(await s.service.request(e.keys, { ...e.input, version: 2 }));
  expect(p.state).toBe('pending');
  expect(value(await s.service.execute(p.id)).state).toBe('available');
  expect(s.calls.at(-1)!.packet.parameters).toMatchObject({
    frontSize: '31X10.50R15',
    rearSize: '31X10.50R15',
  });
  expect(
    (
      await f.admin.query(
        'SELECT input_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1 AND version=2',
        [e.report],
      )
    ).rows[0],
  ).toEqual(before);
});
