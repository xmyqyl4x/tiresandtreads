import { beforeAll, afterAll, it, expect } from 'vitest';
import { privateFixture, uid, success, result } from '../fixtures/private/database.ts';
import {
  createJobRepository,
  createRelayRepository,
  createCommandRepository,
} from '../../packages/db/src/repositories/jobs.ts';
import { createDurability } from '../../packages/application/src/services/durability.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function setup(
  publish: import('../../packages/application/src/ports/jobs.ts').EventPublisher['publish'] = async () => {},
) {
  const jobs = createJobRepository(f.scope),
    relay = createRelayRepository(f.scope),
    commands = createCommandRepository(f.scope);
  const events: string[] = [];
  return {
    jobs,
    relay,
    commands,
    events,
    service: createDurability({
      uow: f.scope.unitOfWork,
      jobs,
      relay,
      commands,
      publisher: { publish },
      telemetry: { record: (e) => events.push(e) },
    }),
  };
}
function input() {
  return {
    type: 'fixture.rebuild',
    businessKey: uid('key'),
    version: 1,
    resourceId: uid('resource'),
  };
}
it('DB08 atomically commits one command effect across concurrent retries and rejects payload changes', async () => {
  const { service } = setup(),
    identity = {
      actorHash: 'a'.repeat(64),
      operation: 'fixture.create',
      keyHash: uid('key').replaceAll('-', '').repeat(2),
      bodyHash: 'c'.repeat(64),
      canonicalVersion: 1,
    };
  let calls = 0;
  const effect = async () => {
    calls++;
    return { schema_version: 1 as const, resource_id: uid('resource'), status: 'created' as const };
  };
  const [a, b] = await Promise.all([
    service.command(identity, async () => ok(undefined), effect),
    service.command(identity, async () => ok(undefined), effect),
  ]);
  expect(a.ok && b.ok).toBe(true);
  expect(a).toEqual(b);
  expect(calls).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT result_status FROM app.idempotency_requests WHERE operation='fixture.create'",
      )
    ).rows[0].result_status,
  ).toBe(201);
  const denied = await service.command(identity, async () => fail(failure('forbidden')), effect);
  expect(denied).toEqual(fail(failure('forbidden')));
  expect(calls).toBe(1);
  expect(
    (
      await service.command(
        { ...identity, bodyHash: 'd'.repeat(64) },
        async () => ok(undefined),
        effect,
      )
    ).ok,
  ).toBe(false);
  expect(calls).toBe(1);
});
it('DB08 command crash rolls back its pending identity; committed pending identities fail closed', async () => {
  const { service, commands } = setup(),
    identity = {
      actorHash: 'a'.repeat(64),
      operation: 'fixture.rollback',
      keyHash: 'd'.repeat(64),
      bodyHash: 'c'.repeat(64),
      canonicalVersion: 1,
    };
  expect(
    (
      await service.command(
        identity,
        async () => ok(undefined),
        async () => {
          throw Error('secret');
        },
      )
    ).ok,
  ).toBe(false);
  await success(f.scope.unitOfWork, (tx) => commands.claim(tx, identity));
  expect(
    (
      await service.command(
        identity,
        async () => ok(undefined),
        async () => {
          throw Error('must not run');
        },
      )
    ).ok,
  ).toBe(false);
});
it('DB08 SQL job effects and completion are atomic, durable beyond provider dedupe, with no replay effect', async () => {
  const { jobs, service } = setup(),
    i = input();
  const id = await success(f.scope.unitOfWork, (tx) => jobs.register(tx, i));
  expect(await success(f.scope.unitOfWork, (tx) => jobs.register(tx, i))).toBe(id);
  expect(
    (await result(f.scope.unitOfWork, (tx) => jobs.register(tx, { ...i, version: 2 }))).ok,
  ).toBe(false);
  let effects = 0;
  expect(
    (
      await service.runJob(id, async () => {
        effects++;
        return ok(undefined);
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await service.runJob(id, async () => {
        effects++;
        return ok(undefined);
      })
    ).ok,
  ).toBe(true);
  expect(effects).toBe(1);
  expect(
    (await f.admin.query('SELECT state FROM app.job_runs WHERE id=$1', [id])).rows[0].state,
  ).toBe('completed');
});
it('DB08 expired workers cannot complete or fail a newer generation; crash reconciliation recovers work', async () => {
  const { jobs } = setup(),
    id = await success(f.scope.unitOfWork, (tx) => jobs.register(tx, input()));
  const old = await success(f.scope.unitOfWork, (tx) => jobs.lease(tx, id));
  expect(old).not.toBeNull();
  await f.admin.query(
    "UPDATE app.job_runs SET lease_until=created_at+interval '1 microsecond',updated_at=created_at WHERE id=$1",
    [id],
  );
  expect(await success(f.scope.unitOfWork, (tx) => jobs.reconcile(tx))).toContain(id);
  const fresh = await success(f.scope.unitOfWork, (tx) => jobs.lease(tx, id));
  expect(fresh!.generation).toBeGreaterThan(old!.generation);
  expect((await result(f.scope.unitOfWork, (tx) => jobs.complete(tx, old!))).ok).toBe(false);
  await success(f.scope.unitOfWork, (tx) => jobs.fail(tx, old!));
  await success(f.scope.unitOfWork, async (tx) => {
    await jobs.fence(tx, fresh!);
    await jobs.complete(tx, fresh!);
  });
});
it('DB08 failed effects roll back and exhausted/deadline work moves to manual review', async () => {
  const { jobs, service, events } = setup(),
    id = await success(f.scope.unitOfWork, (tx) => jobs.register(tx, input()));
  const eventId = uid('event');
  const r = await service.runJob(id, async (tx) => {
    await f.reliability.append(tx, {
      eventId,
      aggregateId: uid('aggregate'),
      aggregateKind: 'fixture',
      type: 'fixture/rolled-back',
      version: 1,
      payload: { resource_id: uid('resource'), resource_kind: 'fixture' },
    });
    return fail(failure('unavailable'));
  });
  expect(r.ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT count(*)::integer AS n FROM app.outbox WHERE event_id=$1', [
        eventId,
      ])
    ).rows[0].n,
  ).toBe(0);
  expect(events).toEqual(['job_deferred']);
  await f.admin.query('UPDATE app.job_runs SET attempts=8 WHERE id=$1', [id]);
  await success(f.scope.unitOfWork, (tx) => jobs.reconcile(tx));
  expect(await success(f.scope.unitOfWork, (tx) => jobs.lease(tx, id))).toBeNull();
  expect(
    (await f.admin.query('SELECT state,last_error_code FROM app.job_runs WHERE id=$1', [id]))
      .rows[0],
  ).toEqual({ state: 'manual_review', last_error_code: 'retry_exhausted' });
});
it('DB08 deadline and legacy jobs fail closed; exhausted outbox work is quarantined', async () => {
  const { jobs, relay } = setup(),
    near = uid('job'),
    legacy = uid('job');
  await f.admin.query(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'fixture.deadline',$2,1,$3,clock_timestamp()+interval '20 seconds')",
    [near, uid('key'), uid('resource')],
  );
  await f.admin.query(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version) VALUES($1,'fixture.legacy',$2,1)",
    [legacy, uid('key')],
  );
  expect(await success(f.scope.unitOfWork, (tx) => jobs.lease(tx, near))).toBeNull();
  await success(f.scope.unitOfWork, (tx) => jobs.reconcile(tx));
  expect(
    (
      await f.admin.query('SELECT state FROM app.job_runs WHERE id=ANY($1)', [[near, legacy]])
    ).rows.map((x) => x.state),
  ).toEqual(['manual_review', 'manual_review']);
  await f.admin.query(
    "UPDATE app.outbox SET state='cancelled' WHERE state IN ('pending','failed')",
  );
  const eventId = uid('event');
  await success(f.scope.unitOfWork, (tx) =>
    f.reliability.append(tx, {
      eventId,
      aggregateId: uid('aggregate'),
      aggregateKind: 'fixture',
      type: 'fixture/exhaust',
      version: 1,
      payload: { resource_id: uid('resource'), resource_kind: 'fixture' },
    }),
  );
  const lease = await success(f.scope.unitOfWork, (tx) => relay.lease(tx));
  await f.admin.query(
    "UPDATE app.outbox SET attempts=8,lease_until=created_at+interval '1 microsecond',updated_at=created_at WHERE event_id=$1",
    [eventId],
  );
  await success(f.scope.unitOfWork, (tx) => relay.reconcile(tx));
  await success(f.scope.unitOfWork, (tx) => relay.fail(tx, lease!));
  expect(
    (await f.admin.query('SELECT state FROM app.outbox WHERE event_id=$1', [eventId])).rows[0]
      .state,
  ).toBe('quarantined');
  expect(await success(f.scope.unitOfWork, (tx) => relay.lease(tx))).toBeNull();
});
it('DB08 relay uncertain receipt reuses event identity and fences stale acknowledgements', async () => {
  await f.admin.query(
    "UPDATE app.outbox SET state='cancelled' WHERE state IN ('pending','failed')",
  );
  const event = {
    eventId: uid('event'),
    aggregateId: uid('aggregate'),
    aggregateKind: 'fixture',
    type: 'fixture/ready',
    version: 1,
    payload: { resource_id: uid('resource'), resource_kind: 'fixture' },
  };
  await success(f.scope.unitOfWork, (tx) => f.reliability.append(tx, event));
  const sent: string[] = [];
  let loseAck = true;
  const { service, relay, events } = setup(async (e) => {
    sent.push(e.eventId);
    if (loseAck) throw Error('secret provider URL');
  });
  await service.relayOne();
  expect(events).toEqual(['relay_deferred']);
  await f.admin.query('UPDATE app.outbox SET available_at=clock_timestamp() WHERE event_id=$1', [
    event.eventId,
  ]);
  const stale = await success(f.scope.unitOfWork, (tx) => relay.lease(tx));
  await f.admin.query(
    "UPDATE app.outbox SET lease_until=created_at+interval '1 microsecond',updated_at=created_at WHERE event_id=$1",
    [event.eventId],
  );
  await success(f.scope.unitOfWork, (tx) => relay.reconcile(tx));
  loseAck = false;
  await service.relayOne();
  expect(sent).toEqual([event.eventId, event.eventId]);
  expect((await result(f.scope.unitOfWork, (tx) => relay.acknowledge(tx, stale!))).ok).toBe(false);
  expect(
    (await f.admin.query('SELECT state FROM app.outbox WHERE event_id=$1', [event.eventId])).rows[0]
      .state,
  ).toBe('published');
  expect(JSON.stringify(events)).not.toContain('secret');
});
