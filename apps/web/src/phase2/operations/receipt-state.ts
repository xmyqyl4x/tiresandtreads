import type { operationsReceipt } from '../../../../../packages/contracts/src/phase2-operations-client.ts';
import type { z } from '../../../../../packages/contracts/src/phase2-wire.ts';
type Receipt = z.output<typeof operationsReceipt>;
export interface OperationReceiptState {
  readonly receipt: Receipt | null;
  readonly held: string | null;
}
// Reading an unrelated known receipt cannot resolve an earlier uncertain operation.
// This hold is page memory only; current server permissions and worker checks remain authority.
export function receiveOperationReceipt(
  previous: OperationReceiptState,
  receipt: Receipt,
): OperationReceiptState {
  return {
    receipt,
    held: previous.held ?? (['executing', 'unknown'].includes(receipt.state) ? receipt.id : null),
  };
}
