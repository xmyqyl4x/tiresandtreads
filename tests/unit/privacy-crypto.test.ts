import { expect, it } from 'vitest';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
const key = new Uint8Array(32).fill(23);
it('separates request proofs, journal signatures and resource markers with rotation coverage', () => {
  const c = createPrivacyCrypto('v1', { v1: key });
  const id = c.id('privacy_request');
  const token = c.proof(id, 'v1');
  expect(c.parse(token.raw)).toEqual({ id, key: token.key });
  expect(c.parse(token.raw.replace('privacy.', 'verify.'))).toBeNull();
  expect(c.parse(token.raw.slice(0, -1) + (token.raw.endsWith('0') ? '1' : '0'))).toBeNull();
  const doc = { version: 1, capturedAt: '2026-10-26T12:00:00.000Z', entries: [] };
  const signed = c.sign(doc);
  expect(c.verify(signed)).toEqual(doc);
  expect(c.verify({ ...signed, document: { ...doc, version: 2 } })).toBeNull();
  const rotated = createPrivacyCrypto('v2', { v1: key, v2: new Uint8Array(32).fill(24) });
  expect(rotated.parse(token.raw)).toEqual({ id, key: token.key });
  expect(rotated.markers('subject', id)).toHaveLength(2);
  expect(c.markers('subject', id)).not.toEqual(c.markers('report', id));
});
