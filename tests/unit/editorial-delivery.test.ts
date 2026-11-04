import { it, expect, vi } from 'vitest';
import { createEditorialDelivery } from '../../packages/integrations/src/editorial-delivery.ts';
import { ok, fail, id } from '../../packages/domain/src/values/core.ts';
const actor = '12345678-1234-1234-1234-123456789abc',
  ref = { id: actor, collection: 'articles' as const, revision: 5 };
function setup() {
  const work = id('cms_work', actor);
  if (!work.ok) throw Error('fixture');
  const receipt = vi.fn(async () => ok(false)),
    enqueue = vi.fn(async () => ok({ id: work.value })),
    dispatch = vi.fn(async () => ok(undefined));
  return {
    receipt,
    enqueue,
    dispatch,
    deliver: createEditorialDelivery({
      publicationDelivered: receipt,
      enqueue,
      dispatch,
    } as unknown as Parameters<typeof createEditorialDelivery>[0]),
  };
}
it('confirms the exact immutable receipt before reusing a completed withdrawal', async () => {
  const f = setup();
  f.receipt.mockResolvedValue(ok(true));
  expect(await f.deliver(actor, ref, 'withdraw')).toBe(true);
  expect(f.receipt).toHaveBeenCalledWith(ref, actor, 'withdraw');
  expect(f.enqueue).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
});
it('does not treat enqueue or dispatch acknowledgements as delivery confirmation', async () => {
  const f = setup();
  expect(await f.deliver(actor, ref, 'withdraw')).toBe(false);
  expect(f.receipt).toHaveBeenCalledTimes(2);
  expect(f.enqueue).toHaveBeenCalledWith(actor, ref, 'withdraw');
});
it('confirms delivery only after the durable published receipt appears', async () => {
  const f = setup();
  f.receipt.mockResolvedValueOnce(ok(false)).mockResolvedValueOnce(ok(true));
  expect(await f.deliver(actor, ref, 'publish')).toBe(true);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
it.each(['receipt', 'enqueue', 'dispatch'] as const)(
  'fails closed when %s is unavailable',
  async (key) => {
    const f = setup();
    f[key].mockResolvedValue(fail({ code: 'unavailable' }) as never);
    await expect(f.deliver(actor, ref, 'withdraw')).rejects.toThrow('unavailable');
  },
);
