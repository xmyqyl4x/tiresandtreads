import { S3Client } from '@aws-sdk/client-s3';
import { KMSClient } from '@aws-sdk/client-kms';
import { readWorkerConfig } from '../../config/src/worker.ts';
import { createRuntimePool } from '../../db/src/runtime-pool.ts';
import { createTransactions } from '../../db/src/transactions.ts';
import {
  createJobRepository,
  createRelayRepository,
  createCommandRepository,
} from '../../db/src/repositories/jobs.ts';
import { createAssetRepository } from '../../db/src/repositories/assets.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
import { createCapabilityRepository } from '../../db/src/repositories/capabilities.ts';
import { createDurability } from '../../application/src/services/durability.ts';
import { createAssetService } from '../../application/src/services/assets.ts';
import { createInboxDurability } from '../../application/src/services/inbox.ts';
import { createPrivateObjects, createEnvelopeEncryption, createS3PublicReader } from './storage.ts';
import { createWorkflows } from './workflows.ts';
import type { JobInput, Telemetry } from '../../application/src/ports/jobs.ts';
import type { TransactionContext } from '../../application/src/ports/transactions.ts';
import { id, ok, fail, type Result } from '../../domain/src/values/core.ts';
import { failure, type ApplicationFailure } from '../../application/src/ports/transactions.ts';
import { postgresCapacity } from '../../config/src/postgres-capacity.ts';
import type { ReliabilityRepository } from '../../application/src/ports/reliability.ts';

export type SqlJobHandler = (
  tx: TransactionContext,
  input: JobInput,
) => Promise<Result<void, ApplicationFailure>>;
export interface SharedRuntime {
  readonly privateScope: ReturnType<typeof createTransactions>;
  readonly assetScope: ReturnType<typeof createTransactions>;
  readonly requiredConnections: number;
  readonly activity: <T>(work: () => Promise<T>) => Promise<T>;
  readonly maintenance: () => Promise<unknown>;
}
export async function createRuntime(
  env: Readonly<Record<string, string | undefined>>,
  handlersFor: (ports: {
    readonly outbox: Pick<ReliabilityRepository, 'append'>;
  }) => Readonly<Record<string, SqlJobHandler>>,
  telemetry: Telemetry = { record() {} },
  shared?: SharedRuntime,
) {
  const config = readWorkerConfig(env);
  const privatePool = shared ? undefined : createRuntimePool(config.privateUrl, config.poolMax),
    assetPool = shared ? undefined : createRuntimePool(config.assetUrl, config.poolMax);
  const privateScope = shared?.privateScope ?? createTransactions(privatePool!.pool),
    assetScope = shared?.assetScope ?? createTransactions(assetPool!.pool);
  const activity = shared?.activity ?? (<T>(work: () => Promise<T>) => work());
  const credentials = { accessKeyId: config.accessKey, secretAccessKey: config.secretKey };
  const s3 = new S3Client({
    region: config.region,
    endpoint: config.storageUrl,
    forcePathStyle: true,
    credentials,
    maxAttempts: 1,
  });
  const kms = new KMSClient({
    region: config.region,
    endpoint: config.storageUrl,
    credentials,
    maxAttempts: 1,
  });
  let stopping = false,
    shutdown: Promise<void> | undefined;
  function stop() {
    stopping = true;
    return (shutdown ??= Promise.all([privatePool?.drain(), assetPool?.drain()])
      .then(() => {})
      .finally(() => {
        s3.destroy();
        kms.destroy();
      }));
  }
  try {
    const check = await privateScope.unitOfWork.run(async (tx) => {
      const row = (
        await privateScope.query(
          tx,
          "SELECT current_user AS role,current_setting('max_connections')::integer AS maximum,current_setting('superuser_reserved_connections')::integer AS super_reserved,current_setting('reserved_connections')::integer AS role_reserved",
        )
      ).rows[0]!;
      const required =
        shared?.requiredConnections ??
        config.replicas * (2 * config.poolMax + config.otherConnections) + config.reserve;
      if (
        row.role !== 'tt_private_runtime' ||
        !Number.isSafeInteger(required) ||
        required < 1 ||
        required > Number(row.maximum)
      )
        return fail(failure('unavailable'));
      const capacity = postgresCapacity(
        Number(row.maximum),
        Number(row.super_reserved),
        Number(row.role_reserved),
        required,
      );
      return ok({
        required,
        maximum: capacity.capacity,
        usableCapacity: capacity.usableCapacity,
        serverReserved: capacity.serverReserved,
      });
    });
    const assetCheck = await assetScope.unitOfWork.run(async (tx) =>
      ok(
        (await assetScope.query(tx, 'SELECT current_user AS role')).rows[0]?.role ===
          'tt_asset_runtime',
      ),
    );
    if (!check.ok || !assetCheck.ok || !assetCheck.value) throw Error('Runtime unavailable');
    const jobs = createJobRepository(privateScope),
      relay = createRelayRepository(privateScope),
      commands = createCommandRepository(privateScope),
      outbox = createReliabilityRepository(privateScope);
    const handlers = Object.freeze({
      ...handlersFor({ outbox: Object.freeze({ append: outbox.append }) }),
    });
    const safeTelemetry: Telemetry = {
      record(event) {
        try {
          telemetry.record(event);
        } catch {
          /* Optional telemetry must not change durable outcomes. */
        }
      },
    };
    const workflows = createWorkflows({
      baseUrl: config.workflowUrl,
      appId: 'tiresandtreads-' + config.appEnv,
      ...(shared ? { maintenance: shared.maintenance } : {}),
      async run(jobId) {
        return activity(async () => {
          if (stopping) throw Error('Runtime stopping');
          const r = await durability.runJob(jobId, async (tx, input, lease) => {
            const handler =
              input.version === 1 && Object.hasOwn(handlers, input.type)
                ? handlers[input.type]
                : undefined;
            const effect = () =>
              handler ? handler(tx, input) : Promise.resolve(fail(failure('invalid_input')));
            return input.type === 'inbox.process' ? inbox.apply(tx, lease, effect) : effect();
          });
          if (!r.ok) throw Error('Job deferred');
        });
      },
      async reconcile() {
        return activity(async () => {
          if (stopping) throw Error('Runtime stopping');
          const inboxRecovery = await inbox.reconcile();
          if (!inboxRecovery.ok) throw Error('Runtime unavailable');
          const r = await privateScope.unitOfWork.run(async (tx) => {
            await relay.reconcile(tx);
            return ok(await jobs.reconcile(tx));
          });
          if (!r.ok) throw Error('Runtime unavailable');
          for (let n = 0; n < 4; n++) await durability.relayOne();
          // Shared hosts own their explicit maintenance/retention mode.
          if (!shared) {
            const stale = await assets.reconcile();
            if (stale[0]) await assets.erase(stale[0]);
          }
          return r.value;
        });
      },
    });
    const durability = createDurability({
      uow: privateScope.unitOfWork,
      jobs,
      relay,
      commands,
      publisher: workflows.publisher,
      telemetry: safeTelemetry,
    });
    const assets = createAssetService({
      uow: assetScope.unitOfWork,
      assets: createAssetRepository(assetScope, config.bucket, config.keyId),
      objects: createPrivateObjects(s3, config.bucket, config.keyId),
      authority: privateScope.unitOfWork,
      capabilities: createCapabilityRepository(privateScope),
    });
    const inbox = createInboxDurability({
      uow: privateScope.unitOfWork,
      jobs,
      reliability: outbox,
    });
    return {
      metadata: Object.freeze({
        environment: config.appEnv,
        revision: config.revision,
        host: 'container',
        connections: check.value,
      }),
      workflows,
      assets,
      async receiveVerified(input: Parameters<typeof inbox.receive>[0]) {
        if (stopping) throw Error('Runtime stopping');
        return inbox.receive(input);
      },
      encryption: createEnvelopeEncryption(kms, config.keyId),
      publicObjects: createS3PublicReader(s3, config.publicBucket),
      async enqueue(input: JobInput) {
        if (stopping) throw Error('Runtime stopping');
        return privateScope.unitOfWork.run(async (tx) => {
          const jobId = await jobs.register(tx, input),
            eventId = id('event', jobId),
            aggregateId = id('aggregate', input.resourceId);
          if (!eventId.ok || !aggregateId.ok) return fail(failure('invalid_input'));
          await outbox.append(tx, {
            eventId: eventId.value,
            aggregateId: aggregateId.value,
            aggregateKind: 'job',
            type: 'tt/job.requested',
            version: 1,
            payload: { resource_id: jobId, resource_kind: 'job' },
          });
          return ok(jobId);
        });
      },
      async tick() {
        if (stopping) throw Error('Runtime stopping');
        const reconciled = await privateScope.unitOfWork.run(async (tx) =>
          ok(await relay.reconcile(tx)),
        );
        if (!reconciled.ok) throw Error('Runtime unavailable');
        return durability.relayOne();
      },
      async command(...args: Parameters<typeof durability.command>) {
        if (stopping) throw Error('Runtime stopping');
        return durability.command(...args);
      },
      quiesce() {
        stopping = true;
      },
      shutdown: stop,
    };
  } catch {
    await stop();
    throw Error('Runtime unavailable');
  }
}
