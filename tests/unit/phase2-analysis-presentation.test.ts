import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { it, expect, vi } from 'vitest';
import { createAnalysisPresentationService } from '../../packages/application/src/analysis/analysis-presentation.ts';
const report = '11111111-1111-4111-8111-111111111111',
  policy = '22222222-2222-4222-8222-222222222222';
function setup() {
  const access = vi.fn(async () => ok({})),
    owner = vi.fn(async () => ({ subjectId: report })),
    evidence = vi.fn(async () => ({ attachmentRevision: 1n })),
    configuration = vi.fn(async () => ({
      schema: 'grounded-selection-v1',
      validator: 'grounded-validator-v1',
    })),
    activePolicy = vi.fn(async () => ({ status: 'active', task: 'report_analysis' })),
    latest = vi.fn(async () => policy as string | null),
    selection = vi.fn(async () => ({ revision: '1', attachedAt: '2026-11-08T00:00:00.000Z' }));
  const d = {
    uow: { run: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
    repository: { owner, evidence, configuration },
    access,
    scopes: { policy: activePolicy },
    presentation: { latest, selection },
    policyId: policy,
    noticeVersion: 'local-notice-v1',
    now: () => '2026-11-08T00:01:00.000Z',
  } as unknown as Parameters<typeof createAnalysisPresentationService>[0];
  return {
    service: createAnalysisPresentationService(d),
    access,
    d,
    owner,
    evidence,
    configuration,
    activePolicy,
    latest,
    selection,
  };
}
const keys = [{ keyVersion: 'v1', digest: 'a'.repeat(64) }];
it('authorizes exact historical report before exposing policy, request or attachment metadata', async () => {
  const f = setup(),
    r = await f.service.read(keys, { reportId: report, version: 2 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value).toMatchObject({
    reportId: report,
    version: 2,
    latestRequest: policy,
    selection: { revision: '1' },
    assistance: { available: true, policyId: policy, noticeVersion: 'local-notice-v1' },
  });
  expect(f.latest).toHaveBeenCalledWith(expect.anything(), report, report, 2);
  expect(JSON.stringify(r.value)).not.toMatch(/provider|model|configurationHash|digest/);
});
it.each(['owner'] as const)('withholds all metadata when %s authorization fails', async (kind) => {
  const f = setup();
  f[kind].mockResolvedValue(null as never);
  expect((await f.service.read(keys, { reportId: report, version: 1 })).ok).toBe(false);
  expect(f.latest).not.toHaveBeenCalled();
  expect(f.configuration).not.toHaveBeenCalled();
});
it.each(['retired', 'blocked', 'draft'])(
  'offers deterministic fallback for a %s policy',
  async (status) => {
    const f = setup();
    f.activePolicy.mockResolvedValue({ status, task: 'report_analysis' });
    const r = await f.service.read(keys, { reportId: report, version: 1 });
    expect(r.ok && r.value.assistance).toMatchObject({ available: false, policyId: null });
  },
);
it('does not expose an unconfigured policy or request another provider', async () => {
  const f = setup();
  f.d.policyId = null;
  const r = await f.service.read(keys, { reportId: report, version: 1 });
  expect(r.ok && r.value.assistance.available).toBe(false);
  expect(f.configuration).not.toHaveBeenCalled();
});
it.each([
  { schema: 'other', validator: 'grounded-validator-v1' },
  { schema: 'grounded-selection-v1', validator: 'other' },
  null,
])('does not advertise incompatible configuration %j', async (config) => {
  const f = setup();
  f.configuration.mockResolvedValue(config as never);
  const r = await f.service.read(keys, { reportId: report, version: 1 });
  expect(r.ok && r.value.assistance.available).toBe(false);
});
it.each([
  { reportId: report, version: 0 },
  { reportId: 'bad', version: 1 },
  { reportId: report, version: 1, policyId: policy },
])('rejects malformed or caller-selected configuration %j before I/O', async (raw) => {
  const f = setup();
  expect((await f.service.read(keys, raw)).ok).toBe(false);
  expect(f.owner).not.toHaveBeenCalled();
});
it('captures caller credentials before asynchronous authorization', async () => {
  const f = setup(),
    caller = [{ ...keys[0]! }];
  const pending = f.service.read(caller, { reportId: report, version: 1 });
  caller[0]!.digest = 'b'.repeat(64);
  expect((await pending).ok).toBe(true);
  expect((f.owner.mock.calls as unknown[][])[0]![1]).toEqual(keys);
});
it('returns an opaque failure on repository outage', async () => {
  const f = setup();
  f.latest.mockRejectedValue(Error('private SQL'));
  expect(await f.service.read(keys, { reportId: report, version: 1 })).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
});

it('withholds all metadata when the ordinary report read is denied', async () => {
  const f = setup();
  f.access.mockResolvedValue(fail(failure('not_found')) as never);
  expect((await f.service.read(keys, { reportId: report, version: 1 })).ok).toBe(false);
  expect(f.owner).not.toHaveBeenCalled();
  expect(f.latest).not.toHaveBeenCalled();
});
it('keeps a readable historical report usable when AI source evidence is no longer current', async () => {
  const f = setup();
  f.evidence.mockResolvedValue(null as never);
  const r = await f.service.read(keys, { reportId: report, version: 1 });
  expect(r.ok).toBe(true);
  expect(r.ok && r.value.assistance.available).toBe(false);
  expect(r.ok && r.value.selection).toBeNull();
  expect(f.selection).not.toHaveBeenCalled();
});
