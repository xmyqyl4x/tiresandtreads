import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { instant } from '../../domain/src/values/core.ts';
import { mailActivity } from '../../domain/src/mail-events.ts';
import type { MailObservation } from '../../application/src/ports/mail-events.ts';
const reject = (): never => {
  throw Error('Invalid mail callback');
};
// Svix's documented v1 HMAC scheme; raw bytes are never decoded/reserialized before verification.
export function verifySvixBytes(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
  now: string,
): void {
  const message = headers['svix-id'],
    stamp = headers['svix-timestamp'],
    signatures = headers['svix-signature'];
  const received = instant(now);
  if (
    !received.ok ||
    bytes.length < 2 ||
    bytes.length > 262144 ||
    !message ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(message) ||
    !stamp ||
    !/^[0-9]{1,12}$/.test(stamp) ||
    !signatures ||
    signatures.length > 2048 ||
    secrets.length < 1 ||
    secrets.length > 4 ||
    Math.abs(Date.parse(now) / 1000 - Number(stamp)) > 300
  )
    reject();
  let valid = false;
  for (const secret of secrets) {
    if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) reject();
    const key = Buffer.from(secret.slice(6), 'base64');
    if (key.length < 24 || key.length > 64) reject();
    const expected = createHmac('sha256', key)
      .update(message + '.' + stamp + '.')
      .update(bytes)
      .digest();
    for (const part of signatures!.split(' ')) {
      if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(part)) continue;
      valid = timingSafeEqual(expected, Buffer.from(part.slice(3), 'base64')) || valid;
    }
  }
  if (!valid) reject();
}
export function verifyResendCallback(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
  now: string,
): MailObservation {
  verifySvixBytes(bytes, headers, secrets, now);
  const received = instant(now),
    message = headers['svix-id'];
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return reject();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) reject();
  const occurred = instant(body.created_at),
    data = body.data as Record<string, unknown> | undefined;
  if (
    !occurred.ok ||
    Date.parse(occurred.value) > Date.parse(now) + 300000 ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  )
    reject();
  const types = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delayed',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
  } as const;
  const type =
    typeof body.type === 'string' && Object.hasOwn(types, body.type)
      ? types[body.type as keyof typeof types]
      : 'unsupported';
  const id =
    typeof data!.email_id === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data!.email_id)
      ? data!.email_id
      : null;
  if (type !== 'unsupported' && !id) reject();
  const tags = data!.tags as Record<string, unknown> | undefined,
    key = tags?.tt_delivery_key;
  const click = data!.click as Record<string, unknown> | undefined;
  return {
    eventId: message!,
    digest: createHash('sha256').update(bytes).digest('hex'),
    messageId: id,
    deliveryKey: typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? key : null,
    type,
    classification:
      type === 'bounced'
        ? 'hard'
        : type === 'delayed'
          ? 'soft'
          : mailActivity(type, click?.userAgent),
    occurredAt: occurred.ok ? occurred.value : reject(),
    receivedAt: received.ok ? received.value : reject(),
  };
}
