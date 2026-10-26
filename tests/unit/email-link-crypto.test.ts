import { it, expect } from 'vitest';
import { createEmailLinkCrypto } from '../../packages/integrations/src/email-link-crypto.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { id } from '../../packages/domain/src/values/core.ts';
const identity = createContactCrypto(
  'c1',
  { c1: new Uint8Array(32).fill(1) },
  { l1: new Uint8Array(32).fill(2) },
  new Uint8Array(32).fill(3),
);
const ring = { old: new Uint8Array(32).fill(4), current: new Uint8Array(32).fill(5) };
const send = '88888888-8888-4888-8888-888888888888';
const resource = id('send', send);
if (!resource.ok) throw Error('fixture');
it('rotates link MAC keys independently and binds exact send/slot identities', () => {
  const old = createEmailLinkCrypto('old', ring, identity),
    next = createEmailLinkCrypto('current', ring, identity);
  const token = old.issue(resource.value, 'learning');
  expect(next.parse(token.raw)).toEqual({ id: token.id, key: token.key });
  expect(next.issue(resource.value, 'learning').raw).not.toBe(token.raw);
  expect(next.issue(resource.value, 'feedback').id).not.toBe(token.id);
  expect(next.parse(token.raw.replace(/.$/, 'z'))).toBeNull();
  expect(
    createEmailLinkCrypto('current', { current: ring.current }, identity).parse(token.raw),
  ).toBeNull();
});
it.each([
  '',
  'x'.repeat(257),
  'link.old.invalid.' + 'a'.repeat(64),
  'verify.old.' + send + '.' + 'a'.repeat(64),
  'link.old.' + send + '.' + 'a'.repeat(64),
])('rejects tampered or cross-audience link %s', (raw) => {
  expect(createEmailLinkCrypto('current', ring, identity).parse(raw)).toBeNull();
});
it('rejects invalid key rings', () => {
  expect(() => createEmailLinkCrypto('missing', ring, identity)).toThrow();
  expect(() => createEmailLinkCrypto('bad key', { 'bad key': ring.old }, identity)).toThrow();
  expect(() => createEmailLinkCrypto('short', { short: new Uint8Array(2) }, identity)).toThrow();
});
