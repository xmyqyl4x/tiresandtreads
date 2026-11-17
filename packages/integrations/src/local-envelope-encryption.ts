import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ContactEncryption } from '../../application/src/ports/contact-services.ts';
import { deriveLocalPhase2Keys, type LocalPhase2Material } from './local-encrypted-objects.ts';
export function createLocalEnvelopeEncryption(material: LocalPhase2Material): ContactEncryption {
  const keys = Object.fromEntries(
      Object.entries(deriveLocalPhase2Keys(material, 'envelopes')).map(([k, v]) => [
        k,
        Buffer.from(v),
      ]),
    ),
    current = material.current;
  if (!keys[current] || Object.values(keys).some((k) => k.length !== 32))
    throw Error('Local envelope keys refused');
  const aad = (purpose: string, id: string) => {
    if (!/^[a-z_]{1,80}$/.test(purpose) || !/^[a-f0-9-]{36}$/.test(id))
      throw Error('Local envelope refused');
    return Buffer.from(JSON.stringify(['local-p2-envelope-v1', purpose, id]));
  };
  return {
    async encrypt(bytes, purpose, id) {
      if (bytes.length > 1048576) throw Error('Local envelope refused');
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', keys[current]!, iv);
      cipher.setAAD(aad(purpose, id));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return {
        keyVersion: current,
        hex: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('hex'),
      };
    },
    async decrypt(box, purpose, id) {
      if (!keys[box.keyVersion] || !/^[a-f0-9]{56,2097208}$/.test(box.hex) || box.hex.length % 2)
        throw Error('Local envelope refused');
      const raw = Buffer.from(box.hex, 'hex'),
        decipher = createDecipheriv('aes-256-gcm', keys[box.keyVersion]!, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      decipher.setAAD(aad(purpose, id));
      return new Uint8Array(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]));
    },
  };
}
