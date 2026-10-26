import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import type { AssetLocation, PrivateObjects } from '../../application/src/ports/assets.ts';
import type { PublicObjectReader } from '../../application/src/ports/publication.ts';
import type { Envelope } from '../../application/src/ports/private-records.ts';
import { boundedIO } from './bounded-io.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function location(a: AssetLocation) {
  if (
    a.key !== 'assets/' + a.id ||
    !Number.isSafeInteger(a.size) ||
    a.size < 0 ||
    a.size > 16 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(a.sha256)
  )
    throw Error('Invalid asset');
}
async function bytes(body: unknown, max: number, signal: AbortSignal) {
  if (!body || typeof body !== 'object' || !(Symbol.asyncIterator in body))
    throw Error('Invalid object');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max || signal.aborted) throw Error('Invalid object');
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
export function createPrivateObjects(
  client: S3Client,
  bucket: string,
  keyId: string,
): PrivateObjects {
  return {
    async put(a, b) {
      location(a);
      if (
        b.byteLength !== a.size ||
        sha(b) !== a.sha256 ||
        (a.mime === 'application/pdf' && Buffer.from(b.subarray(0, 5)).toString() !== '%PDF-')
      )
        throw Error('Invalid asset bytes');
      return boundedIO(async (signal) => {
        try {
          const r = await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: a.key,
              Body: b,
              ContentType: a.mime,
              ContentLength: a.size,
              ChecksumSHA256: Buffer.from(a.sha256, 'hex').toString('base64'),
              ServerSideEncryption: 'aws:kms',
              SSEKMSKeyId: keyId,
              IfNoneMatch: '*',
            }),
            { abortSignal: signal },
          );
          if (!r.VersionId || r.ServerSideEncryption !== 'aws:kms' || r.SSEKMSKeyId !== keyId)
            throw Error('Unverified encryption');
          return r.VersionId;
        } catch {
          // A timed-out PUT may have committed. Only adopt identical encrypted/versioned bytes.
          const h = await client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: a.key, ChecksumMode: 'ENABLED' }),
            { abortSignal: signal },
          );
          if (
            !h.VersionId ||
            h.ContentLength !== a.size ||
            h.ContentType !== a.mime ||
            h.ServerSideEncryption !== 'aws:kms' ||
            h.SSEKMSKeyId !== keyId
          )
            throw Error('Conflicting object');
          // Read the exact version as well: checksum metadata alone is not evidence of its bytes.
          const existing = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: a.key, VersionId: h.VersionId }),
            { abortSignal: signal },
          );
          const content = await bytes(existing.Body, a.size, signal);
          if (content.length !== a.size || sha(content) !== a.sha256)
            throw Error('Conflicting object');
          return h.VersionId;
        }
      });
    },
    async get(a) {
      location(a);
      const version = a.version;
      if (!version) throw Error('Invalid asset');
      return boundedIO(async (signal) => {
        const r = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: a.key,
            VersionId: version,
            ChecksumMode: 'ENABLED',
          }),
          { abortSignal: signal },
        );
        if (
          r.VersionId !== a.version ||
          r.ContentLength !== a.size ||
          r.ContentType !== a.mime ||
          r.ServerSideEncryption !== 'aws:kms' ||
          r.SSEKMSKeyId !== keyId
        )
          throw Error('Invalid object');
        const b = await bytes(r.Body, a.size, signal);
        if (b.byteLength !== a.size || sha(b) !== a.sha256) throw Error('Invalid checksum');
        return b;
      });
    },
    async erase(a) {
      location(a);
      await boundedIO(async (signal) => {
        // Delete at most 100 exact-key versions per pass, then re-list from the start.
        // Never follow another key's prefix or acknowledge a partially erased object.
        for (let pass = 0; pass < 100; pass++) {
          const r = await client.send(
            new ListObjectVersionsCommand({ Bucket: bucket, Prefix: a.key, MaxKeys: 100 }),
            { abortSignal: signal },
          );
          const versions = [...(r.Versions ?? []), ...(r.DeleteMarkers ?? [])].filter(
            (v) => v.Key === a.key,
          );
          if (!versions.length) {
            if (r.IsTruncated) throw Error('Ambiguous version listing');
            return;
          }
          for (const v of versions) {
            if (!v.VersionId) throw Error('Unversioned object');
            await client.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: a.key, VersionId: v.VersionId }),
              { abortSignal: signal },
            );
          }
        }
        throw Error('Deletion limit');
      }, 10000);
    },
  };
}
export function createS3PublicReader(client: S3Client, bucket: string): PublicObjectReader {
  return {
    async get(key, options) {
      if (
        !/^public-config\/[1-9][0-9]{0,9}\.json$/.test(key) ||
        options.maxBytes < 1 ||
        !Number.isSafeInteger(options.maxBytes) ||
        options.maxBytes > 4096
      )
        throw Error('Invalid public object');
      return boundedIO(async (signal) => {
        const joined = AbortSignal.any([signal, options.signal]);
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: joined,
        });
        if (r.ContentLength === undefined || r.ContentLength > options.maxBytes)
          throw Error('Invalid public object');
        return bytes(r.Body, options.maxBytes, joined);
      });
    },
  };
}
export function createEnvelopeEncryption(client: KMSClient, keyId: string) {
  function context(purpose: string, id: string) {
    if (
      !['contact', 'report_private', 'delivery_payload', 'privacy_reply'].includes(purpose) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    )
      throw Error('Invalid encryption context');
    return { app: 'tiresandtreads', purpose, resource: id };
  }
  return {
    async encrypt(plaintext: Uint8Array, purpose: string, id: string): Promise<Envelope> {
      if (plaintext.length < 1 || plaintext.length > 60000) throw Error('Invalid plaintext size');
      const EncryptionContext = context(purpose, id);
      return boundedIO(async (signal) => {
        const r = await client.send(
          new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256', EncryptionContext }),
          { abortSignal: signal },
        );
        try {
          if (
            !r.CiphertextBlob ||
            r.CiphertextBlob.length > 4096 ||
            r.Plaintext?.length !== 32 ||
            r.KeyId !== keyId
          )
            throw Error('Invalid encryption');
          const iv = randomBytes(12),
            cipher = createCipheriv('aes-256-gcm', r.Plaintext, iv);
          cipher.setAAD(Buffer.from(JSON.stringify(EncryptionContext)));
          const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]),
            header = Buffer.alloc(3);
          header[0] = 1;
          header.writeUInt16BE(r.CiphertextBlob.length, 1);
          return {
            keyVersion: keyId,
            hex: Buffer.concat([
              header,
              r.CiphertextBlob,
              iv,
              cipher.getAuthTag(),
              encrypted,
            ]).toString('hex'),
          };
        } finally {
          r.Plaintext?.fill(0);
        }
      });
    },
    async decrypt(envelope: Envelope, purpose: string, id: string): Promise<Uint8Array> {
      if (envelope.keyVersion !== keyId || !/^(?:[a-f0-9]{2}){16,65536}$/.test(envelope.hex))
        throw Error('Invalid envelope');
      const EncryptionContext = context(purpose, id);
      return boundedIO(async (signal) => {
        const blob = Buffer.from(envelope.hex, 'hex'),
          length = blob.readUInt16BE(1);
        if (blob[0] !== 1 || length < 1 || length > 4096 || blob.length < 3 + length + 29)
          throw Error('Invalid envelope');
        const r = await client.send(
          new DecryptCommand({
            KeyId: keyId,
            CiphertextBlob: blob.subarray(3, 3 + length),
            EncryptionContext,
          }),
          { abortSignal: signal },
        );
        try {
          if (r.Plaintext?.length !== 32 || r.KeyId !== keyId) throw Error('Invalid decryption');
          const start = 3 + length,
            decipher = createDecipheriv(
              'aes-256-gcm',
              r.Plaintext,
              blob.subarray(start, start + 12),
            );
          decipher.setAAD(Buffer.from(JSON.stringify(EncryptionContext)));
          decipher.setAuthTag(blob.subarray(start + 12, start + 28));
          const plain = Buffer.concat([
            decipher.update(blob.subarray(start + 28)),
            decipher.final(),
          ]);
          if (plain.length > 60000) throw Error('Invalid envelope');
          return new Uint8Array(plain);
        } finally {
          r.Plaintext?.fill(0);
        }
      });
    },
  };
}
