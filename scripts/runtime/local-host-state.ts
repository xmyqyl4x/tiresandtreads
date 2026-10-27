import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  parseLocalProviderState,
  type LocalProviderState,
} from '../../packages/config/src/local-provider-state.ts';
export type { LocalProviderState } from '../../packages/config/src/local-provider-state.ts';
import { S3Client, GetObjectCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { KMSClient, DecryptCommand, DescribeKeyCommand } from '@aws-sdk/client-kms';
import {
  serviceHostRoles,
  type ServiceHostLane,
} from '../../packages/config/src/service-host-plan.ts';
import { readServiceHostSettings } from '../../packages/config/src/service-host-settings.ts';
export const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
export const fixtureCredentials = {
  accessKeyId: 'fixture-access',
  secretAccessKey: 'fixture-secret',
};
export function localHostSettings(
  target: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  if (!['dev', 'stage'].includes(target)) throw Error('Invalid retained target');
  const hex = () => randomBytes(32).toString('hex');
  const ring = () => ({ current: 'local-v1', values: { 'local-v1': hex() } });
  const urls = Object.fromEntries(
    Object.entries(serviceHostRoles).map(([lane, role]) => {
      const password = env[`DB_PASSWORD_${role.toUpperCase()}`];
      if (!/^[a-f0-9]{64}$/.test(password ?? '')) throw Error('Missing existing role credential');
      return [
        lane,
        `postgresql://${role}:${password}@postgres:5432/tt_${lane === 'cms' ? 'cms' : 'app'}`,
      ];
    }),
  ) as Record<ServiceHostLane, string>;
  return readServiceHostSettings({
    schemaVersion: 1,
    plan: {
      urls,
      max: Object.fromEntries(Object.keys(urls).map((k) => [k, 1])),
      replicas: 1,
      reserve: 20,
      external: [
        { name: 'operators', database: 'application', max: 2, replicas: 1 },
        { name: 'cms-operator', database: 'cms', max: 1, replicas: 1 },
        { name: 'workflow-proof', database: 'application', max: 1, replicas: 1 },
        { name: 'setup', database: 'application', max: 1, replicas: 1 },
      ],
    },
    keys: {
      token: ring(),
      report: ring(),
      privacy: ring(),
      collection: ring(),
      lookup: { 'local-hmac-v1': hex() },
      contactIdentity: hex(),
      reportIdentity: hex(),
      collectionIdentity: hex(),
    },
    policy: {
      fixture: true,
      version: `local-host-${target}-v1`,
      privacyVersion: `local-host-${target}-v1`,
      jurisdiction: 'localfixture',
      notices: Object.fromEntries(
        ['report', 'offers', 'analytics', 'ads', 'targeted_ads', 'necessary'].map((p) => [
          p,
          randomUUID(),
        ]),
      ),
      templateId: randomUUID(),
      rendererHash: digest('synthetic local host renderer v1'),
    },
    origin: `https://${target}.tiresandtreads.test`,
    maintenance: { enabled: ['quotas'], cycle: ['quotas'] },
  });
}
export async function readProviderState(file: string, target: string) {
  if (!isAbsolute(file)) throw Error('Invalid provider state');
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 16384 ||
    (process.platform !== 'win32' && info.mode & 0o077)
  )
    throw Error('Invalid provider state');
  return parseLocalProviderState(JSON.parse(await readFile(file, 'utf8')), target);
}

export async function verifyProviderState(state: LocalProviderState, endpoint: string) {
  if (endpoint !== 'http://moto:5000' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
    throw Error('Invalid fixture endpoint');
  const options = {
    endpoint,
    region: 'us-east-1',
    credentials: fixtureCredentials,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 10000 },
  };
  const s3 = new S3Client({ ...options, forcePathStyle: true }),
    kms = new KMSClient(options);
  const abortSignal = AbortSignal.timeout(10000);
  try {
    const key = await kms.send(new DescribeKeyCommand({ KeyId: state.keyId }), { abortSignal });
    if (key.KeyMetadata?.KeyState !== 'Enabled' || key.KeyMetadata.Arn !== state.keyId)
      throw Error();
    const plain = await kms.send(
      new DecryptCommand({
        KeyId: state.keyId,
        CiphertextBlob: Buffer.from(state.ciphertext, 'base64'),
      }),
      { abortSignal },
    );
    if (!plain.Plaintext || digest(plain.Plaintext) !== state.plaintextHash) throw Error();
    for (const o of state.objects) {
      if (
        (await s3.send(new GetBucketVersioningCommand({ Bucket: o.bucket }), { abortSignal }))
          .Status !== 'Enabled'
      )
        throw Error();
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: o.bucket, Key: o.key, VersionId: o.version }),
        { abortSignal },
      );
      if (
        obj.VersionId !== o.version ||
        !obj.Body ||
        digest(await obj.Body.transformToByteArray()) !== o.sha256
      )
        throw Error();
    }
  } catch {
    throw Error(
      'Local fixture provider state unavailable; refusing automatic key or object replacement',
    );
  } finally {
    s3.destroy();
    kms.destroy();
  }
}
