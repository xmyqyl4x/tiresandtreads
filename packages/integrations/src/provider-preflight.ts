import { createHash } from 'node:crypto';
import {
  S3Client,
  HeadBucketCommand,
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, DescribeKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { readLocalProviderPreflight } from '../../config/src/provider-preflight.ts';
import type { MailProvider } from '../../application/src/ports/delivery-services.ts';
import { boundedIO } from './bounded-io.ts';

export const providerPreflightCanary = 'Tires and Tread synthetic provider preflight';
export function createPreflightNoSend(): MailProvider {
  return Object.freeze({
    name: 'fixture',
    fixture: true,
    async send() {
      throw Error('Local preflight mail disabled');
    },
  });
}
export type ProviderPreflightFinding =
  | 'storage_region'
  | 'versioning'
  | 'private_encryption'
  | 'private_access'
  | 'kms_identity'
  | 'kms_state'
  | 'kms_canary'
  | 'object_identity'
  | 'object_bytes';
export interface ProviderPreflightReport {
  readonly scope: 'local-fixture';
  readonly status: 'compatible' | 'incompatible' | 'configuration' | 'unavailable';
  readonly compatible: boolean;
  readonly hostedAccepted: false;
  readonly externalEffectsEnabled: false;
  readonly mail: 'no-send';
  readonly findings: readonly ProviderPreflightFinding[];
}
export async function preflightLocalProviders(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ProviderPreflightReport> {
  const report = (
    status: ProviderPreflightReport['status'],
    findings: readonly ProviderPreflightFinding[] = [],
  ): ProviderPreflightReport => ({
    scope: 'local-fixture',
    status,
    compatible: status === 'compatible',
    hostedAccepted: false,
    externalEffectsEnabled: false,
    mail: 'no-send',
    findings,
  });
  let s: ReturnType<typeof readLocalProviderPreflight>;
  try {
    s = readLocalProviderPreflight(input, env);
  } catch {
    return report('configuration');
  }
  const credentials = { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' };
  const s3 = new S3Client({
    endpoint: s.storageEndpoint,
    region: s.region,
    credentials,
    forcePathStyle: true,
    followRegionRedirects: false,
    maxAttempts: 1,
  });
  const kms = new KMSClient({
    endpoint: s.storageEndpoint,
    region: s.region,
    credentials,
    maxAttempts: 1,
  });
  try {
    return await boundedIO(async (signal) => {
      const findings: ProviderPreflightFinding[] = [],
        options = { abortSignal: signal };
      const add = (bad: boolean, code: ProviderPreflightFinding) => {
        if (bad && !findings.includes(code)) findings.push(code);
      };
      for (const Bucket of [s.privateBucket, s.publicBucket]) {
        const target = { Bucket, ExpectedBucketOwner: s.account };
        await s3.send(new HeadBucketCommand(target), options);
        const location = await s3.send(new GetBucketLocationCommand(target), options);
        add((location.LocationConstraint ?? 'us-east-1') !== s.region, 'storage_region');
        const versions = await s3.send(new GetBucketVersioningCommand(target), options);
        add(versions.Status !== 'Enabled', 'versioning');
      }
      const target = { Bucket: s.privateBucket, ExpectedBucketOwner: s.account };
      const encryption = await s3.send(new GetBucketEncryptionCommand(target), options),
        rules = encryption.ServerSideEncryptionConfiguration?.Rules;
      add(
        rules?.length !== 1 ||
          rules[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== 'aws:kms' ||
          rules[0]?.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID !== s.keyArn,
        'private_encryption',
      );
      const access = (await s3.send(new GetPublicAccessBlockCommand(target), options))
        .PublicAccessBlockConfiguration;
      add(
        !access ||
          !access.BlockPublicAcls ||
          !access.IgnorePublicAcls ||
          !access.BlockPublicPolicy ||
          !access.RestrictPublicBuckets,
        'private_access',
      );
      const key = (await kms.send(new DescribeKeyCommand({ KeyId: s.keyArn }), options))
        .KeyMetadata;
      add(
        key?.Arn !== s.keyArn ||
          key.AWSAccountId !== s.account ||
          key.KeyId !== s.keyArn.split('/')[1],
        'kms_identity',
      );
      add(
        !key?.Enabled ||
          key.KeyState !== 'Enabled' ||
          key.KeyUsage !== 'ENCRYPT_DECRYPT' ||
          key.KeySpec !== 'SYMMETRIC_DEFAULT',
        'kms_state',
      );
      if (!findings.includes('kms_identity') && !findings.includes('kms_state')) {
        const plain = await kms.send(
          new DecryptCommand({
            KeyId: s.keyArn,
            CiphertextBlob: Buffer.from(s.kmsCiphertext, 'hex'),
            EncryptionContext: s.context,
          }),
          options,
        );
        try {
          add(
            plain.KeyId !== s.keyArn ||
              !plain.Plaintext ||
              !Buffer.from(plain.Plaintext).equals(Buffer.from(providerPreflightCanary)),
            'kms_canary',
          );
        } finally {
          plain.Plaintext?.fill(0);
        }
      }
      const object = await s3.send(
        new GetObjectCommand({
          ...target,
          Key: 'canary.bin',
          VersionId: s.objectVersion,
          ChecksumMode: 'ENABLED',
        }),
        options,
      );
      add(
        object.VersionId !== s.objectVersion ||
          object.ServerSideEncryption !== 'aws:kms' ||
          object.SSEKMSKeyId !== s.keyArn ||
          object.ContentType !== 'application/octet-stream' ||
          object.ContentLength !== Buffer.byteLength(providerPreflightCanary),
        'object_identity',
      );
      if (!object.Body) throw Error();
      try {
        const parts: Uint8Array[] = [];
        let size = 0;
        for await (const part of object.Body as AsyncIterable<Uint8Array>) {
          size += part.length;
          if (size > 1024 || signal.aborted) throw Error();
          parts.push(part);
        }
        const actual = createHash('sha256').update(Buffer.concat(parts)).digest('hex');
        add(
          actual !== createHash('sha256').update(providerPreflightCanary).digest('hex'),
          'object_bytes',
        );
      } finally {
        if ('destroy' in object.Body && typeof object.Body.destroy === 'function')
          object.Body.destroy();
      }
      const response = await fetch(s.workflowEndpoint + '/health', { redirect: 'error', signal });
      await response.body?.cancel();
      if (!response.ok) throw Error();
      return report(findings.length ? 'incompatible' : 'compatible', findings);
    }, 5000);
  } catch {
    return report('unavailable');
  } finally {
    s3.destroy();
    kms.destroy();
  }
}
