import { id, ok, fail } from '../../../domain/src/values/core.ts';
import {
  failure,
  type UnitOfWork,
  type TransactionContext,
  type ApplicationFailure,
} from '../ports/transactions.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import type { JobRepository, JobLease } from '../ports/jobs.ts';
import type { Inbox, ReliabilityRepository } from '../ports/reliability.ts';

export function createInboxDurability(deps: {
  readonly uow: UnitOfWork;
  readonly jobs: JobRepository;
  readonly reliability: ReliabilityRepository;
}) {
  const { uow, jobs, reliability } = deps;
  async function schedule(tx: TransactionContext, receipt: Inbox) {
    const resource = id('resource', receipt.id);
    if (!resource.ok) throw Error('Invalid inbox identity');
    const jobId = await jobs.register(tx, {
      type: 'inbox.process',
      businessKey: receipt.id,
      version: 1,
      resourceId: resource.value,
    });
    const event = id('event', jobId),
      aggregate = id('aggregate', receipt.id);
    if (!event.ok || !aggregate.ok) throw Error('Invalid job identity');
    await reliability.scheduled(tx, receipt.id, jobId);
    await reliability.append(tx, {
      eventId: event.value,
      aggregateId: aggregate.value,
      aggregateKind: 'job',
      type: 'tt/job.requested',
      version: 1,
      payload: { resource_id: jobId, resource_kind: 'job' },
    });
    return jobId;
  }
  return {
    // Signature validation and bounded raw-body storage occur in the owning transport before this call.
    receive(input: Parameters<ReliabilityRepository['receive']>[1]) {
      return uow.run(async (tx) => {
        const receipt = await reliability.receive(tx, input);
        const jobId = ['processed', 'quarantined'].includes(receipt.state)
          ? null
          : await schedule(tx, receipt);
        return ok({ receipt, jobId });
      });
    },
    reconcile() {
      return uow.run(async (tx) => {
        await reliability.quarantineOrphans(tx);
        const queued = [];
        for (const receipt of await reliability.unscheduled(tx))
          queued.push(await schedule(tx, receipt));
        return ok(queued);
      });
    },
    async apply(
      tx: TransactionContext,
      lease: JobLease,
      effect: () => Promise<Result<void, ApplicationFailure>>,
    ) {
      await jobs.fence(tx, lease);
      const inboxId = id('inbox', lease.input.resourceId);
      if (!inboxId.ok || lease.input.type !== 'inbox.process' || lease.input.version !== 1)
        return fail(failure('invalid_input'));
      const receipt = await reliability.current(tx, inboxId.value, lease.id);
      if (!receipt) return fail(failure('not_found'));
      if (receipt.state === 'processed' || receipt.state === 'quarantined') return ok(undefined);
      const running = await reliability.process(tx, receipt.id, receipt.revision, 'processing');
      const applied = await effect();
      if (!applied.ok) return applied;
      await reliability.process(tx, running.id, running.revision, 'processed');
      return ok(undefined);
    },
  };
}
