import { createHash, createHmac } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { id } from '../../../domain/src/values/core.ts';
import type { Id } from '../../../domain/src/values/core.ts';
import { boundedIO } from '../bounded-io.ts';
import { staffMfaMaxAgeMs, type HttpSecurity } from './core.ts';

const userId = /^user_[A-Za-z0-9_-]{1,128}$/,
  sessionId = /^sess_[A-Za-z0-9_-]{1,128}$/;
const absoluteMs = 12 * 60 * 60 * 1000,
  idleMs = 30 * 60 * 1000;
function origin(raw: string, loopback = false) {
  const u = new URL(raw);
  if (
    u.origin !== raw ||
    raw.length > 256 ||
    u.username ||
    u.password ||
    (u.protocol !== 'https:' &&
      !(
        loopback &&
        u.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
      ))
  )
    throw Error('Invalid staff identity configuration');
  return raw;
}
// A canonical pre-existing mapping key, not a grant or a provisioning operation.
export function clerkStaffSubject(issuer: string, subject: string): string {
  if (!userId.test(subject)) throw Error('Invalid staff identity');
  return 'clerk:' + createHash('sha256').update(origin(issuer)).digest('base64url') + ':' + subject;
}
export type ClerkStaffSecurityOptions =
  | { readonly enabled: false; readonly base: HttpSecurity }
  | {
      readonly enabled: true;
      readonly base: HttpSecurity;
      readonly issuer: string;
      readonly audience: string;
      readonly authorizedParties: readonly string[];
      readonly publishableKey: string;
      readonly publicKeys: readonly string[];
      readonly apiKey: () => Promise<string | null>;
      readonly csrfKey: Uint8Array;
      readonly resolve: (providerSubject: string) => Promise<Id<'staff'> | null>;
      readonly fetch?: typeof fetch;
      readonly now?: () => number;
    };
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Staff identity unavailable');
  return raw as Record<string, unknown>;
}
async function sessionJson(
  response: Response,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Staff identity unavailable');
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    if (
      response.status !== 200 ||
      response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json' ||
      Number(response.headers.get('content-length') ?? 0) > 65536
    )
      throw Error('Staff identity unavailable');
    for (;;) {
      const r = await reader.read();
      signal.throwIfAborted();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 65536) throw Error('Staff identity unavailable');
      parts.push(r.value);
    }
    return record(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))),
    );
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel();
  }
}
export function withClerkStaffSessions(
  o: ClerkStaffSecurityOptions,
): HttpSecurity & Required<Pick<HttpSecurity, 'authenticateStaff'>> {
  const base = o.base;
  const ordinary = {
    quota: (...args: Parameters<HttpSecurity['quota']>) => base.quota(...args),
    authenticate: (request: Request) => base.authenticate(request),
  };
  if (!o.enabled) return { ...ordinary, authenticateStaff: async () => null };
  const issuer = origin(o.issuer),
    parties = o.authorizedParties.map((v) => origin(v, true)),
    keys = [...o.publicKeys],
    csrf = Buffer.from(o.csrfKey),
    audience = o.audience,
    transport = o.fetch ?? globalThis.fetch,
    now = o.now ?? Date.now,
    resolve = o.resolve,
    apiKey = o.apiKey;
  if (
    !/^[A-Za-z0-9:._-]{1,120}$/.test(audience) ||
    parties.length < 1 ||
    parties.length > 4 ||
    new Set(parties).size !== parties.length ||
    keys.length < 1 ||
    keys.length > 4 ||
    new Set(keys).size !== keys.length ||
    keys.some(
      (k) =>
        k.length > 16384 ||
        !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(
          k,
        ),
    ) ||
    csrf.length < 32 ||
    csrf.length > 128 ||
    !/^pk_(?:test|live)_[A-Za-z0-9_+/=-]{1,300}$/.test(o.publishableKey)
  )
    throw Error('Invalid staff identity configuration');
  const clients = keys.map((key) => ({
    key,
    client: createClerkClient({ publishableKey: o.publishableKey, telemetry: { disabled: true } }),
  }));
  return {
    ...ordinary,
    async authenticateStaff(request) {
      const authorization = request.headers.get('authorization'),
        token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!token.includes('.')) return null;
      if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
        return null;
      try {
        return await boundedIO(async (signal) => {
          const secret = await apiKey();
          signal.throwIfAborted();
          if (!secret || !/^sk_(?:test|live)_[A-Za-z0-9_-]{1,300}$/.test(secret)) return null;
          for (const { key, client } of clients) {
            signal.throwIfAborted();
            const verified = await client.authenticateRequest(
              new Request(request.url, { headers: { authorization: 'Bearer ' + token } }),
              {
                secretKey: secret,
                jwtKey: key,
                issuer,
                audience,
                authorizedParties: parties,
                acceptsToken: 'session_token',
                clockSkewInMs: 0,
              },
            );
            signal.throwIfAborted();
            if (!verified.isAuthenticated) continue;
            const auth = verified.toAuth(),
              claims = record(auth.sessionClaims),
              stamp = now(),
              factor = claims.fva;
            if (
              auth.tokenType !== 'session_token' ||
              !auth.userId ||
              !userId.test(auth.userId) ||
              !auth.sessionId ||
              !sessionId.test(auth.sessionId) ||
              auth.userId !== claims.sub ||
              auth.sessionId !== claims.sid ||
              claims.v !== 2 ||
              claims.iss !== issuer ||
              !parties.includes(String(claims.azp)) ||
              (claims.sts !== undefined && claims.sts !== 'active') ||
              auth.actor ||
              auth.agent ||
              !Array.isArray(factor) ||
              factor.length !== 2 ||
              !factor.every((age) => Number.isSafeInteger(age) && age >= 0) ||
              typeof claims.iat !== 'number' ||
              typeof claims.exp !== 'number' ||
              !Number.isSafeInteger(claims.iat) ||
              claims.iat < 0 ||
              !Number.isSafeInteger(claims.exp) ||
              claims.exp <= claims.iat
            )
              return null;
            // fva is rounded to minutes: use the earliest possible verification time, never add grace.
            const mfaAt = claims.iat * 1000 - (Number(factor[1]) + 1) * 60000;
            if (!Number.isSafeInteger(stamp) || mfaAt > stamp || stamp - mfaAt > staffMfaMaxAgeMs)
              return null;
            const staff = await resolve(clerkStaffSubject(issuer, auth.userId));
            signal.throwIfAborted();
            if (!staff || !id('staff', staff).ok) return null;
            const state = await sessionJson(
              await transport('https://api.clerk.com/v1/sessions/' + auth.sessionId, {
                method: 'GET',
                redirect: 'error',
                credentials: 'omit',
                cache: 'no-store',
                signal,
                headers: { authorization: 'Bearer ' + secret, accept: 'application/json' },
              }),
              signal,
            );
            signal.throwIfAborted();
            const at = now(),
              created = state.created_at,
              last = state.last_active_at,
              expire = state.expire_at,
              abandon = state.abandon_at;
            if (
              state.object !== 'session' ||
              state.id !== auth.sessionId ||
              state.user_id !== auth.userId ||
              state.status !== 'active' ||
              (state.actor !== undefined && state.actor !== null) ||
              ![at, created, last, expire, abandon].every(
                (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
              ) ||
              typeof created !== 'number' ||
              typeof last !== 'number' ||
              typeof expire !== 'number' ||
              typeof abandon !== 'number' ||
              at < stamp ||
              mfaAt > at ||
              claims.iat * 1000 > at ||
              created > at ||
              last < created ||
              last > at ||
              at - created > absoluteMs ||
              at - last > idleMs ||
              expire <= at ||
              abandon <= at ||
              claims.exp * 1000 <= at ||
              at - mfaAt > staffMfaMaxAgeMs
            )
              return null;
            return {
              keys: [],
              staff,
              mfaAt,
              csrf: createHmac('sha256', csrf)
                .update(
                  'clerk-staff-csrf:v1\0' + JSON.stringify([issuer, auth.userId, auth.sessionId]),
                )
                .digest('hex'),
            };
          }
          return null;
        }, 3000);
      } catch {
        return null;
      }
    },
  };
}
