import type {
  MailProvider,
  FrozenDelivery,
} from '../../application/src/ports/delivery-services.ts';
import { validateMail } from '../../domain/src/delivery-policy.ts';
import { normalizeEmail } from '../../domain/src/contact-policy.ts';
import { boundedIO } from './bounded-io.ts';
const endpoint = 'https://api.resend.com';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createResendProvider(o: {
  readonly enabled: boolean;
  readonly senderAddresses: readonly string[];
  readonly apiKey: () => Promise<string | null>;
}): MailProvider & {
  retrieve(id: string): Promise<Readonly<{ id: string; event: string }> | null>;
} {
  const addresses = new Set(o.senderAddresses.map(normalizeEmail));
  async function call(path: string, method: 'GET' | 'POST', body?: string, key?: string) {
    if (!o.enabled) throw Error('Mail provider unavailable');
    return boundedIO(async (signal) => {
      const secret = await o.apiKey();
      if (!secret || /[\r\n]/.test(secret)) throw Error('Mail provider unavailable');
      const response = await fetch(endpoint + path, {
        method,
        redirect: 'error',
        signal,
        headers: {
          Authorization: 'Bearer ' + secret,
          ...(method === 'POST'
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': key! }
            : {}),
        },
        ...(body === undefined ? {} : { body }),
      });
      if (Number(response.headers.get('content-length') ?? 0) > 65536)
        throw Error('Mail provider unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw Error('Mail provider unavailable');
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > 65536) throw Error('Mail provider unavailable');
          parts.push(r.value);
        }
      } finally {
        await reader.cancel();
      }
      const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
      return { status: response.status, value };
    }, 5000);
  }
  function payload(p: FrozenDelivery, key: string) {
    validateMail(p.mail);
    if (
      p.schemaVersion !== 1 ||
      p.mail.fixture ||
      p.mail.commercial ||
      p.recipient !== normalizeEmail(p.recipient) ||
      /[\r\n]/.test(p.from)
    )
      throw Error('Mail provider unavailable');
    const match = /^(?:[^<>\r\n]{1,100} <)?([^<>\s]+@[^<>\s]+)>?$/.exec(p.from);
    if (!match || !addresses.has(normalizeEmail(match[1]!)))
      throw Error('Mail provider unavailable');
    return JSON.stringify({
      from: p.from,
      to: [p.recipient],
      subject: p.mail.subject,
      html: p.mail.html,
      text: p.mail.text,
      tags: [{ name: 'tt_delivery_key', value: key }],
      attachments: [
        { filename: 'report.pdf', content: p.mail.pdf, content_type: 'application/pdf' },
      ],
    });
  }
  return {
    name: 'resend',
    fixture: false,
    async send(key, p) {
      if (!o.enabled || !/^[a-f0-9]{64}$/.test(key)) throw Error('Mail provider unavailable');
      const body = payload(p, key);
      try {
        const r = await call('/emails', 'POST', body, key);
        if (
          r.status >= 200 &&
          r.status < 300 &&
          typeof r.value.id === 'string' &&
          uuid.test(r.value.id)
        )
          return { outcome: 'accepted', messageId: r.value.id };
        if ([400, 401, 403, 404, 422].includes(r.status))
          return { outcome: 'definitive_rejection', messageId: null };
        return { outcome: 'uncertain', messageId: null };
      } catch {
        return { outcome: 'uncertain', messageId: null };
      }
    },
    async retrieve(id) {
      if (!uuid.test(id)) throw Error('Mail provider unavailable');
      const r = await call('/emails/' + id, 'GET');
      if (r.status === 404) return null;
      if (r.status !== 200 || r.value.id !== id) throw Error('Mail provider unavailable');
      const event =
        typeof r.value.last_event === 'string' &&
        [
          'sent',
          'delivered',
          'delivery_delayed',
          'bounced',
          'complained',
          'opened',
          'clicked',
          'failed',
          'scheduled',
          'canceled',
        ].includes(r.value.last_event)
          ? r.value.last_event
          : 'unknown';
      return { id, event };
    },
  };
}
