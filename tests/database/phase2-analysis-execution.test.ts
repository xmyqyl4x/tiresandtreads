import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { executionFixture } from '../fixtures/phase2/analysis-execution.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { createAnalysisExecutionSupport } from '../../packages/db/src/repositories/analysis-execution.ts';
import { createReportAnalysisServices } from '../../packages/application/src/analysis/report-analysis.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
let f: Awaited<ReturnType<typeof executionFixture>>,
  s: Awaited<ReturnType<typeof composeReportAnalysis>>,
  support: ReturnType<typeof createAnalysisExecutionSupport>,
  service: ReturnType<typeof createReportAnalysisServices>;
beforeAll(async () => {
  f = await executionFixture();
  s = await composeReportAnalysis(f);
  support = createAnalysisExecutionSupport(s.adapter);
  service = createReportAnalysisServices({ ...s.d, ...support });
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
afterEach(() => s?.resetBehavior());
async function example(limits = { daily: 100000, hourly: 100000, owner: 1000 }) {
  const e = await s.example();
  await f.admin.query(
    `INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,$2,$3,$4,2,'active',$5 FROM app.ai_policy_versions WHERE id=$1`,
    [e.policy, limits.daily, limits.hourly, limits.owner, f.staff],
  );
  return e;
}
it('applies the exact50 opt-in prefix and eight forced-RLS support tables only', async () => {
  expect(f.executionApplied).toBe(1);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(50);
});
it('coalesces a concurrent exact miss and serves a warm hit with command receipts and no second provider call', async () => {
  const e = await example(),
    calls = s.calls.length;
  const [a, b] = await Promise.all([
    service.request(e.keys, e.input),
    service.request(e.keys, { ...e.input, key: 'synthetic-' + uuid('command') }),
  ]);
  const p = value(a);
  expect(value(b).id).toBe(p.id);
  expect(value(await service.execute(p.id)).state).toBe('available');
  const hit = value(
    await service.request(e.keys, { ...e.input, key: 'synthetic-' + uuid('command') }),
  );
  expect(hit).toMatchObject({ id: p.id, state: 'available' });
  expect(s.calls.length - calls).toBe(1);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM app.ai_report_commands WHERE request_id=$1',
        [p.id],
      )
    ).rows[0]!.n,
  ).toBe(3);
  const held = (
    await f.admin.query(
      'SELECT state,reserved_minor,settled_minor FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
      [p.id],
    )
  ).rows;
  expect(held).toHaveLength(3);
  expect(
    held.every((r) => r.state === 'settled' && r.reserved_minor === '7' && r.settled_minor === '5'),
  ).toBe(true);
});
it('rejects changed-body command replays before returning another matching request', async () => {
  const e = await example();
  value(await service.request(e.keys, e.input));
  expect((await service.request(e.keys, { ...e.input, version: 2 })).ok).toBe(false);
});
it('never reuses a private exact packet across owners', async () => {
  const a = await example(),
    b = await s.example(),
    p = value(await service.request(a.keys, a.input)),
    other = value(await service.request(b.keys, { ...b.input, policyId: a.policy }));
  expect(other.id).not.toBe(p.id);
  expect((await service.status(b.keys, p.id)).ok).toBe(false);
});
it('serializes a conservative daily budget across different owners', async () => {
  const a = await example({ daily: 10, hourly: 100, owner: 100 }),
    b = await s.example(),
    p = value(await service.request(a.keys, a.input)),
    q = value(await service.request(b.keys, { ...b.input, policyId: a.policy })),
    calls = s.calls.length;
  const r = await Promise.all([service.execute(p.id), service.execute(q.id)]);
  expect(r.filter((x) => x.ok && x.value.state === 'available')).toHaveLength(1);
  expect(s.calls.length - calls).toBe(1);
  expect(
    (
      await f.admin.query(
        'SELECT reserved_minor,spent_minor FROM app.ai_budget_windows WHERE policy_version_id=$1 AND policy_key=$2',
        [a.policy, 'p2:' + a.policy + ':day'],
      )
    ).rows[0],
  ).toEqual({ reserved_minor: '0', spent_minor: '5' });
});
it('refuses dispatch without a reviewed price plan and keeps the core report intact', async () => {
  const e = await s.example(),
    p = value(await service.request(e.keys, e.input)),
    calls = s.calls.length;
  value(await service.execute(p.id));
  expect(value(await service.status(e.keys, p.id))).toMatchObject({
    state: 'unavailable',
    output: null,
  });
  expect(s.calls).toHaveLength(calls);
});
it('charges all three bounded attempts and publishes only the final validated attempt', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input));
  let n = 0;
  s.setBehavior(async (input) => ({
    ...(await s.defaultBehavior(input)),
    state: ++n < 3 ? 'incomplete' : 'complete',
  }));
  expect(value(await service.execute(p.id)).state).toBe('deferred');
  const released = value(
    await s.adapter.unitOfWork.run(
      async (tx) =>
        ({
          ok: true,
          value: (
            await s.adapter.query(tx, 'SELECT app.ai_release_terminal_lease($1) AS changed', [p.id])
          ).rows[0]!.changed,
        }) as const,
    ),
  );
  expect(released).toBe(false);
  expect(
    (
      await f.admin.query(
        'SELECT e.state,e.lease_holder IS NOT NULL AS held FROM app.ai_reuse_entries e JOIN app.ai_analysis_requests r ON r.scope_id=e.scope_id AND r.input_digest=e.cache_key WHERE r.id=$1',
        [p.id],
      )
    ).rows[0],
  ).toEqual({ state: 'leased', held: true });
  expect(value(await service.execute(p.id)).state).toBe('deferred');
  expect(n).toBe(1);
  await new Promise((r) => setTimeout(r, 2100));
  expect(value(await service.execute(p.id)).state).toBe('deferred');
  await new Promise((r) => setTimeout(r, 4100));
  expect(value(await service.execute(p.id)).state).toBe('available');
  expect(n).toBe(3);
  expect(
    (
      await f.admin.query(
        'SELECT attempt,state,cost_minor FROM app.ai_attempts WHERE request_id=$1 ORDER BY attempt',
        [p.id],
      )
    ).rows,
  ).toEqual([
    { attempt: 1, state: 'failed', cost_minor: '5' },
    { attempt: 2, state: 'failed', cost_minor: '5' },
    { attempt: 3, state: 'succeeded', cost_minor: '5' },
  ]);
  expect(
    (
      await f.admin.query(
        'SELECT a.attempt FROM app.ai_artifacts x JOIN app.ai_attempts a ON a.id=x.attempt_id WHERE x.request_id=$1',
        [p.id],
      )
    ).rows[0]!.attempt,
  ).toBe(3);
}, 25000);
it('stops after three incomplete attempts instead of retrying indefinitely', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input)),
    calls = s.calls.length;
  s.setBehavior(async (input) => ({ ...(await s.defaultBehavior(input)), state: 'incomplete' }));
  value(await service.execute(p.id));
  await new Promise((r) => setTimeout(r, 2100));
  value(await service.execute(p.id));
  await new Promise((r) => setTimeout(r, 4100));
  expect(value(await service.execute(p.id)).state).toBe('unavailable');
  value(await service.execute(p.id));
  expect(s.calls.length - calls).toBe(3);
}, 25000);
it('retains unknown charge reservations and does not blindly retry provider failures', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input)),
    calls = s.calls.length;
  s.setBehavior(async () => {
    throw Error('synthetic provider ambiguity');
  });
  expect(value(await service.execute(p.id)).state).toBe('unavailable');
  expect(value(await service.execute(p.id)).state).toBe('deferred');
  expect(s.calls.length - calls).toBe(1);
  expect(
    (
      await f.admin.query(
        'SELECT state,reserved_minor,settled_minor FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
        [p.id],
      )
    ).rows.every(
      (r) => r.state === 'uncertain' && r.reserved_minor === '7' && r.settled_minor === null,
    ),
  ).toBe(true);
});
it('opens the shared provider circuit after three ambiguous failures without losing reservations', async () => {
  const first = await example(),
    calls = s.calls.length;
  s.setBehavior(async () => {
    throw Error('synthetic network uncertainty');
  });
  for (let n = 0; n < 4; n++) {
    const e = n === 0 ? first : await s.example(),
      p = value(await service.request(e.keys, { ...e.input, policyId: first.policy }));
    value(await service.execute(p.id));
    expect(value(await service.status(e.keys, p.id)).state).toBe('unavailable');
  }
  expect(s.calls.length - calls).toBe(3);
  expect(
    (
      await f.admin.query(
        'SELECT state,failures FROM app.ai_provider_circuits WHERE policy_id=$1',
        [first.policy],
      )
    ).rows[0],
  ).toEqual({ state: 'open', failures: 3 });
});
it('blocks a price plan after a charge overrun and cannot silently change its approved limits', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input));
  s.setBehavior(async (input) => ({ ...(await s.defaultBehavior(input)), costMinor: 8n }));
  expect(value(await service.execute(p.id)).state).toBe('unavailable');
  expect(
    (await f.admin.query('SELECT status FROM app.ai_cost_plans WHERE policy_id=$1', [e.policy]))
      .rows[0]!.status,
  ).toBe('blocked');
  await expect(
    f.admin.query("UPDATE app.ai_cost_plans SET status='active' WHERE policy_id=$1", [e.policy]),
  ).rejects.toThrow();
  await expect(
    f.admin.query('UPDATE app.ai_cost_plans SET daily_limit=daily_limit+1 WHERE policy_id=$1', [
      e.policy,
    ]),
  ).rejects.toThrow();
});

it('allows a single half-open probe and closes it only after current-generation success', async () => {
  const a = await example(),
    b = await s.example();
  await f.admin.query(
    "INSERT INTO app.ai_provider_circuits(policy_id,generation,state,failures,open_until) VALUES($1,2,'open',3,clock_timestamp()-interval '1 second')",
    [a.policy],
  );
  const p = value(await service.request(a.keys, a.input)),
    other = value(await service.request(b.keys, { ...b.input, policyId: a.policy }));
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((r) => {
      release = r;
    }),
    entered = new Promise<void>((r) => {
      started = r;
    });
  s.setBehavior(async (input) => {
    started();
    await waiting;
    return s.defaultBehavior(input);
  });
  const running = service.execute(p.id);
  await entered;
  try {
    value(await service.execute(other.id));
    expect(value(await service.status(b.keys, other.id)).state).toBe('unavailable');
  } finally {
    release();
  }
  expect(value(await running).state).toBe('available');
  expect(
    (
      await f.admin.query(
        'SELECT state,failures FROM app.ai_provider_circuits WHERE policy_id=$1',
        [a.policy],
      )
    ).rows[0],
  ).toEqual({ state: 'closed', failures: 0 });
});
it('cannot let an older success reset a newer open circuit generation', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input));
  s.setBehavior(async (input) => {
    await f.admin.query(
      "UPDATE app.ai_provider_circuits SET state='open',failures=3,generation=generation+1,open_until=clock_timestamp()+interval '60 seconds',probe_until=NULL WHERE policy_id=$1",
      [e.policy],
    );
    return s.defaultBehavior(input);
  });
  expect(value(await service.execute(p.id)).state).toBe('available');
  expect(
    (
      await f.admin.query(
        'SELECT state,failures FROM app.ai_provider_circuits WHERE policy_id=$1',
        [e.policy],
      )
    ).rows[0],
  ).toEqual({ state: 'open', failures: 3 });
});
it('recovers an expired synthetic dispatch after service recomposition without another provider call', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input)),
    calls = s.calls.length;
  const interrupted = createReportAnalysisServices({
    ...s.d,
    ...support,
    provider: {
      async analyze() {
        throw Error('synthetic interruption');
      },
    },
    requests: {
      ...s.d.requests,
      async finish() {
        throw Error('synthetic lost persistence');
      },
    },
  });
  expect((await interrupted.execute(p.id)).ok).toBe(false);
  // Owned synthetic timestamp control, not a claim that30 seconds elapsed or that provider cancellation succeeded.
  await f.admin.query('ALTER TABLE app.ai_execution_states DISABLE TRIGGER ai_execution_identity');
  try {
    await f.admin.query(
      "UPDATE app.ai_execution_states SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
      [p.id],
    );
  } finally {
    await f.admin.query('ALTER TABLE app.ai_execution_states ENABLE TRIGGER ai_execution_identity');
  }
  const recomposed = createReportAnalysisServices({ ...s.d, ...support });
  value(await recomposed.execute(p.id));
  expect(s.calls).toHaveLength(calls);
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.id])).rows[0]!
      .state,
  ).toBe('uncertain');
  expect(
    (
      await f.admin.query(
        'SELECT state FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
        [p.id],
      )
    ).rows.every((r) => r.state === 'uncertain'),
  ).toBe(true);
});
it('blocks output and future dispatch when a provider violates its evaluated token ceiling', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input));
  s.setBehavior(async (input) => ({ ...(await s.defaultBehavior(input)), outputTokens: 4097n }));
  expect(value(await service.execute(p.id)).state).toBe('unavailable');
  expect(
    (await f.admin.query('SELECT status FROM app.ai_cost_plans WHERE policy_id=$1', [e.policy]))
      .rows[0]!.status,
  ).toBe('blocked');
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        p.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
});

it('refuses uncertainty recovery on queued work without a recorded expired dispatch', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input));
  const result = await s.adapter.unitOfWork.run(async (tx) => {
    await s.adapter.query(tx, 'SELECT app.ai_recover_expired_dispatch($1)', [p.id]);
    return { ok: true, value: null } as const;
  });
  expect(result.ok).toBe(false);
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.id])).rows[0]!
      .state,
  ).toBe('queued');
});

it.each(['complete', 'refused', 'unavailable'] as const)(
  'recovers interruption after %s charge settlement without changing its measured attempt or dispatching again',
  async (state) => {
    const e = await example(),
      p = value(await service.request(e.keys, e.input));
    const interrupted = createReportAnalysisServices({
      ...s.d,
      ...support,
      runtime: {
        ...support.runtime,
        async finish() {
          throw Error('synthetic interruption after committed charge');
        },
      },
    });
    s.setBehavior(async (input) =>
      state === 'unavailable'
        ? Promise.reject(Error('synthetic unknown charge'))
        : { ...(await s.defaultBehavior(input)), state },
    );
    expect((await interrupted.execute(p.id)).ok).toBe(false);
    const before = (
      await f.admin.query(
        'SELECT state,cost_minor,cost_status,provider_request_id,input_tokens,output_tokens,finished_at FROM app.ai_attempts WHERE request_id=$1',
        [p.id],
      )
    ).rows;
    expect(before).toHaveLength(1);
    expect(before[0]!.state).toBe(
      state === 'complete' ? 'succeeded' : state === 'refused' ? 'failed' : 'uncertain',
    );
    const calls = s.calls.length;
    await f.admin.query(
      'ALTER TABLE app.ai_execution_states DISABLE TRIGGER ai_execution_identity',
    );
    try {
      await f.admin.query(
        "UPDATE app.ai_execution_states SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
        [p.id],
      );
    } finally {
      await f.admin.query(
        'ALTER TABLE app.ai_execution_states ENABLE TRIGGER ai_execution_identity',
      );
    }
    value(await service.execute(p.id));
    expect(s.calls.length).toBe(calls);
    expect(
      (
        await f.admin.query(
          'SELECT e.state,e.lease_holder FROM app.ai_reuse_entries e JOIN app.ai_analysis_requests r ON r.scope_id=e.scope_id AND r.input_digest=e.cache_key WHERE r.id=$1',
          [p.id],
        )
      ).rows[0],
    ).toEqual({ state: 'invalidated', lease_holder: null });
    expect(
      (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.id]))
        .rows[0]!.state,
    ).toBe('uncertain');
    expect(
      (
        await f.admin.query(
          'SELECT state,cost_minor,cost_status,provider_request_id,input_tokens,output_tokens,finished_at FROM app.ai_attempts WHERE request_id=$1',
          [p.id],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await f.admin.query(
          'SELECT state FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE request_id=$1)',
          [p.id],
        )
      ).rows.every((r) => r.state === (state === 'unavailable' ? 'uncertain' : 'settled')),
    ).toBe(true);
  },
);

it.each(['complete', 'refused', 'unavailable'] as const)(
  'recovers a running request after %s execution finalization without redispatch or charge changes',
  async (state) => {
    const e = await example(),
      p = value(await service.request(e.keys, e.input));
    let finalized = false;
    const interrupted = createReportAnalysisServices({
      ...s.d,
      ...support,
      runtime: {
        ...support.runtime,
        async finish(tx, input) {
          const result = await support.runtime.finish(tx, input);
          finalized = true;
          return result;
        },
      },
      repository: {
        ...s.d.repository,
        async current(tx, work) {
          if (finalized) throw Error('synthetic interruption after execution finalization');
          return s.d.repository.current(tx, work);
        },
      },
    });
    s.setBehavior(async (input) =>
      state === 'unavailable'
        ? Promise.reject(Error('synthetic unknown charge'))
        : { ...(await s.defaultBehavior(input)), state },
    );
    expect((await interrupted.execute(p.id)).ok).toBe(false);
    const before = (
      await f.admin.query(
        'SELECT state,cost_minor,cost_status,provider_request_id,input_tokens,output_tokens,finished_at FROM app.ai_attempts WHERE request_id=$1',
        [p.id],
      )
    ).rows;
    expect(
      (await f.admin.query('SELECT state FROM app.ai_execution_states WHERE request_id=$1', [p.id]))
        .rows[0]!.state,
    ).toBe(state === 'complete' ? 'complete' : state === 'refused' ? 'failed' : 'uncertain');
    const calls = s.calls.length;
    await f.admin.query(
      'ALTER TABLE app.ai_execution_states DISABLE TRIGGER ai_execution_identity',
    );
    try {
      await f.admin.query(
        "UPDATE app.ai_execution_states SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
        [p.id],
      );
    } finally {
      await f.admin.query(
        'ALTER TABLE app.ai_execution_states ENABLE TRIGGER ai_execution_identity',
      );
    }
    value(await service.execute(p.id));
    expect(s.calls.length).toBe(calls);
    expect(
      (
        await f.admin.query(
          'SELECT e.state,e.lease_holder FROM app.ai_reuse_entries e JOIN app.ai_analysis_requests r ON r.scope_id=e.scope_id AND r.input_digest=e.cache_key WHERE r.id=$1',
          [p.id],
        )
      ).rows[0],
    ).toEqual({ state: 'invalidated', lease_holder: null });
    expect(
      (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.id]))
        .rows[0]!.state,
    ).toBe(state === 'refused' ? 'failed' : 'uncertain');
    expect(
      (
        await f.admin.query(
          'SELECT state,cost_minor,cost_status,provider_request_id,input_tokens,output_tokens,finished_at FROM app.ai_attempts WHERE request_id=$1',
          [p.id],
        )
      ).rows,
    ).toEqual(before);
  },
);

it('releases the recorded lease when admission stops a due known-cost retry', async () => {
  const e = await example(),
    p = value(await service.request(e.keys, e.input));
  s.setBehavior(async (input) => ({ ...(await s.defaultBehavior(input)), state: 'incomplete' }));
  expect(value(await service.execute(p.id)).state).toBe('deferred');
  const calls = s.calls.length;
  await f.admin.query("UPDATE app.ai_cost_plans SET status='blocked' WHERE policy_id=$1", [
    e.policy,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  value(await service.execute(p.id));
  expect(s.calls.length).toBe(calls);
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.id])).rows[0]!
      .state,
  ).toBe('failed');
  expect(
    (
      await f.admin.query(
        'SELECT e.state,e.lease_holder FROM app.ai_reuse_entries e JOIN app.ai_analysis_requests r ON r.scope_id=e.scope_id AND r.input_digest=e.cache_key WHERE r.id=$1',
        [p.id],
      )
    ).rows[0],
  ).toEqual({ state: 'invalidated', lease_holder: null });
  expect(
    (await f.admin.query('SELECT cost_minor FROM app.ai_attempts WHERE request_id=$1', [p.id]))
      .rows[0]!.cost_minor,
  ).toBe('5');
}, 15000);
