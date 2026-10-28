import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutBucketEncryptionCommand,
  PutPublicAccessBlockCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
import {
  KMSClient,
  CreateKeyCommand,
  EncryptCommand,
  DisableKeyCommand,
  EnableKeyCommand,
} from '@aws-sdk/client-kms';
import {
  localProviderProject,
  readLocalProviderPreflight,
} from '../../packages/config/src/provider-preflight.ts';
import {
  preflightLocalProviders,
  providerPreflightCanary,
} from '../../packages/integrations/src/provider-preflight.ts';
import { providerInput, preflightEnv } from '../fixtures/provider-preflight/input.ts';

let s3: S3Client, kms: KMSClient, input: ReturnType<typeof providerInput>;
const env = () => ({ ...preflightEnv, ISOLATED_TEST_PROJECT: localProviderProject(process.env) });
const probe = (patch = {}) => preflightLocalProviders({ ...input, ...patch }, process.env);
const blocking = (value: boolean) => ({
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: value,
  RestrictPublicBuckets: true,
});
async function encryption(algorithm: 'aws:kms' | 'AES256' = 'aws:kms') {
  await s3.send(
    new PutBucketEncryptionCommand({
      Bucket: input.privateBucket,
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: algorithm,
              ...(algorithm === 'aws:kms' ? { KMSMasterKeyID: input.keyArn } : {}),
            },
          },
        ],
      },
    }),
  );
}
async function put(body: Uint8Array) {
  return (
    await s3.send(
      new PutObjectCommand({
        Bucket: input.privateBucket,
        Key: 'canary.bin',
        Body: body,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: input.keyArn,
        ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
      }),
    )
  ).VersionId!;
}
beforeAll(async () => {
  input = providerInput(env());
  const settings = readLocalProviderPreflight(input, process.env);
  const options = {
    endpoint: settings.storageEndpoint,
    region: settings.region,
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    maxAttempts: 1,
  };
  s3 = new S3Client({ ...options, forcePathStyle: true });
  kms = new KMSClient(options);
  for (const Bucket of [input.privateBucket, input.publicBucket]) {
    let missing = false;
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
    } catch (e) {
      missing =
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
    }
    if (!missing) throw Error('Refusing existing or unavailable preflight fixture');
    await s3.send(new CreateBucketCommand({ Bucket }));
    await s3.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
    );
  }
  input.keyArn = (
    await kms.send(
      new CreateKeyCommand({
        Description: 'Synthetic disposable provider preflight',
        KeyUsage: 'ENCRYPT_DECRYPT',
        KeySpec: 'SYMMETRIC_DEFAULT',
      }),
    )
  ).KeyMetadata!.Arn!;
  await encryption();
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: input.privateBucket,
      PublicAccessBlockConfiguration: blocking(true),
    }),
  );
  input.objectVersion = await put(Buffer.from(providerPreflightCanary));
  input.kmsCiphertext = Buffer.from(
    (
      await kms.send(
        new EncryptCommand({
          KeyId: input.keyArn,
          Plaintext: Buffer.from(providerPreflightCanary),
          EncryptionContext: settings.context,
        }),
      )
    ).CiphertextBlob!,
  ).toString('hex');
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  s3?.destroy();
  kms?.destroy();
});
it('inspects actual local S3/KMS and workflow reachability with only read commands and unchanged object versions', async () => {
  const versions = () => s3.send(new ListObjectVersionsCommand({ Bucket: input.privateBucket }));
  const before = await versions(),
    objects = vi.spyOn(S3Client.prototype, 'send'),
    keys = vi.spyOn(KMSClient.prototype, 'send');
  expect(await probe()).toEqual({
    scope: 'local-fixture',
    status: 'compatible',
    compatible: true,
    hostedAccepted: false,
    externalEffectsEnabled: false,
    mail: 'no-send',
    findings: [],
  });
  expect(objects.mock.calls.map(([c]) => c.constructor.name)).toEqual([
    'HeadBucketCommand',
    'GetBucketLocationCommand',
    'GetBucketVersioningCommand',
    'HeadBucketCommand',
    'GetBucketLocationCommand',
    'GetBucketVersioningCommand',
    'GetBucketEncryptionCommand',
    'GetPublicAccessBlockCommand',
    'GetObjectCommand',
  ]);
  expect(keys.mock.calls.map(([c]) => c.constructor.name)).toEqual([
    'DescribeKeyCommand',
    'DecryptCommand',
  ]);
  for (const [c] of objects.mock.calls)
    expect(c.input).toHaveProperty('ExpectedBucketOwner', '123456789012');
  objects.mockRestore();
  keys.mockRestore();
  expect((await versions()).Versions).toEqual(before.Versions);
});
it.each(['versioning', 'private_encryption', 'private_access'] as const)(
  'reports actual %s drift without repairing it',
  async (kind) => {
    try {
      if (kind === 'versioning')
        await s3.send(
          new PutBucketVersioningCommand({
            Bucket: input.publicBucket,
            VersioningConfiguration: { Status: 'Suspended' },
          }),
        );
      if (kind === 'private_encryption') await encryption('AES256');
      if (kind === 'private_access')
        await s3.send(
          new PutPublicAccessBlockCommand({
            Bucket: input.privateBucket,
            PublicAccessBlockConfiguration: blocking(false),
          }),
        );
      expect((await probe()).findings).toContain(kind);
      if (kind === 'versioning')
        expect(
          (await s3.send(new GetBucketVersioningCommand({ Bucket: input.publicBucket }))).Status,
        ).toBe('Suspended');
      if (kind === 'private_encryption')
        expect(
          (await s3.send(new GetBucketEncryptionCommand({ Bucket: input.privateBucket })))
            .ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault
            ?.SSEAlgorithm,
        ).toBe('AES256');
      if (kind === 'private_access')
        expect(
          (await s3.send(new GetPublicAccessBlockCommand({ Bucket: input.privateBucket })))
            .PublicAccessBlockConfiguration?.BlockPublicPolicy,
        ).toBe(false);
    } finally {
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: input.publicBucket,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
      await encryption();
      await s3.send(
        new PutPublicAccessBlockCommand({
          Bucket: input.privateBucket,
          PublicAccessBlockConfiguration: blocking(true),
        }),
      );
    }
  },
);
it('refuses disabled key authority, wrong encryption context and wrong decrypted canary without changing custody', async () => {
  try {
    await kms.send(new DisableKeyCommand({ KeyId: input.keyArn.split('/')[1] }));
    expect((await probe()).findings).toContain('kms_state');
  } finally {
    await kms.send(new EnableKeyCommand({ KeyId: input.keyArn.split('/')[1] }));
  }
  const context = readLocalProviderPreflight(input, process.env).context;
  for (const wrongContext of [true, false]) {
    const ciphertext = (
      await kms.send(
        new EncryptCommand({
          KeyId: input.keyArn,
          Plaintext: Buffer.from(wrongContext ? providerPreflightCanary : 'wrong'),
          EncryptionContext: wrongContext ? { ...context, purpose: 'different' } : context,
        }),
      )
    ).CiphertextBlob!;
    const r = await probe({ kmsCiphertext: Buffer.from(ciphertext).toString('hex') });
    if (wrongContext) expect(r.status).toBe('unavailable');
    else expect(r.findings).toContain('kms_canary');
  }
  expect((await probe()).compatible).toBe(true);
});
it('refuses missing exact versions, altered bytes and oversized object bodies without adopting another version', async () => {
  expect((await probe({ objectVersion: 'missing-version' })).status).toBe('unavailable');
  const wrong = Buffer.from(providerPreflightCanary);
  wrong.fill(120);
  const version = await put(wrong);
  expect((await probe({ objectVersion: version })).findings).toContain('object_bytes');
  const large = await put(Buffer.alloc(1025, 120));
  expect((await probe({ objectVersion: large })).status).toBe('unavailable');
  expect((await probe()).compatible).toBe(true);
});
it('refuses wrong scope, account, region, network and live-mail inputs before any provider I/O', async () => {
  const objects = vi.spyOn(S3Client.prototype, 'send'),
    keys = vi.spyOn(KMSClient.prototype, 'send'),
    net = vi.spyOn(globalThis, 'fetch');
  for (const patch of [
    { account: '999999999999' },
    { region: 'us-west-2' },
    { storageEndpoint: 'https://s3.amazonaws.com' },
    { workflowEndpoint: 'https://api.inngest.com' },
    { mailMode: 'sandbox' },
  ])
    expect((await probe(patch)).status).toBe('configuration');
  expect(
    (await preflightLocalProviders(input, { ...process.env, APP_ENV: 'stage-local' })).status,
  ).toBe('configuration');
  expect(objects).not.toHaveBeenCalled();
  expect(keys).not.toHaveBeenCalled();
  expect(net).not.toHaveBeenCalled();
});
it('contains unavailable workflow transport and unknown provider failures without exposing endpoint, key or raw errors', async () => {
  const net = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(Error('private transport failure'));
  const r = await probe();
  expect(r.status).toBe('unavailable');
  expect(net).toHaveBeenCalledWith(
    'http://inngest:8288/health',
    expect.objectContaining({ redirect: 'error' }),
  );
  net.mockRestore();
  vi.spyOn(KMSClient.prototype, 'send').mockRejectedValueOnce(Error('private provider error'));
  const failure = await probe();
  expect(failure.status).toBe('unavailable');
  for (const secret of [
    input.keyArn,
    input.kmsCiphertext,
    input.privateBucket,
    'private provider error',
    'private transport failure',
  ])
    expect(JSON.stringify([r, failure])).not.toContain(secret);
});
