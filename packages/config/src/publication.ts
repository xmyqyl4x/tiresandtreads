import { createHash } from 'node:crypto';
import type {
  PublicConfiguration,
  PublicContent,
} from '../../application/src/ports/publication.ts';

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw Error('Invalid public shape');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    throw Error('Invalid public text');
  return value;
}
export function publicContent(value: unknown): PublicContent {
  const v = object(value, ['title', 'summary', 'paragraphs']);
  if (!Array.isArray(v.paragraphs) || v.paragraphs.length > 100)
    throw Error('Invalid public paragraphs');
  const content = {
    title: text(v.title, 200),
    summary: text(v.summary, 1000),
    paragraphs: v.paragraphs.map((p) => text(p, 2000)),
  };
  if (Buffer.byteLength(JSON.stringify(content)) > 240000) throw Error('Public content too large');
  return content;
}
export function publicConfiguration(value: unknown): PublicConfiguration {
  const v = object(value, [
    'schemaVersion',
    'revision',
    'issuedAt',
    'expiresAt',
    'analytics',
    'advertising',
  ]);
  if (
    v.schemaVersion !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1 ||
    Number(v.revision) > 2147483647 ||
    typeof v.analytics !== 'boolean' ||
    typeof v.advertising !== 'boolean'
  )
    throw Error('Invalid public configuration');
  const issuedAt = text(v.issuedAt, 30),
    expiresAt = text(v.expiresAt, 30);
  for (const date of [issuedAt, expiresAt])
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date)
      throw Error('Invalid public configuration time');
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > 86400000
  )
    throw Error('Invalid public configuration lifetime');
  return {
    schemaVersion: 1,
    revision: Number(v.revision),
    issuedAt,
    expiresAt,
    analytics: v.analytics,
    advertising: v.advertising,
  };
}
// Fixed field order is the public snapshot wire format; never hash arbitrary object insertion order.
export function configurationChecksum(value: PublicConfiguration): string {
  return createHash('sha256')
    .update(JSON.stringify(publicConfiguration(value)))
    .digest('hex');
}
