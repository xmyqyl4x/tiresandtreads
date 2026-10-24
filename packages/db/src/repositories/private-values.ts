import type {
  Envelope,
  KeyDigest,
  Owner,
  JsonObject,
} from '../../../application/src/ports/private-records.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import {
  id,
  instant,
  revision,
  type Id,
  type Instant,
  type Revision,
} from '../../../domain/src/values/index.ts';
import { boundedJson, reject } from './bounds.ts';

import { stop, type WriteScope } from './mutations.ts';
export type Row = Record<string, unknown>;
export function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    return reject();
  return value;
}
export function hex(value: unknown, min = 32, max = min): Buffer {
  if (
    typeof value !== 'string' ||
    !/^(?:[a-f0-9]{2})+$/.test(value) ||
    value.length < min * 2 ||
    value.length > max * 2
  )
    return reject();
  return Buffer.from(value, 'hex');
}
export function digestKeys(keys: readonly KeyDigest[]) {
  if (
    !Array.isArray(keys) ||
    keys.length < 1 ||
    keys.length > 4 ||
    new Set(keys.map((k) => k.keyVersion)).size !== keys.length
  )
    return reject();
  return keys.map((k) => ({
    key_version: text(k.keyVersion, 100),
    digest: hex(k.digest).toString('hex'),
  }));
}
export function envelope(value: Envelope): Buffer {
  text(value.keyVersion, 100);
  return hex(value.hex, 16, 65536);
}
export function jsonObject(value: unknown, limit: number): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject();
  return boundedJson(value, limit);
}
export function rid<K extends string>(kind: K, value: unknown): Id<K> {
  const r = id(kind, value);
  if (!r.ok) return stop('integrity');
  return r.value;
}
export function rev(value: unknown): Revision {
  const r = revision(value);
  if (!r.ok) return stop('integrity');
  return r.value;
}
export function stamp(value: unknown): Instant {
  const r = instant(value instanceof Date ? value.toISOString() : value);
  if (!r.ok) return stop('integrity');
  return r.value;
}
export function obj(value: unknown, limit = 65536): JsonObject {
  return JSON.parse(jsonObject(value, limit)) as JsonObject;
}
export function integer(value: unknown, min = 1): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > 2147483647
  )
    return reject();
  return value;
}
export function one(rows: readonly Row[]): Row {
  if (rows.length !== 1) return stop('conflict');
  return rows[0]!;
}
export function keyJson(keys: readonly KeyDigest[]): string {
  return JSON.stringify(digestKeys(keys));
}
// All private writers acquire subject guards before report/send rows. Multi-subject services
// predeclare the complete sorted set with this helper before composing repositories.
export async function lockSubjects(
  scope: WriteScope,
  tx: Tx,
  ids: readonly string[],
): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  const r = await scope.query(
    tx,
    'SELECT id FROM app.subjects WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [sorted],
  );
  if (r.rows.length !== sorted.length) stop('not_found');
}
export async function ownerGuard(scope: WriteScope, tx: Tx, owner: Owner): Promise<void> {
  await lockSubjects(scope, tx, [owner.subjectId]);
  const r = await scope.query(
    tx,
    `SELECT s.id FROM app.subjects s JOIN app.owner_sessions o ON o.subject_id=s.id
    WHERE s.id=$1 AND o.id=$2 AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    AND o.expires_at>clock_timestamp() AND o.revoked_at IS NULL`,
    [owner.subjectId, owner.sessionId],
  );
  if (!r.rows.length) stop('forbidden');
}
export async function reportGuard(
  scope: WriteScope,
  tx: Tx,
  owner: Owner,
  reportId: string,
): Promise<Row> {
  await ownerGuard(scope, tx, owner);
  const r = await scope.query(
    tx,
    `SELECT id,owner_subject_id,status,current_version,revision,expires_at FROM app.reports
    WHERE id=$1 AND owner_subject_id=$2 AND status<>'pending_deletion' AND expires_at>clock_timestamp() FOR UPDATE`,
    [reportId, owner.subjectId],
  );
  if (!r.rows.length) return stop('not_found');
  return r.rows[0]!;
}
