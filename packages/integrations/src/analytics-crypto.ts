import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeEmail } from '../../domain/src/contact-policy.ts';
import { id, instant, revision, type Id } from '../../domain/src/values/core.ts';
import type {
  CollectionCrypto,
  QuotaCrypto,
  CollectionContext,
} from '../../application/src/ports/analytics-services.ts';
function ring(keys: Readonly<Record<string, Uint8Array>>) {
  const copy = Object.fromEntries(Object.entries(keys).map(([v, k]) => [v, Buffer.from(k)]));
  if (
    Object.keys(copy).length < 1 ||
    Object.keys(copy).length > 4 ||
    Object.entries(copy).some(([v, k]) => !/^[A-Za-z0-9_-]{1,80}$/.test(v) || k.length < 32)
  )
    throw Error('Invalid analytics keys');
  return copy;
}
export function createCollectionCrypto(
  current: string,
  keys: Readonly<Record<string, Uint8Array>>,
  identityKey: Uint8Array,
): CollectionCrypto {
  const versions = ring(keys);
  if (!Object.hasOwn(versions, current)) throw Error('Invalid analytics keys');
  if (identityKey.length < 32) throw Error('Invalid analytics keys');
  const stable = Buffer.from(identityKey);
  const mac = (version: string, value: string) =>
    createHmac('sha256', versions[version]!)
      .update('collection:v1\0' + value)
      .digest('hex');
  return {
    issue(grant, channel, at) {
      const hash = createHmac('sha256', stable)
        .update('analytics-session:v1\0' + grant.sessionId + ':' + grant.policy)
        .digest('hex')
        .slice(0, 32);
      const sessionId =
        `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}` as Id<'analytics_session'>;
      const value = {
        subjectId: grant.subjectId,
        permission: grant.permission.toString(),
        scope: grant.scope,
        policy: grant.policy,
        sessionId,
        market: 'US',
        locale: 'en-US',
        channel,
        issuedAt: at,
        expiresAt: new Date(Date.parse(at) + 900000).toISOString(),
      };
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return `analytics.${current}.${body}.${mac(current, body)}`;
    },
    parse(raw, at) {
      if (typeof raw !== 'string' || raw.length > 2048 || !instant(at).ok) return null;
      const p = raw.split('.'),
        version = p[1]!,
        body = p[2]!;
      if (
        p.length !== 4 ||
        p[0] !== 'analytics' ||
        !Object.hasOwn(versions, version) ||
        !/^[A-Za-z0-9_-]+$/.test(body) ||
        !/^[a-f0-9]{64}$/.test(p[3]!)
      )
        return null;
      if (!timingSafeEqual(Buffer.from(mac(version, body)), Buffer.from(p[3]!))) return null;
      let x: Record<string, unknown>;
      try {
        x = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
      const subject = id('subject', x.subjectId),
        session = id('analytics_session', x.sessionId),
        permission = revision(x.permission),
        issued = instant(x.issuedAt),
        expires = instant(x.expiresAt);
      if (
        !subject.ok ||
        !session.ok ||
        !permission.ok ||
        !issued.ok ||
        !expires.ok ||
        x.scope !== 'site' ||
        typeof x.policy !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(x.policy) ||
        x.market !== 'US' ||
        x.locale !== 'en-US' ||
        !['web', 'app', 'mcp'].includes(String(x.channel)) ||
        Date.parse(expires.value) <= Date.parse(at) ||
        Date.parse(issued.value) > Date.parse(at) + 300000 ||
        Date.parse(expires.value) - Date.parse(issued.value) !== 900000
      )
        return null;
      return {
        subjectId: subject.value,
        sessionId: session.value,
        permission: permission.value,
        issuedAt: issued.value,
        expiresAt: expires.value,
        scope: 'site',
        policy: x.policy,
        market: 'US',
        locale: 'en-US',
        channel: x.channel as CollectionContext['channel'],
      };
    },
  };
}
export function createQuotaCrypto(keys: Readonly<Record<string, Uint8Array>>): QuotaCrypto {
  const versions = ring(keys);
  return {
    versions: Object.freeze(Object.keys(versions).sort()),
    keys(kind, value) {
      let normalized: string;
      if (kind === 'email') normalized = normalizeEmail(value).toLowerCase();
      else {
        if (kind !== 'ip' || typeof value !== 'string' || !isIP(value))
          throw Error('Invalid quota principal');
        normalized = isIP(value) === 6 ? new URL('http://[' + value + ']').hostname : value;
      }
      return Object.keys(versions)
        .sort()
        .map((version) => ({
          keyVersion: version,
          digest: createHmac('sha256', versions[version]!)
            .update('security-quota:v1\0' + kind + '\0' + normalized)
            .digest('hex'),
        }));
    },
  };
}
