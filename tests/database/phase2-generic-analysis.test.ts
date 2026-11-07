import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { executionFixture } from '../fixtures/phase2/analysis-execution.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import { composeGenericAnalysis } from '../fixtures/phase2/compose-generic-analysis.ts';
import { createGenericAnalysisServices } from '../../packages/application/src/analysis/generic-analysis.ts';
import { value } from '../fixtures/phase2/compose-partner-services.ts';
let f: Awaited<ReturnType<typeof executionFixture>>,
  s: Awaited<ReturnType<typeof composeReportAnalysis>>,
  g: Awaited<ReturnType<typeof composeGenericAnalysis>>;
beforeAll(async () => {
  f = await executionFixture();
  s = await composeReportAnalysis(f);
  g = await composeGenericAnalysis(f, s);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
afterEach(() => g?.reset());
it('shares only a reviewed generic template and returns exact persisted output on warm hits', async () => {
  const e = await g.example(),
    calls = g.calls.length;
  const [a, b] = await Promise.all([
    g.service.read(e.input),
    g.service.read({ ...e.input, parameters: { usage: 'commute', market: 'US' } }),
  ]);
  const p = value(a);
  expect(value(b).id).toBe(p.id);
  expect(p.state).toBe('pending');
  expect(value(await g.service.execute(p.id)).state).toBe('available');
  const hit = value(await g.service.read(e.input));
  expect(hit).toMatchObject({
    state: 'available',
    output: { kind: 'reviewed_generic_explanation', claims: [{ text: g.claim }] },
  });
  expect(g.calls.length - calls).toBe(1);
  expect(JSON.stringify(g.calls.at(-1)!.packet)).not.toMatch(
    /owner|reportId|email|region|authoritativeHash|sanitized/,
  );
});
it.each([
  { owner: 'private' },
  { region: 'private' },
  { image: 'private' },
  { usage: 'safe to drive' },
])('refuses private and freeform shared parameters %#', async (extra) => {
  const e = await g.example(),
    calls = g.calls.length;
  expect(
    (await g.service.read({ ...e.input, parameters: { ...e.input.parameters, ...extra } })).ok,
  ).toBe(false);
  expect(g.calls).toHaveLength(calls);
});
it('does not create a job or call a provider when processing a cold key is declined', async () => {
  const e = await g.example(),
    calls = g.calls.length;
  expect(value(await g.service.read({ ...e.input, allowed: false }))).toMatchObject({
    state: 'unavailable',
    id: null,
  });
  expect(g.calls).toHaveLength(calls);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM app.ai_generic_work WHERE definition_id=$1',
        [e.definition],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it('cannot promote owner-specific report policies into a shared generic scope', async () => {
  const e = await s.example();
  const d = await g.example();
  await expect(
    f.admin.query('UPDATE app.ai_generic_definitions SET policy_id=$2 WHERE id=$1', [
      d.definition,
      e.policy,
    ]),
  ).rejects.toThrow();
});
it('hides cached generic results immediately on source license withdrawal', async () => {
  const e = await g.example(),
    p = value(await g.service.read(e.input));
  value(await g.service.execute(p.id));
  await f.admin.query(
    "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{ai_processing}','false') WHERE id=$1",
    [g.license],
  );
  try {
    expect(value(await g.service.read(e.input))).toMatchObject({
      state: 'unavailable',
      output: null,
    });
  } finally {
    await f.admin.query(
      "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{ai_processing}','true') WHERE id=$1",
      [g.license],
    );
  }
});
it('refuses obsolete reviewed definitions after a newer review and never reactivates a retired one', async () => {
  const old = await g.example(),
    p = value(await g.service.read(old.input));
  value(await g.service.execute(p.id));
  const next = await g.example(old.fact);
  expect(value(await g.service.read(old.input)).state).toBe('unavailable');
  expect(value(await g.service.read(next.input)).state).toBe('pending');
  await f.admin.query("UPDATE app.ai_generic_definitions SET status='retired' WHERE id=$1", [
    next.definition,
  ]);
  await expect(
    f.admin.query("UPDATE app.ai_generic_definitions SET status='reviewed' WHERE id=$1", [
      next.definition,
    ]),
  ).rejects.toThrow();
  expect(value(await g.service.read(old.input)).state).toBe('unavailable');
});
it('rejects invented generic facts and retains the deterministic reviewed library path', async () => {
  const e = await g.example(),
    p = value(await g.service.read(e.input));
  g.setBehavior(async (input) => ({
    ...(await g.defaultBehavior(input)),
    output: { schema: 1, factIds: ['invented'], questions: [] },
  }));
  expect(value(await g.service.execute(p.id)).state).toBe('unavailable');
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_artifacts WHERE request_id=$1', [
        p.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
});
it('soft-refreshes popular shared output once per hour while valid old output remains readable', async () => {
  const e = await g.example(),
    service = createGenericAnalysisServices({ ...g.deps, validitySeconds: 30 }),
    p = value(await service.read(e.input));
  value(await service.execute(p.id));
  const before = value(await service.read(e.input));
  value(await service.read(e.input));
  value(await service.read(e.input));
  await new Promise((r) => setTimeout(r, 20200));
  const [a, b] = await Promise.all([service.refreshPopular(), service.refreshPopular()]);
  expect(value(a).scheduled + value(b).scheduled).toBe(1);
  const work = [...value(a).requestIds, ...value(b).requestIds][0]!;
  expect(value(await service.read(e.input))).toEqual(before);
  expect(value(await service.execute(work)).state).toBe('available');
  expect(value(await service.read(e.input))).toMatchObject({ state: 'available', id: work });
  expect(value(await service.refreshPopular()).scheduled).toBe(0);
}, 40000);
it('never schedules private owner report work through generic maintenance', async () => {
  const e = await s.example(),
    p = value(await s.service.request(e.keys, e.input));
  value(await s.service.execute(p.id));
  const before = (await f.admin.query('SELECT count(*)::int n FROM app.ai_report_work')).rows[0]!.n;
  value(await g.service.refreshPopular());
  expect((await f.admin.query('SELECT count(*)::int n FROM app.ai_report_work')).rows[0]!.n).toBe(
    before,
  );
});

it('regenerates expired short-lived generic output within the same request time bucket', async () => {
  const e = await g.example(),
    fixed = new Date().toISOString(),
    service = createGenericAnalysisServices({ ...g.deps, validitySeconds: 10, now: () => fixed }),
    p = value(await service.read(e.input));
  value(await service.execute(p.id));
  await new Promise((resolve) => setTimeout(resolve, 6200));
  expect(value(await service.read({ ...e.input, allowed: false })).state).toBe('unavailable');
  const [a, b] = await Promise.all([service.read(e.input), service.read(e.input)]),
    next = value(a);
  expect(next.state).toBe('pending');
  expect(next.id).not.toBe(p.id);
  expect(value(b).id).toBe(next.id);
}, 20000);
it('commits bounded expiry before opening the refresh transaction and releases actual expired-row locks', async () => {
  const e = await g.example(),
    service = createGenericAnalysisServices({ ...g.deps, validitySeconds: 10 }),
    p = value(await service.read(e.input));
  value(await service.execute(p.id));
  await new Promise((resolve) => setTimeout(resolve, 6200));
  let maintenance = '';
  const checked = createGenericAnalysisServices({
    ...g.deps,
    repository: {
      ...g.repository,
      async maintain(tx) {
        maintenance = String(
          (await s.adapter.query(tx, 'SELECT txid_current() AS id')).rows[0]!.id,
        );
        await g.repository.maintain(tx);
      },
      async refresh(tx) {
        expect(
          String((await s.adapter.query(tx, 'SELECT txid_current() AS id')).rows[0]!.id),
        ).not.toBe(maintenance);
        await f.admin.query('BEGIN');
        try {
          await f.admin.query(
            'SELECT e.scope_id FROM app.ai_reuse_entries e JOIN app.ai_artifacts a ON a.id=e.artifact_id WHERE a.request_id=$1 FOR UPDATE OF e NOWAIT',
            [p.id],
          );
        } finally {
          await f.admin.query('ROLLBACK');
        }
        return g.repository.refresh(tx);
      },
    },
  });
  expect(value(await checked.refreshPopular()).scheduled).toBe(0);
}, 20000);

it('orders popular refresh definition locks before demand updates during an actual overlapping warm read', async () => {
  const e = await g.example(),
    short = createGenericAnalysisServices({ ...g.deps, validitySeconds: 30 }),
    p = value(await short.read(e.input));
  value(await short.execute(p.id));
  value(await short.read(e.input));
  value(await short.read(e.input));
  value(await short.read(e.input));
  await new Promise((resolve) => setTimeout(resolve, 20200));
  let release!: () => void, held!: () => void;
  const pause = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      held = resolve;
    });
  const reader = createGenericAnalysisServices({
    ...g.deps,
    repository: {
      ...g.repository,
      async touch(tx, scope, digest) {
        held();
        await pause;
        await g.repository.touch(tx, scope, digest);
      },
    },
  });
  const reading = reader.read(e.input);
  await entered;
  const refreshing = short.refreshPopular();
  let observed = false;
  try {
    for (let n = 0; n < 100; n++) {
      observed =
        (
          await f.admin.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid::bigint=((hashtextextended('ai.generic.definition:'||$1,0)>>32)&4294967295) AND objid::bigint=(hashtextextended('ai.generic.definition:'||$1,0)&4294967295) AND objsubid=1) AS waiting",
            [e.definition],
          )
        ).rows[0]!.waiting === true;
      if (observed) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    release();
    await Promise.allSettled([reading, refreshing]);
  }
  expect(observed).toBe(true);
  expect(value(await reading).state).toBe('available');
  expect(value(await refreshing).scheduled).toBe(1);
}, 50000);
