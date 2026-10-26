import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { PublicSnapshots } from '../../application/src/ports/content-services.ts';
import type { PublicObjectReader } from '../../application/src/ports/publication.ts';
import { boundedIO } from './bounded-io.ts';
const valid = (key: string) => /^public-(config|redirects)\/[1-9][0-9]{0,9}\.json$/.test(key);
export function createPublicSnapshots(
  client: S3Client,
  bucket: string,
): PublicSnapshots & PublicObjectReader {
  const reader: PublicObjectReader = {
    async get(key, o) {
      if (!valid(key) || !Number.isSafeInteger(o.maxBytes) || o.maxBytes < 1 || o.maxBytes > 65536)
        throw Error('Invalid public snapshot');
      return boundedIO(async (signal) => {
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: AbortSignal.any([signal, o.signal]),
        });
        if (r.ContentLength === undefined || r.ContentLength > o.maxBytes || !r.Body)
          throw Error('Invalid public snapshot');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > o.maxBytes) throw Error('Invalid public snapshot');
          chunks.push(chunk);
        }
        return new Uint8Array(Buffer.concat(chunks));
      });
    },
  };
  return {
    ...reader,
    async put(key, bytes) {
      if (!valid(key) || bytes.byteLength < 2 || bytes.byteLength > 65536)
        throw Error('Invalid public snapshot');
      await boundedIO(async (signal) => {
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: bytes,
              ContentType: 'application/json',
              CacheControl: 'public,max-age=30',
              IfNoneMatch: '*',
            }),
            { abortSignal: signal },
          );
        } catch {
          const found = await reader.get(key, { maxBytes: 65536, signal });
          if (!Buffer.from(found).equals(Buffer.from(bytes)))
            throw Error('Conflicting public snapshot');
        }
      });
    },
  };
}
