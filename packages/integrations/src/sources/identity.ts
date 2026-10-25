import { createHash } from 'node:crypto';
import { id } from '../../../domain/src/values/core.ts';
import type { SourceIdentity } from '../../../application/src/ports/sources.ts';
export function sourceUuid<K extends string>(kind: K, key: string) {
  const bytes = createHash('sha256')
    .update('tiresandtreads:source:v1:' + kind + ':' + key)
    .digest()
    .subarray(0, 16);
  // Custom SHA-256 identity layout (UUID version 8), fixed for source mapping v1.
  bytes[6] = (bytes[6]! & 15) | 128;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex'),
    uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const parsed = id(kind, uuid);
  if (!parsed.ok) throw Error('Identity failure');
  return parsed.value;
}
export function sourceIdentity(dataset: string): SourceIdentity {
  return {
    record: (kind, key) => sourceUuid(kind, dataset + ':' + key),
    entity: (key) => sourceUuid('domain_entity', key),
  };
}
