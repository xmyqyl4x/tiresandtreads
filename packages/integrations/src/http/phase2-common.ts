import { createHmac, createHash } from 'node:crypto';
import { z } from '../../../contracts/src/phase2-partners.ts';
import { id, revision, ok, type Result } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type { ApplicationFailure } from '../../../application/src/ports/transactions.ts';
import { HttpFailure, type HttpContext, type HttpRoute } from './core.ts';
export interface P2HttpAdmission {
  claim(commandHash: string, fingerprint: string): Promise<boolean>;
}
export function p2Id<K extends string>(kind: K, value: unknown) {
  const r = id(kind, value);
  if (!r.ok) throw new HttpFailure(400, 'invalid_input');
  return r.value;
}
export function p2Rev(value: unknown) {
  const r = revision(value);
  if (!r.ok) throw new HttpFailure(400, 'invalid_input');
  return r.value;
}
export function p2Parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpFailure(400, 'invalid_input');
  return r.data;
}
export function p2Query<T>(c: HttpContext, schema: z.ZodType<T>): T {
  return p2Parse(schema, Object.fromEntries(c.query));
}
export function p2Project(
  result: Result<unknown, ApplicationFailure>,
  fields: readonly string[],
): Result<unknown, ApplicationFailure> {
  if (!result.ok)
    return result.error.code === 'integrity' ? { ok: false, error: failure('conflict') } : result;
  const source = result.value;
  if (Array.isArray(source))
    return ok({
      items: source.map((value) => {
        const r = p2Project(ok(value), fields);
        return r.ok ? r.value : null;
      }),
    });
  if (source === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof source))
    return ok({ value: source });
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const parts = field.split('.');
    let value: unknown = source;
    for (const p of parts)
      value =
        value && typeof value === 'object' ? (value as Record<string, unknown>)[p] : undefined;
    if (value !== undefined) {
      let target = out;
      for (const p of parts.slice(0, -1)) target = (target[p] ??= {}) as Record<string, unknown>;
      target[parts.at(-1)!] = value;
    }
  }
  return ok(out);
}
function canonical(v: unknown): string {
  if (v instanceof Uint8Array) return 'bytes:' + createHash('sha256').update(v).digest('hex');
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
export function p2Commands(admission: P2HttpAdmission, secret: Uint8Array) {
  if (secret.length < 32) throw Error('HTTP command key required');
  const key = Buffer.from(secret);
  const hash = (purpose: string, value: string) =>
    createHmac('sha256', key)
      .update(purpose + '\0' + value)
      .digest('hex');
  return {
    id(c: HttpContext) {
      const h = hash(
        'p2-command-id',
        (c.actor?.partner?.subject ?? c.actor?.staff ?? c.actor?.keys[0]?.digest ?? '') +
          '\0' +
          c.key,
      );
      return (
        h.slice(0, 8) +
        '-' +
        h.slice(8, 12) +
        '-4' +
        h.slice(13, 16) +
        '-a' +
        h.slice(17, 20) +
        '-' +
        h.slice(20, 32)
      );
    },
    async execute(
      c: HttpContext,
      operation: string,
      input: unknown,
      work: () => Promise<Result<unknown, ApplicationFailure>>,
    ) {
      const actor = c.actor?.partner?.subject ?? c.actor?.staff ?? c.actor?.keys[0]?.digest;
      if (!actor) throw new HttpFailure(401, 'unauthorized');
      const command = hash('p2-http-admission', actor + '\0' + operation + '\0' + c.key),
        fingerprint = hash(
          'p2-http-body',
          canonical({ params: c.params, query: Object.fromEntries(c.query), input }),
        );
      // A duplicate (including an unknown outcome) is reconciled by an authorized status read.
      // Never replay a cached authorization decision or blindly repeat an uncertain effect.
      if (!(await admission.claim(command, fingerprint))) throw new HttpFailure(409, 'conflict');
      return work();
    },
  };
}
export function p2Route(
  contract: Omit<HttpRoute, 'handle'>,
  handle: HttpRoute['handle'],
): HttpRoute {
  return { ...contract, handle };
}
