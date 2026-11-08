import { it, expect, vi } from 'vitest';
import { createPhotoPresentationService } from '../../packages/application/src/analysis/photo-presentation.ts';
const person = '11111111-1111-4111-8111-111111111111',
  policy = '22222222-2222-4222-8222-222222222222',
  keys = [{ keyVersion: 'v1', digest: 'a'.repeat(64) }];
function setup() {
  const owner = vi.fn(async () => ({ subjectId: person })),
    available = vi.fn(async () => true),
    list = vi.fn(async () => ({ items: [], next: null }));
  const d = {
    uow: { run: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
    repository: { owner },
    presentation: { available, list },
    policyId: policy,
    noticeVersion: 'photo-v1',
    now: () => '2026-11-08T00:00:00.000Z',
  } as unknown as Parameters<typeof createPhotoPresentationService>[0];
  return { d, owner, available, list, service: createPhotoPresentationService(d) };
}
it('returns only the current configured notice and bounded owned metadata with no processing', async () => {
  const f = setup(),
    r = await f.service.read(keys);
  expect(r).toMatchObject({
    ok: true,
    value: {
      processing: { available: true, policyId: policy, maxBytes: 10485760, expiresAfterHours: 24 },
      items: [],
      next: null,
    },
  });
  expect(f.list).toHaveBeenCalledWith(expect.anything(), person, { limit: 25, after: null });
  expect(JSON.stringify(r)).not.toMatch(/provider|model_id|digest|grant|prompt_version/);
});
it('withholds all metadata after owner revocation', async () => {
  const f = setup();
  f.owner.mockResolvedValue(null as never);
  expect((await f.service.read(keys)).ok).toBe(false);
  expect(f.available).not.toHaveBeenCalled();
  expect(f.list).not.toHaveBeenCalled();
});
it('keeps history and manual fallback when processing is unavailable', async () => {
  const f = setup();
  f.available.mockResolvedValue(false);
  expect(await f.service.read(keys)).toMatchObject({
    ok: true,
    value: { processing: { available: false, policyId: null }, items: [] },
  });
});
it('does not select a policy when none is configured', async () => {
  const f = setup();
  f.d.policyId = null;
  expect(await f.service.read(keys)).toMatchObject({
    ok: true,
    value: { processing: { available: false, policyId: null } },
  });
  expect(f.available).not.toHaveBeenCalled();
});
it.each([
  { input: [] },
  { input: [{ keyVersion: 'v1', digest: 'bad' }] },
  { input: [keys[0]!, keys[0]!] },
])('rejects malformed credentials before I/O %j', async ({ input }) => {
  const f = setup();
  expect((await f.service.read(input as typeof keys)).ok).toBe(false);
  expect(f.owner).not.toHaveBeenCalled();
});
it('bounds pagination and returns an opaque outage', async () => {
  const f = setup();
  expect((await f.service.read(keys, 'x'.repeat(2049))).ok).toBe(false);
  expect(f.owner).not.toHaveBeenCalled();
  f.list.mockRejectedValue(Error('private database'));
  expect(await f.service.read(keys)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
});
