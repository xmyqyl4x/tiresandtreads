import { Inngest } from 'inngest';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventPublisher } from '../../application/src/ports/jobs.ts';
import { id, type Id } from '../../domain/src/values/index.ts';
import { boundedIO } from './bounded-io.ts';
const silent = { info() {}, warn() {}, error() {}, debug() {} };
export function createWorkflows(options: {
  readonly baseUrl: string;
  readonly appId: string;
  readonly run: (id: Id<'job'>) => Promise<void>;
  readonly reconcile: () => Promise<readonly Id<'job'>[]>;
}) {
  const sending = new AsyncLocalStorage<AbortSignal>();
  // This local adapter cannot accidentally select cloud mode because NODE_ENV=production.
  const client = new Inngest({
    id: options.appId,
    isDev: true,
    baseUrl: options.baseUrl,
    logger: silent,
    internalLogger: silent,
    fetch: (input, init) =>
      boundedIO((signal) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            signal,
            ...(init?.signal ? [init.signal] : []),
            ...(sending.getStore() ? [sending.getStore()!] : []),
          ]),
        }),
      ),
  });
  const publisher: EventPublisher = {
    async publish(e) {
      await boundedIO((signal) =>
        sending.run(signal, async () => {
          await client.send({
            id: e.eventId,
            name: e.type,
            data: {
              resource_id: e.payload.resource_id,
              resource_kind: e.payload.resource_kind,
              ...(e.payload.version === undefined ? {} : { version: e.payload.version }),
              ...(e.payload.revision === undefined ? {} : { revision: e.payload.revision }),
              schema_version: e.version,
            },
          });
        }),
      );
    },
  };
  async function dispatch(value: unknown) {
    const parsed = id('job', value);
    if (!parsed.ok) throw Error('Invalid job reference');
    await options.run(parsed.value);
    return { accepted: true };
  }
  const job = client.createFunction(
    {
      id: 'durable-sql-job-v1',
      triggers: { event: 'tt/job.requested' },
      retries: 2,
      concurrency: 4,
      timeouts: { finish: '20s' },
    },
    async ({ event, step }) =>
      step.run('apply-fenced-sql-effect', () => dispatch(event.data.resource_id)),
  );
  const recovery = client.createFunction(
    {
      id: 'durable-reconciliation-v1',
      triggers: [{ cron: '* * * * *' }, { event: 'tt/reconciliation.requested' }],
      retries: 2,
      concurrency: 1,
      timeouts: { finish: '1m' },
    },
    async ({ step }) => {
      const ids = await step.run('find-recoverable-jobs', options.reconcile);
      for (const id of ids) await step.run('recover-' + id, () => dispatch(id));
      return { count: ids.length };
    },
  );
  return { client, publisher, functions: [job, recovery], dispatch };
}
