import { randomBytes } from 'node:crypto';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand, EncryptCommand } from '@aws-sdk/client-kms';
import {
  digest,
  fixtureCredentials,
  verifyProviderState,
  type LocalProviderState,
} from './local-host-state.ts';
export async function prepareFixtureProvider(
  target: 'dev' | 'stage',
  endpoint: 'http://moto:5000' | 'http://moto-durable:5000',
) {
  const options = {
    endpoint,
    region: 'us-east-1',
    credentials: fixtureCredentials,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 10000 },
  };
  const s3 = new S3Client({ ...options, forcePathStyle: true }),
    kms = new KMSClient(options);
  try {
    for (const kind of ['private', 'public']) {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: `local-host-${kind}-${target}` }));
        throw Error('Existing bucket requires custody review');
      } catch (e) {
        if (!(
          e &&
          typeof e === 'object' &&
          '$metadata' in e &&
          (e.$metadata as { httpStatusCode?: number }).httpStatusCode === 404
        ))
          throw e;
      }
    }
    const keyId = (
      await kms.send(new CreateKeyCommand({ Description: `Synthetic local host ${target}` }))
    ).KeyMetadata!.Arn!;
    const plaintext = randomBytes(32),
      ciphertext = (await kms.send(new EncryptCommand({ KeyId: keyId, Plaintext: plaintext })))
        .CiphertextBlob!;
    const objects: LocalProviderState['objects'] = [];
    for (const kind of ['private', 'public']) {
      const Bucket = `local-host-${kind}-${target}`;
      await s3.send(new CreateBucketCommand({ Bucket }));
      await s3.send(
        new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
      );
      for (let n = 0; n < 2; n++) {
        const Body = Buffer.from(`Synthetic provider canary ${target} ${kind} ${n}`),
          Key = 'fixture/provider-canary' as const;
        const r = await s3.send(new PutObjectCommand({ Bucket, Key, Body }));
        if (!r.VersionId) throw Error('Version unavailable');
        objects.push({ bucket: Bucket, key: Key, version: r.VersionId, sha256: digest(Body) });
      }
    }
    const state = {
      schemaVersion: 1 as const,
      target,
      keyId,
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      plaintextHash: digest(plaintext),
      objects,
    };
    await verifyProviderState(state, endpoint);
    return state;
  } finally {
    s3.destroy();
    kms.destroy();
  }
}
export function providerSelection(mode: string | undefined) {
  if (mode !== undefined && mode !== 'durable') throw Error('Unknown local provider mode');
  return mode === 'durable'
    ? { endpoint: 'http://moto-durable:5000' as const, file: '/state/provider-v2/provider.json' }
    : { endpoint: 'http://moto:5000' as const, file: '/state/current/provider.json' };
}
