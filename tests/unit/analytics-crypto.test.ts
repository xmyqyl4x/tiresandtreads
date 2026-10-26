import { it, expect } from 'vitest';
import {
  createCollectionCrypto,
  createQuotaCrypto,
} from '../../packages/integrations/src/analytics-crypto.ts';
import type { CollectionGrant } from '../../packages/application/src/ports/analytics-services.ts';
import { id, instant, revision } from '../../packages/domain/src/values/core.ts';
const value = <T>(r: { ok: true; value: T } | { ok: false }) => {
  if (!r.ok) throw Error('fixture');
  return r.value;
};
const at = value(instant('2026-10-26T12:00:00.000Z')),
  grant: CollectionGrant = {
    subjectId: value(id('subject', '88888888-8888-4888-8888-888888888888')),
    sessionId: value(id('owner_session', '77777777-7777-4777-8777-777777777777')),
    permission: value(revision('2')),
    policy: 'v1',
    scope: 'site',
  };
const keys = { old: new Uint8Array(32).fill(1), next: new Uint8Array(32).fill(2) },
  identity = new Uint8Array(32).fill(3);
it('binds context to subject, current permission, scope, channel and a short expiry', () => {
  const c = createCollectionCrypto('old', keys, identity),
    raw = c.issue(grant, 'web', at),
    parsed = c.parse(raw, at);
  expect(parsed).toMatchObject({
    subjectId: grant.subjectId,
    permission: grant.permission,
    channel: 'web',
    scope: 'site',
    expiresAt: '2026-10-26T12:15:00.000Z',
  });
  expect(c.parse(raw, value(instant('2026-10-26T12:15:00.000Z')))).toBeNull();
  expect(c.parse(raw.replace(/.$/, 'z'), at)).toBeNull();
  expect(c.parse('unsubscribe.' + raw, at)).toBeNull();
  expect(c.parse('x'.repeat(2049), at)).toBeNull();
});
it('keeps the analytics session pseudonym stable across safe MAC-key overlap', () => {
  const old = createCollectionCrypto('old', keys, identity),
    next = createCollectionCrypto('next', keys, identity),
    a = old.issue(grant, 'web', at),
    b = next.issue(grant, 'web', at);
  expect(next.parse(a, at)?.sessionId).toBe(next.parse(b, at)?.sessionId);
  expect(createCollectionCrypto('next', { next: keys.next }, identity).parse(a, at)).toBeNull();
});
it('normalizes security aliases without retaining raw addresses and isolates purpose keys', () => {
  const q = createQuotaCrypto(keys);
  expect(q.keys('email', ' Driver@Example.invalid ')).toEqual(
    q.keys('email', 'driver@example.invalid'),
  );
  expect(q.keys('ip', '2001:0db8:0:0:0:0:0:1')).toEqual(q.keys('ip', '2001:db8::1'));
  expect(JSON.stringify(q.keys('ip', '192.0.2.1'))).not.toContain('192.0.2.1');
  for (const value of ['arbitrary', '192.0.2.1, 198.51.100.1', 'https://ip.invalid'])
    expect(() => q.keys('ip', value)).toThrow();
  expect(() => q.keys('email', 'bad')).toThrow();
});
it('refuses missing, weak or oversized key rings', () => {
  for (const bad of [{}, { weak: new Uint8Array(2) }, { 'bad version': identity }])
    expect(() => createQuotaCrypto(bad)).toThrow();
  expect(() => createCollectionCrypto('missing', keys, identity)).toThrow();
  expect(() => createCollectionCrypto('old', keys, new Uint8Array(1))).toThrow();
});
