import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { id } from '../../domain/src/values/core.ts';
import type { InsightsTokens } from '../../application/src/ports/partner-insights.ts';
export function createInsightsTokens(key: Uint8Array): InsightsTokens {
  if (key.length !== 32) throw Error('Invalid insights key');
  const secret = Buffer.from(key);
  return {
    issue(actor, purpose, data, now) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', secret, iv);
      c.setAAD(Buffer.from('insights:v1\0' + purpose + '\0' + actor));
      const plain = JSON.stringify({ ...data, issued: now, until: now + 900000 });
      return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]).toString('base64url');
    },
    parse(actor, purpose, token, now) {
      try {
        if (
          typeof token !== 'string' ||
          token.length > 1024 ||
          !/^[A-Za-z0-9_-]+$/.test(token) ||
          !Number.isFinite(now)
        )
          return null;
        const bytes = Buffer.from(token, 'base64url');
        if (bytes.length < 29) return null;
        const d = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
        d.setAAD(Buffer.from('insights:v1\0' + purpose + '\0' + actor));
        d.setAuthTag(bytes.subarray(-16));
        const data = JSON.parse(
            Buffer.concat([d.update(bytes.subarray(12, -16)), d.final()]).toString('utf8'),
          ),
          subject = id('subject', data.subject);
        return subject.ok &&
          typeof data.week === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(data.week) &&
          Number.isFinite(data.issued) &&
          data.issued <= now &&
          data.until === data.issued + 900000 &&
          data.until > now
          ? Object.freeze({ subject: subject.value, week: data.week })
          : null;
      } catch {
        return null;
      }
    },
  };
}
