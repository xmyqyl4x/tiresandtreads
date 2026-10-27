import { z } from 'zod';
import { readRuntimeConfig } from './runtime.ts';
const integer = (max: number) => z.coerce.number().int().min(1).max(max);
const schema = z.object({
  privateUrl: z.string().url(),
  assetUrl: z.string().url(),
  storageUrl: z.string().url(),
  workflowUrl: z.string().url(),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  publicBucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  keyId: z.string().min(1).max(100),
  region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
  accessKey: z.literal('fixture-access'),
  secretKey: z.literal('fixture-secret'),
  poolMax: integer(10),
  replicas: integer(100),
  otherConnections: z.coerce.number().int().min(0).max(10000),
  reserve: integer(1000),
  revision: z.string().regex(/^(working|[a-f0-9]{40})$/),
});
export type WorkerConfig = Readonly<z.infer<typeof schema> & { appEnv: string }>;
export function readWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const bootstrap = readRuntimeConfig(env);
  const r = schema.safeParse({
    privateUrl: env.PRIVATE_DATABASE_URL,
    assetUrl: env.ASSET_DATABASE_URL,
    storageUrl: env.STORAGE_ENDPOINT,
    workflowUrl: env.WORKFLOW_ENDPOINT,
    bucket: env.PRIVATE_BUCKET,
    publicBucket: env.PUBLIC_BUCKET,
    keyId: env.KMS_KEY_ID,
    region: env.AWS_REGION,
    accessKey: env.AWS_ACCESS_KEY_ID,
    secretKey: env.AWS_SECRET_ACCESS_KEY,
    poolMax: env.DB_POOL_MAX ?? 2,
    replicas: env.APP_REPLICAS ?? 1,
    otherConnections: env.OTHER_DB_CONNECTIONS ?? 3,
    reserve: env.DB_CONNECTION_RESERVE ?? 20,
    revision: env.SOURCE_REVISION ?? 'working',
  });
  if (!r.success) throw Error('Invalid worker configuration');
  const value = r.data;
  for (const [url, role] of [
    [value.privateUrl, 'tt_private_runtime'],
    [value.assetUrl, 'tt_asset_runtime'],
  ]) {
    const u = new URL(url!);
    if (
      u.protocol !== 'postgresql:' ||
      !['postgres', 'localhost', '127.0.0.1'].includes(u.hostname) ||
      decodeURIComponent(u.username) !== role ||
      !u.password ||
      u.search ||
      u.hash
    )
      throw Error('Invalid worker configuration');
  }
  for (const url of [value.storageUrl, value.workflowUrl]) {
    const u = new URL(url);
    if (
      u.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', 'moto', 'moto-durable', 'inngest'].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      throw Error('Invalid worker configuration');
  }
  if (value.bucket === value.publicBucket) throw Error('Invalid worker configuration');
  return Object.freeze({ ...value, appEnv: bootstrap.appEnv });
}
