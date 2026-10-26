import type { createMailEventServices } from '../../application/src/services/mail-events.ts';
import { fail } from '../../domain/src/values/core.ts';
import { failure } from '../../application/src/ports/transactions.ts';
// Trusted operator entry point. It deliberately has no force-accept/new-send option.
export function runMailCommand(
  args: readonly string[],
  service: ReturnType<typeof createMailEventServices>,
) {
  if (args.length === 1 && args[0] === 'pending') return service.pending();
  if (args.length === 2) {
    if (args[0] === 'status') return service.status(args[1]);
    if (args[0] === 'replay') return service.replay(args[1]);
    if (args[0] === 'reconcile') return service.reconcile(args[1]);
  }
  return Promise.resolve(fail(failure('invalid_input')));
}
