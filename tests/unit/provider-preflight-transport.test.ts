import { afterEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { KMSClient } from '@aws-sdk/client-kms';
import {
  preflightLocalProviders,
  providerPreflightCanary,
} from '../../packages/integrations/src/provider-preflight.ts';
import { preflightEnv, providerInput } from '../fixtures/provider-preflight/input.ts';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function wire(overrides: Record<string, unknown> = {}) {
  const input = providerInput(),
    plain = Buffer.from(providerPreflightCanary),
    body = Readable.from([Buffer.from(providerPreflightCanary)]);
  const responses: Record<string, unknown> = {
    HeadBucketCommand: {},
    GetBucketLocationCommand: {},
    GetBucketVersioningCommand: { Status: 'Enabled' },
    GetBucketEncryptionCommand: {
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: input.keyArn,
            },
          },
        ],
      },
    },
    GetPublicAccessBlockCommand: {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    },
    GetObjectCommand: {
      Body: body,
      VersionId: input.objectVersion,
      ContentLength: plain.length,
      ContentType: 'application/octet-stream',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: input.keyArn,
    },
    DescribeKeyCommand: {
      KeyMetadata: {
        Arn: input.keyArn,
        KeyId: input.keyArn.split('/')[1],
        AWSAccountId: input.account,
        Enabled: true,
        KeyState: 'Enabled',
        KeyUsage: 'ENCRYPT_DECRYPT',
        KeySpec: 'SYMMETRIC_DEFAULT',
      },
    },
    DecryptCommand: { KeyId: input.keyArn, Plaintext: plain },
    ...overrides,
  };
  const objects = vi
    .spyOn(S3Client.prototype, 'send')
    .mockImplementation(async (c) => responses[c.constructor.name] as never);
  const keys = vi
    .spyOn(KMSClient.prototype, 'send')
    .mockImplementation(async (c) => responses[c.constructor.name] as never);
  const net = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('healthy'));
  const closeObjects = vi.spyOn(S3Client.prototype, 'destroy'),
    closeKeys = vi.spyOn(KMSClient.prototype, 'destroy');
  return { input, plain, body, objects, keys, net, closeObjects, closeKeys };
}
it('clears decrypted canary bytes and closes clients/streams after successful masked inspection', async () => {
  const f = wire();
  expect((await preflightLocalProviders(f.input, preflightEnv)).status).toBe('compatible');
  expect(f.plain.every((b) => b === 0)).toBe(true);
  expect(f.body.destroyed).toBe(true);
  expect(f.closeObjects).toHaveBeenCalledOnce();
  expect(f.closeKeys).toHaveBeenCalledOnce();
});
it.each(['account', 'region', 'key identity', 'object identity'])(
  'rejects a simulated provider returning wrong %s without adopting metadata',
  async (kind) => {
    const input = providerInput();
    const override =
      kind === 'region'
        ? { GetBucketLocationCommand: { LocationConstraint: 'us-west-2' } }
        : kind === 'object identity'
          ? {
              GetObjectCommand: {
                Body: Readable.from([Buffer.from(providerPreflightCanary)]),
                VersionId: 'foreign',
              },
            }
          : {
              DescribeKeyCommand: {
                KeyMetadata: {
                  Arn: input.keyArn,
                  KeyId: kind === 'key identity' ? 'foreign' : input.keyArn.split('/')[1],
                  AWSAccountId: kind === 'account' ? '999999999999' : input.account,
                  Enabled: true,
                  KeyState: 'Enabled',
                  KeyUsage: 'ENCRYPT_DECRYPT',
                  KeySpec: 'SYMMETRIC_DEFAULT',
                },
              },
            };
    wire(override);
    const result = await preflightLocalProviders(input, preflightEnv);
    expect(result.status).toBe('incompatible');
    expect(result.findings).toContain(
      kind === 'region'
        ? 'storage_region'
        : kind === 'object identity'
          ? 'object_identity'
          : 'kms_identity',
    );
    expect(JSON.stringify(result)).not.toContain(input.keyArn);
  },
);
it('contains an uncertain/denied request without retries, fallback or leaking upstream details', async () => {
  const f = wire();
  f.objects.mockRejectedValueOnce(Error('private upstream body'));
  const r = await preflightLocalProviders(f.input, preflightEnv);
  expect(r.status).toBe('unavailable');
  expect(f.objects).toHaveBeenCalledOnce();
  expect(f.keys).not.toHaveBeenCalled();
  expect(f.net).not.toHaveBeenCalled();
  expect(JSON.stringify(r)).not.toContain('private upstream body');
  expect(f.closeObjects).toHaveBeenCalledOnce();
  expect(f.closeKeys).toHaveBeenCalledOnce();
});
it('enforces its outer deadline and aborts/closes even if a simulated transport ignores cancellation', async () => {
  vi.useFakeTimers();
  const f = wire();
  f.objects.mockImplementationOnce(() => new Promise(() => {}));
  const pending = preflightLocalProviders(f.input, preflightEnv);
  await vi.advanceTimersByTimeAsync(5001);
  expect((await pending).status).toBe('unavailable');
  const options = f.objects.mock.calls[0]![1] as { abortSignal: AbortSignal };
  expect(options.abortSignal.aborted).toBe(true);
  expect(f.closeObjects).toHaveBeenCalledOnce();
  expect(f.closeKeys).toHaveBeenCalledOnce();
});
