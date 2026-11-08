import { expect, it } from 'vitest';
import {
  receiveOperationReceipt,
  type OperationReceiptState,
} from '../../apps/web/src/phase2/operations/receipt-state.ts';
const receipt = (id: string, state: 'executing' | 'unknown' | 'succeeded' | 'refused') => ({
  id,
  state,
  operation: 'resume' as const,
  target: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-11-08T00:00:00.000Z',
  finishedAt: state === 'executing' ? null : '2026-11-08T00:01:00.000Z',
});
const empty = (): OperationReceiptState => ({ receipt: null, held: null });
it.each(['succeeded', 'refused'] as const)(
  'displays a known %s receipt without imposing an uncertainty hold',
  (state) => {
    const r = receipt('11111111-1111-4111-8111-111111111111', state);
    expect(receiveOperationReceipt(empty(), r)).toEqual({ receipt: r, held: null });
  },
);
it.each(['executing', 'unknown'] as const)(
  'keeps the original %s hold across unrelated receipt reads until disconnect resets the workspace',
  (state) => {
    const original = receipt('11111111-1111-4111-8111-111111111111', state),
      other = receipt('33333333-3333-4333-8333-333333333333', 'succeeded');
    const held = receiveOperationReceipt(empty(), original),
      later = receiveOperationReceipt(held, other);
    expect(held.held).toBe(original.id);
    expect(later.held).toBe(original.id);
    expect(later.receipt).toEqual(other);
    expect(held.receipt).toEqual(original);
    expect(empty().held).toBeNull();
  },
);
