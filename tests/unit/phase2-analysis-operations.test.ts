import { it, expect, vi } from 'vitest';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { createAnalysisOperationsService } from '../../packages/application/src/analysis/analysis-operations.ts';
const staff = '11111111-1111-4111-8111-111111111111',
  target = '22222222-2222-4222-8222-222222222222',
  command = '33333333-3333-4333-8333-333333333333';
function fixture() {
  let clock = Date.parse('2026-11-08T10:00:00.000Z');
  const principal = {
    subject: 'synthetic-operator',
    emailVerified: true,
    emailDomain: 'example.invalid',
    mfaAt: '2026-11-08T10:00:00.000Z',
    expiresAt: '2026-11-08T10:30:00.000Z',
    staffId: staff,
  };
  const receipt = {
    id: command,
    operation: 'resume',
    target,
    state: 'executing',
    createdAt: '2026-11-08T10:00:00.000Z',
    finishedAt: null,
  };
  const authorize = vi
      .fn<(tx: unknown, actor: unknown, subject: unknown, p: string) => Promise<boolean>>()
      .mockResolvedValue(true),
    snapshot = vi.fn(async () => ({ ai: null, photo: null })),
    claim = vi.fn(async () => ({ created: true, receipt })),
    finish = vi.fn(async (_t: unknown, _id: unknown, _actor: unknown, state: string) => ({
      ...receipt,
      state,
      finishedAt: principal.mfaAt,
    })),
    read = vi.fn(async () => ({ ...receipt, state: 'succeeded', finishedAt: principal.mfaAt })),
    disable = vi.fn(async () => true),
    work = vi.fn(async () => 'report_analysis'),
    execute = vi.fn(async () => ok({ output: 'PRIVATE-MODEL-TEXT' })),
    verify = vi.fn(async () => ok(principal));
  const d = {
    uow: { run: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
    authority: { verify },
    clock: { now: () => clock },
    repository: { authorize, snapshot, claim, finish, receipt: read, disable, work },
    digest: () => 'a'.repeat(64),
    execute,
  } as unknown as Parameters<typeof createAnalysisOperationsService>[0];
  return {
    d,
    service: createAnalysisOperationsService(d),
    advance: () => (clock += 300001),
    authorize,
    snapshot,
    claim,
    finish,
    read,
    disable,
    work,
    execute,
    verify,
  };
}
it('authorizes current capabilities and bounded UTC metrics without dispatch', async () => {
  const f = fixture();
  expect(await f.service.read('handle', '2026-11-08')).toMatchObject({
    ok: true,
    value: {
      day: '2026-11-08',
      capabilities: { aiObserve: true, aiControl: true, photoObserve: true },
      data: { ai: null, photo: null },
    },
  });
  expect(f.snapshot).toHaveBeenCalledWith(
    expect.anything(),
    '2026-11-08T00:00:00.000Z',
    '2026-11-09T00:00:00.000Z',
    { ai: true, photo: true },
  );
  expect(f.execute).not.toHaveBeenCalled();
});
it('does not return model output from a reviewed worker invocation', async () => {
  const f = fixture(),
    r = await f.service.resume('handle', { id: command, request: target });
  expect(r).toMatchObject({ ok: true, value: { state: 'succeeded' } });
  expect(JSON.stringify(r)).not.toContain('PRIVATE-MODEL-TEXT');
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('blocks current-role withdrawal before reads, commands and worker dispatch', async () => {
  const f = fixture();
  f.authorize.mockResolvedValue(false);
  expect((await f.service.read('handle', '2026-11-08')).ok).toBe(false);
  expect((await f.service.resume('handle', { id: command, request: target })).ok).toBe(false);
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
it('offers photo-only metrics without opening AI metrics or controls', async () => {
  const f = fixture();
  f.authorize.mockImplementation(
    async (_tx: unknown, _actor: unknown, _subject: unknown, p: string) => p === 'photo.observe',
  );
  expect(await f.service.read('handle', '2026-11-08')).toMatchObject({
    ok: true,
    value: { capabilities: { aiObserve: false, aiControl: false, photoObserve: true } },
  });
  expect(f.snapshot).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
    ai: false,
    photo: true,
  });
});
it('refuses stale MFA before SQL or after an asynchronous read', async () => {
  const f = fixture();
  f.advance();
  expect((await f.service.session('handle')).ok).toBe(false);
  expect(f.authorize).not.toHaveBeenCalled();
  const g = fixture();
  g.snapshot.mockImplementation(async () => {
    g.advance();
    return { ai: null, photo: null };
  });
  expect((await g.service.read('handle', '2026-11-08')).ok).toBe(false);
});
it.each(['2026-02-31', '2026-11-09', 'bad'])(
  'rejects an invalid or future UTC day %s',
  async (day) => {
    const f = fixture();
    expect((await f.service.read('handle', day)).ok).toBe(false);
    expect(f.snapshot).not.toHaveBeenCalled();
  },
);
it('does not replay an existing executing or terminal journal record', async () => {
  const f = fixture();
  f.claim.mockResolvedValue({
    created: false,
    receipt: {
      id: command,
      operation: 'resume',
      target,
      state: 'executing',
      createdAt: '2026-11-08T10:00:00.000Z',
      finishedAt: null,
    },
  });
  expect(await f.service.resume('handle', { id: command, request: target })).toMatchObject({
    ok: true,
    value: { state: 'executing' },
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it('records ineligible work without resetting failed or uncertain requests', async () => {
  const f = fixture();
  f.work.mockResolvedValue(null as never);
  expect(await f.service.resume('handle', { id: command, request: target })).toMatchObject({
    ok: true,
    value: { state: 'refused' },
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it('records an unknown worker result and never retries it automatically', async () => {
  const f = fixture();
  f.execute.mockResolvedValue(fail(failure('commit_unknown')) as never);
  await f.service.resume('handle', { id: command, request: target });
  expect(f.finish).toHaveBeenCalledWith(expect.anything(), command, staff, 'unknown');
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('only disables the exact observed policy fingerprint and records stale CAS refusal', async () => {
  const f = fixture();
  f.disable.mockResolvedValue(false);
  expect(
    await f.service.disable('handle', { id: command, policy: target, fingerprint: 'b'.repeat(64) }),
  ).toMatchObject({ ok: true, value: { state: 'refused' } });
  expect(f.disable).toHaveBeenCalledWith(expect.anything(), target, 'b'.repeat(64));
  expect(f.execute).not.toHaveBeenCalled();
});
it('reauthorizes durable approval before invoking the worker and completes refusal after role withdrawal', async () => {
  const f = fixture();
  f.authorize.mockResolvedValueOnce(true).mockResolvedValue(false);
  expect((await f.service.resume('handle', { id: command, request: target })).ok).toBe(false);
  expect(f.claim).toHaveBeenCalledTimes(1);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.finish).toHaveBeenCalledWith(expect.anything(), command, staff, 'refused');
});
it('keeps a thrown worker outcome unknown without resetting work or dispatching again', async () => {
  const f = fixture();
  f.execute.mockRejectedValue(Error('private provider diagnostic'));
  const result = await f.service.resume('handle', { id: command, request: target });
  expect(JSON.stringify(result)).not.toContain('private provider diagnostic');
  expect(f.finish).toHaveBeenCalledWith(expect.anything(), command, staff, 'unknown');
  expect(f.execute).toHaveBeenCalledTimes(1);
});
