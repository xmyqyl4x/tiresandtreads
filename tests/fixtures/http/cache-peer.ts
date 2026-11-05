import pg from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
import { createContentServiceRepository } from '../../../packages/db/src/repositories/content-services.ts';
import { createPublicRoutingReader } from '../../../packages/integrations/src/public-routing.ts';
import { createPublicSnapshots } from '../../../packages/integrations/src/public-snapshots.ts';
import { disposableTargets } from '../foundation/target.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';
// Fixed read-only child process. Only pre-existing synthetic targets and public-reader identity.
const target = disposableTargets(process.env),
  url = new URL(process.env.TT_CACHE_PUBLIC_URL!),
  root = new URL(target.app),
  storage = new URL(process.env.STORAGE_ENDPOINT!);
if (
  url.protocol !== root.protocol ||
  url.search ||
  url.hash ||
  !url.password ||
  storage.origin !== 'http://moto:5000' ||
  storage.pathname !== '/' ||
  storage.username ||
  storage.password ||
  storage.search ||
  storage.hash ||
  url.hostname !== root.hostname ||
  url.port !== root.port ||
  url.username !== 'tt_public_runtime' ||
  url.pathname !== '/tt_app_catalog' ||
  process.env.STORAGE_ENDPOINT !== process.env.TEST_STORAGE_ENDPOINT ||
  !/^host-public-[a-f0-9-]+$/.test(process.env.PUBLIC_BUCKET ?? '')
)
  throw Error('Cache fixture admission refused');
const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 1,
    application_name: 'tt-cache-peer',
    connectionTimeoutMillis: 1500,
    options: '-c default_transaction_read_only=on',
  }),
  scope = createTransactions(pool, { transactionMs: 2500, statementMs: 1000, lockMs: 250 }),
  repo = createContentServiceRepository(scope),
  s3 = new S3Client({
    endpoint: storage.origin,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    maxAttempts: 1,
  }),
  reader = createPublicRoutingReader({
    current: async () => {
      const r = await scope.unitOfWork.run(async (tx) => {
        const role = await scope.query(
          tx,
          "SELECT current_user AS role,current_setting('transaction_read_only') AS read_only",
        );
        if (role.rows[0]?.role !== 'tt_public_runtime' || role.rows[0]?.read_only !== 'on')
          throw Error('Role refused');
        return ok(await repo.currentRedirects(tx));
      });
      if (!r.ok) throw Error('Unavailable');
      return r.value;
    },
    objects: createPublicSnapshots(s3, process.env.PUBLIC_BUCKET!),
  });
let pending = Promise.resolve(),
  count = 0,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(lifetime);
  await pending;
  await pool.end();
  s3.destroy();
  process.disconnect?.();
}
const lifetime = setTimeout(() => {
  void stop();
}, 120000);
process.on('SIGTERM', () => {
  void stop();
});
process.on('disconnect', () => {
  void stop();
});
process.on('message', (raw: unknown) => {
  if (stopping) return;
  const input = raw as { id: number; kind: string };
  if (!Number.isSafeInteger(input.id) || ++count > 12 || !['read', 'stop'].includes(input.kind)) {
    void stop();
    return;
  }
  if (input.kind === 'stop') {
    void stop();
    return;
  }
  pending = pending
    .then(async () => {
      const value = await reader.read();
      process.send?.({
        id: input.id,
        pid: process.pid,
        revision: value?.revision ?? null,
        rules: value?.rules ?? null,
      });
    })
    .catch(() => {
      process.send?.({ id: input.id, error: 'unavailable' });
    });
});
process.send?.({ ready: true, pid: process.pid });
