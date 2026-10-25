import { it, expect, vi } from 'vitest';
import { createDurability } from '../../packages/application/src/services/durability.ts';
import type {
  JobLease,
  JobRepository,
  RelayRepository,
  CommandRepository,
  EventPublisher,
} from '../../packages/application/src/ports/jobs.ts';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../packages/application/src/ports/transactions.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { id, revision, ok, fail } from '../../packages/domain/src/values/core.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
function identifier<K extends string>(kind: K) {
  const r = id(kind, uuid);
  if (!r.ok) throw Error('fixture');
  return r.value;
}
const tx = {} as TransactionContext;
const generation = revision('1');
if (!generation.ok) throw Error('fixture');
const job: JobLease = {
  id: identifier('job'),
  token: identifier('lease'),
  generation: generation.value,
  input: { type: 'fixture', businessKey: 'fixed', version: 1, resourceId: identifier('resource') },
};
function fixture() {
  const jobs: JobRepository = {
    register: vi.fn(),
    lease: vi.fn(async () => job),
    fence: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    reconcile: vi.fn(),
  };
  const relay: RelayRepository = {
    lease: vi.fn(async () => null),
    acknowledge: vi.fn(),
    fail: vi.fn(),
    reconcile: vi.fn(),
  };
  const commands: CommandRepository = { claim: vi.fn(async () => null), complete: vi.fn() };
  const publisher: EventPublisher = { publish: vi.fn() };
  const telemetry = { record: vi.fn() };
  const uow: UnitOfWork = {
    async run(work) {
      try {
        return await work(tx);
      } catch {
        return fail(failure('internal'));
      }
    },
  };
  return {
    jobs,
    relay,
    commands,
    publisher,
    telemetry,
    uow,
    service: createDurability({ uow, jobs, relay, commands, publisher, telemetry }),
  };
}
it('does not publish or execute an effect without a committed live lease', async () => {
  const f = fixture();
  expect(await f.service.relayOne()).toEqual(ok(null));
  vi.mocked(f.jobs.lease).mockResolvedValue(null);
  const effect = vi.fn();
  expect(await f.service.runJob(job.id, effect)).toEqual(ok(null));
  expect(effect).not.toHaveBeenCalled();
  vi.mocked(f.jobs.lease).mockRejectedValue(Error('secret'));
  expect((await f.service.runJob(job.id, effect)).ok).toBe(false);
  vi.mocked(f.relay.lease).mockRejectedValue(Error('secret'));
  expect((await f.service.relayOne()).ok).toBe(false);
  expect(f.publisher.publish).not.toHaveBeenCalled();
});
it('commits the SQL effect and completion in the same transaction, fenced before mutation', async () => {
  const f = fixture(),
    order: string[] = [];
  vi.mocked(f.jobs.fence).mockImplementation(async () => {
    order.push('fence');
  });
  vi.mocked(f.jobs.complete).mockImplementation(async () => {
    order.push('complete');
  });
  expect(
    (
      await f.service.runJob(job.id, async (actual, input) => {
        expect(actual).toBe(tx);
        expect(input).toEqual(job.input);
        order.push('effect');
        return ok(undefined);
      })
    ).ok,
  ).toBe(true);
  expect(order).toEqual(['fence', 'effect', 'complete']);
  expect(f.telemetry.record).toHaveBeenCalledWith('job_completed');
});
it('rolls back failed effects and defers them without logging raw errors', async () => {
  const f = fixture();
  expect((await f.service.runJob(job.id, async () => fail(failure('forbidden')))).ok).toBe(false);
  expect(f.jobs.complete).not.toHaveBeenCalled();
  expect(f.jobs.fail).toHaveBeenCalledWith(tx, job);
  expect(f.telemetry.record).toHaveBeenCalledWith('job_deferred');
});
it('replays a completed command response without invoking its effect', async () => {
  const f = fixture(),
    response = {
      schema_version: 1 as const,
      resource_id: identifier('resource'),
      status: 'created' as const,
    },
    command = {
      actorHash: 'a'.repeat(64),
      operation: 'fixture',
      keyHash: 'b'.repeat(64),
      bodyHash: 'c'.repeat(64),
      canonicalVersion: 1,
    };
  expect(await f.service.command(command, async () => response)).toEqual(ok(response));
  expect(f.commands.complete).toHaveBeenCalledWith(tx, command, response);
  vi.mocked(f.commands.claim).mockResolvedValue(response);
  const effect = vi.fn();
  expect(await f.service.command(command, effect)).toEqual(ok(response));
  expect(effect).not.toHaveBeenCalled();
});
