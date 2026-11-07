import { it, expect } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createAnalysisReferenceEncryption } from '../../packages/integrations/src/analysis-reference-encryption.ts';
import type { ContactEncryption } from '../../packages/application/src/ports/contact-services.ts';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  purpose = 'analysis_provider_object';
function base(keyVersion: string): ContactEncryption {
  const key = randomBytes(32);
  return {
    async encrypt(b, p, id) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(p + id));
      const bytes = Buffer.concat([c.update(b), c.final()]);
      return { keyVersion, hex: Buffer.concat([iv, c.getAuthTag(), bytes]).toString('hex') };
    },
    async decrypt(e, p, id) {
      const b = Buffer.from(e.hex, 'hex'),
        c = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      c.setAAD(Buffer.from(p + id));
      c.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([c.update(b.subarray(28)), c.final()]);
    },
  };
}
it('separates reference context from an ordinary report envelope and rotates old decryption keys', async () => {
  const v1 = base('v1'),
    v2 = base('v2'),
    a = createAnalysisReferenceEncryption('v1', { v1 }),
    bytes = new TextEncoder().encode('file_synthetic_only'),
    e = await a.encrypt(bytes, purpose, id),
    b = createAnalysisReferenceEncryption('v2', { v1, v2 });
  expect(await b.decrypt(e, purpose, id)).toEqual(bytes);
  expect((await b.encrypt(bytes, purpose, id)).keyVersion).toBe('v2');
  await expect(v1.decrypt(e, 'report_private', id)).rejects.toThrow();
  await expect(b.decrypt(e, purpose, other)).rejects.toThrow();
});
it.each(['report_private', 'contact', '', 'photo'])('rejects unrelated purpose %s', async (p) => {
  const a = createAnalysisReferenceEncryption('v1', { v1: base('v1') });
  await expect(a.encrypt(new Uint8Array([1]), p, id)).rejects.toThrow();
});
it.each([0, 257])('bounds provider reference plaintext at %s bytes', async (n) => {
  const a = createAnalysisReferenceEncryption('v1', { v1: base('v1') });
  await expect(a.encrypt(new Uint8Array(n), purpose, id)).rejects.toThrow();
});
it('refuses unknown keys, malformed IDs and a mismatching underlying adapter', async () => {
  const a = createAnalysisReferenceEncryption('v1', { v1: base('v2') });
  await expect(a.encrypt(new Uint8Array([1]), purpose, id)).rejects.toThrow();
  await expect(a.encrypt(new Uint8Array([1]), purpose, 'url')).rejects.toThrow();
  await expect(a.decrypt({ keyVersion: 'v3', hex: 'ab' }, purpose, id)).rejects.toThrow();
  expect(() => createAnalysisReferenceEncryption('missing', {})).toThrow();
});
