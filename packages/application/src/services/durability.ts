import { ok, type Result } from '../../../domain/src/values/core.ts';
import type { Id } from '../../../domain/src/values/index.ts';
import type { ApplicationFailure, TransactionContext, UnitOfWork } from '../ports/transactions.ts';
import type {
  CommandIdentity,
  CommandRepository,
  CommandResponse,
  EventPublisher,
  JobRepository,
  RelayRepository,
  Telemetry,
  JobInput,
} from '../ports/jobs.ts';

export function createDurability(deps: {
  readonly uow: UnitOfWork;
  readonly jobs: JobRepository;
  readonly relay: RelayRepository;
  readonly commands: CommandRepository;
  readonly publisher: EventPublisher;
  readonly telemetry: Telemetry;
}) {
  const { uow, jobs, relay, commands, publisher, telemetry } = deps;
  return {
    async relayOne() {
      const claimed = await uow.run(async (tx) => ok(await relay.lease(tx)));
      if (!claimed.ok || !claimed.value) return claimed;
      const lease = claimed.value;
      try {
        // Network I/O occurs strictly between two short SQL transactions.
        await publisher.publish(lease.event);
      } catch {
        const deferred = await uow.run(async (tx) => {
          await relay.fail(tx, lease);
          return ok(null);
        });
        telemetry.record('relay_deferred');
        return deferred;
      }
      const acknowledged = await uow.run(async (tx) => {
        await relay.acknowledge(tx, lease);
        return ok(null);
      });
      telemetry.record(acknowledged.ok ? 'relay_published' : 'relay_deferred');
      return acknowledged;
    },
    async runJob(
      id: Id<'job'>,
      effect: (
        tx: TransactionContext,
        input: JobInput,
      ) => Promise<Result<void, ApplicationFailure>>,
    ) {
      const claimed = await uow.run(async (tx) => ok(await jobs.lease(tx, id)));
      if (!claimed.ok || !claimed.value) return claimed;
      const lease = claimed.value;
      const result = await uow.run(async (tx) => {
        await jobs.fence(tx, lease);
        const applied = await effect(tx, lease.input);
        if (!applied.ok) return applied;
        await jobs.complete(tx, lease);
        return ok(null);
      });
      if (!result.ok)
        await uow.run(async (tx) => {
          await jobs.fail(tx, lease);
          return ok(null);
        });
      telemetry.record(result.ok ? 'job_completed' : 'job_deferred');
      return result;
    },
    async command(
      input: CommandIdentity,
      effect: (tx: TransactionContext) => Promise<CommandResponse>,
    ) {
      return uow.run(async (tx) => {
        const previous = await commands.claim(tx, input);
        if (previous) return ok(previous);
        const response = await effect(tx);
        await commands.complete(tx, input, response);
        return ok(response);
      });
    },
  };
}
