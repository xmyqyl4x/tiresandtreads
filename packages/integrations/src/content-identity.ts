import { createHash, randomUUID } from 'node:crypto';
import type { ContentIdentity } from '../../application/src/ports/content-services.ts';
import { canonical } from '../../application/src/services/service-records.ts';
import type { Id } from '../../domain/src/values/core.ts';
export const contentIdentity: ContentIdentity = Object.freeze({
  id: <K extends string>(kind: K) => {
    if (!kind || kind.length > 100) throw Error('Invalid resource kind');
    return randomUUID() as Id<K>;
  },
  checksum: (value: unknown) => createHash('sha256').update(canonical(value, 262144)).digest('hex'),
});
