import { it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyResendCallback,
  verifySvixBytes,
} from '../../packages/integrations/src/resend-webhook.ts';
import { fixedEmailDestination, mailActivity } from '../../packages/domain/src/mail-events.ts';
const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const now = '2026-10-25T12:00:00.000Z';
it('matches the published independent Svix verification vector', () => {
  // https://docs.svix.com/receiving/verifying-payloads/how
  expect(() =>
    verifySvixBytes(
      new TextEncoder().encode('{"test": 2432232314}'),
      {
        'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
        'svix-timestamp': '1614265330',
        'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      },
      ['whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'],
      new Date(1614265330 * 1000).toISOString(),
    ),
  ).not.toThrow();
});
const timestamp = String(Date.parse(now) / 1000);
const event = {
  type: 'email.delivered',
  created_at: now,
  data: {
    email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
    to: ['secret@example.invalid'],
    tags: { tt_delivery_key: 'a'.repeat(64) },
  },
};
function signed(body = JSON.stringify(event), stamp = timestamp) {
  const headers = {
    'svix-id': 'msg_fixture',
    'svix-timestamp': stamp,
    'svix-signature':
      'v1,' +
      createHmac('sha256', Buffer.alloc(32, 7))
        .update('msg_fixture.' + stamp + '.')
        .update(body)
        .digest('base64'),
  };
  return { bytes: new TextEncoder().encode(body), headers };
}
it('verifies exact signed bytes, strips addresses, preserves delivery correlation', () => {
  const r = signed();
  const result = verifyResendCallback(r.bytes, r.headers, [secret], now);
  expect(result.deliveryKey).toBe('a'.repeat(64));
  expect(result.type).toBe('delivered');
  expect(JSON.stringify(result)).not.toContain('secret@');
});
it.each(['-301', '301'])('rejects stale or future signature timestamp %s', (offset) => {
  const r = signed(undefined, String(Number(timestamp) + Number(offset)));
  expect(() => verifyResendCallback(r.bytes, r.headers, [secret], now)).toThrow();
});
it('rejects a reserialized body, wrong key and oversized body', () => {
  const r = signed();
  expect(() =>
    verifyResendCallback(
      new TextEncoder().encode(JSON.stringify(event, null, 2)),
      r.headers,
      [secret],
      now,
    ),
  ).toThrow();
  expect(() =>
    verifyResendCallback(
      r.bytes,
      r.headers,
      ['whsec_' + Buffer.alloc(32, 8).toString('base64')],
      now,
    ),
  ).toThrow();
  expect(() => verifyResendCallback(new Uint8Array(262145), r.headers, [secret], now)).toThrow();
});
it('accepts overlapping signatures and delayed events with a fresh delivery timestamp', () => {
  const r = signed(JSON.stringify({ ...event, created_at: '2026-01-01T00:00:00.000Z' }));
  expect(
    verifyResendCallback(
      r.bytes,
      { ...r.headers, 'svix-signature': 'v2,other ' + r.headers['svix-signature'] },
      [secret],
      now,
    ).occurredAt,
  ).toContain('2026-01');
});
it.each(['email.unknown', 'email.failed'])('quarantines unsupported semantics %s', (type) => {
  const r = signed(JSON.stringify({ ...event, type }));
  expect(verifyResendCallback(r.bytes, r.headers, [secret], now).type).toBe('unsupported');
});
it.each([
  'https://evil.invalid/',
  '//evil.invalid',
  '/learn/../email',
  '/learn/%2fattack',
  '/learn/good?next=x',
  '/learn/good#x',
  '/learn/\\evil',
])('rejects unsafe destinations %s', (path) => {
  expect(() => fixedEmailDestination('https://tires.example', 'education', path)).toThrow();
});
it('only permits configured origin, reviewed learning paths or feedback page', () => {
  expect(fixedEmailDestination('https://tires.example', 'education', '/learn/tread-depth')).toBe(
    'https://tires.example/learn/tread-depth',
  );
  expect(fixedEmailDestination('https://tires.example', 'feedback', '/email/feedback')).toBe(
    'https://tires.example/email/feedback',
  );
  expect(() =>
    fixedEmailDestination('http://tires.example', 'education', '/learn/tread'),
  ).toThrow();
});
it('labels scanners conservatively and never claims confirmed human activity', () => {
  expect(mailActivity('clicked', 'Proofpoint URL Scanner')).toBe('machine');
  expect(mailActivity('clicked', 'Mozilla/5.0')).toBe('suspected_human');
  expect(mailActivity('opened', 'Mozilla/5.0')).toBe('unknown');
  expect(mailActivity('clicked', null)).toBe('unknown');
});
it.each([
  ['email.clicked', { click: { userAgent: 'Mozilla/5.0' } }, 'suspected_human'],
  ['email.clicked', { click: { userAgent: 'SafeLinks scanner' } }, 'machine'],
  ['email.opened', {}, 'unknown'],
  ['email.bounced', {}, 'hard'],
  ['email.delivery_delayed', {}, 'soft'],
])('maps %s to a minimum classification', (type, data, classification) => {
  const r = signed(JSON.stringify({ ...event, type, data: { ...event.data, ...data } }));
  expect(verifyResendCallback(r.bytes, r.headers, [secret], now).classification).toBe(
    classification,
  );
});
it.each([
  'null',
  '[]',
  '{}',
  '{"type":"email.delivered","created_at":"bad","data":{}}',
  '{"type":"email.sent","created_at":"2026-10-25T12:00:00.000Z","data":{}}',
])('rejects malformed signed event %s', (body) => {
  const r = signed(body);
  expect(() => verifyResendCallback(r.bytes, r.headers, [secret], now)).toThrow();
});
it('rejects malformed headers/keys and signed invalid UTF8, with no raw-body leakage', () => {
  const r = signed();
  for (const headers of [
    { ...r.headers, 'svix-id': 'bad id' },
    { ...r.headers, 'svix-timestamp': 'invalid' },
    { ...r.headers, 'svix-signature': 'x'.repeat(2049) },
  ])
    expect(() => verifyResendCallback(r.bytes, headers, [secret], now)).toThrow();
  for (const keys of [[], [secret, secret, secret, secret, secret], ['bad'], ['whsec_YQ==']])
    expect(() => verifyResendCallback(r.bytes, r.headers, keys, now)).toThrow();
  expect(() => verifyResendCallback(r.bytes, r.headers, [secret], 'bad')).toThrow();
  const bytes = Buffer.from([255, 255]),
    headers = {
      ...r.headers,
      'svix-signature':
        'v1,' +
        createHmac('sha256', Buffer.alloc(32, 7))
          .update('msg_fixture.' + timestamp + '.')
          .update(bytes)
          .digest('base64'),
    };
  expect(() => verifyResendCallback(bytes, headers, [secret], now)).toThrow(
    'Invalid mail callback',
  );
});
it('classifies absent or oversized user agents as unknown', () => {
  expect(mailActivity('clicked', 'x'.repeat(1025))).toBe('unknown');
  expect(mailActivity('clicked', '')).toBe('unknown');
});
