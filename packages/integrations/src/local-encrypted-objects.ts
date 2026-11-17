import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, lstat, link, unlink, opendir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PrivateObjects, AssetLocation } from '../../application/src/ports/assets.ts';
const maximum = 16 * 1024 * 1024;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function read(path: string, limit: number) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size > limit) throw Error('Private material refused');
    return await f.readFile();
  } finally {
    await f.close();
  }
}
export interface LocalPhase2Material {
  readonly current: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
  readonly lookup: Uint8Array;
}
// Stable purpose separation; no replacement material is generated at startup.
export function deriveLocalPhase2Keys(material: LocalPhase2Material, purpose: string) {
  if (!/^[a-z-]{1,40}$/.test(purpose)) throw Error('Local key purpose refused');
  return Object.fromEntries(
    Object.entries(material.keys).map(([version, key]) => [
      version,
      createHmac('sha256', key)
        .update('tt-local-phase2-key:v1\0' + purpose)
        .digest(),
    ]),
  );
}
// Existing explicit custody only. Startup never silently creates replacement keys.
export async function readLocalPhase2Material(path: string): Promise<LocalPhase2Material> {
  try {
    if (!isAbsolute(path)) throw Error('Private material refused');
    const value: unknown = JSON.parse((await read(path, 16384)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Private material refused');
    const x = value as Record<string, unknown>;
    if (
      Object.keys(x).sort().join(',') !== 'current,keys,lookup' ||
      typeof x.current !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,39}$/.test(x.current) ||
      typeof x.lookup !== 'string' ||
      !/^[a-f0-9]{64}$/.test(x.lookup) ||
      !x.keys ||
      typeof x.keys !== 'object' ||
      Array.isArray(x.keys)
    )
      throw Error('Private material refused');
    const entries = Object.entries(x.keys);
    if (
      entries.length < 1 ||
      entries.length > 4 ||
      !Object.hasOwn(x.keys, x.current) ||
      entries.some(
        ([k, v]) =>
          !/^[a-z][a-z0-9_-]{0,39}$/.test(k) || typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v),
      )
    )
      throw Error('Private material refused');
    return {
      current: x.current,
      keys: Object.freeze(
        Object.fromEntries(entries.map(([k, v]) => [k, Buffer.from(String(v), 'hex')])),
      ),
      lookup: Buffer.from(x.lookup, 'hex'),
    };
  } catch {
    throw Error('Private material refused');
  }
}
export async function createLocalEncryptedObjects(
  directory: string,
  material: LocalPhase2Material,
): Promise<PrivateObjects> {
  if (
    !isAbsolute(directory) ||
    (await lstat(directory)).isSymbolicLink() ||
    !(await lstat(directory)).isDirectory()
  )
    throw Error('Private object directory refused');
  const root = await realpath(directory),
    keys = Object.fromEntries(
      Object.entries(deriveLocalPhase2Keys(material, 'private-objects')).map(([k, v]) => [
        k,
        Buffer.from(v),
      ]),
    ),
    current = material.current;
  if (!keys[current] || Object.values(keys).some((k) => k.length !== 32))
    throw Error('Private object keys refused');
  async function path(a: AssetLocation) {
    if (
      (await realpath(directory)) !== root ||
      (await lstat(directory)).isSymbolicLink() ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(a.id) ||
      a.key !== 'assets/' + a.id ||
      !Number.isSafeInteger(a.size) ||
      a.size < 0 ||
      a.size > maximum ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(a.mime)
    )
      throw Error('Private object refused');
    return join(root, a.id + '.sealed');
  }
  const aad = (a: AssetLocation, key: string) =>
    Buffer.from(JSON.stringify([1, a.id, a.mime, a.size, a.sha256, key]));
  function decode(a: AssetLocation, raw: Buffer) {
    const x = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    if (
      Object.keys(x).sort().join(',') !== 'cipher,iv,key,tag,v' ||
      x.v !== 1 ||
      typeof x.key !== 'string' ||
      !keys[x.key] ||
      typeof x.iv !== 'string' ||
      !/^[a-f0-9]{24}$/.test(x.iv) ||
      typeof x.tag !== 'string' ||
      !/^[a-f0-9]{32}$/.test(x.tag) ||
      typeof x.cipher !== 'string' ||
      x.cipher.length > Math.ceil(maximum / 3) * 4 ||
      x.cipher.length % 4 !== 0
    )
      throw Error('Private object refused');
    // Canonical decoding is stack-safe at the full supported object size.
    const ciphertext = Buffer.from(x.cipher, 'base64');
    if (ciphertext.length > maximum || ciphertext.toString('base64') !== x.cipher)
      throw Error('Private object refused');
    const decipher = createDecipheriv('aes-256-gcm', keys[x.key]!, Buffer.from(x.iv, 'hex'));
    decipher.setAAD(aad(a, x.key));
    decipher.setAuthTag(Buffer.from(x.tag, 'hex'));
    const b = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (b.length !== a.size || sha(b) !== a.sha256) throw Error('Private object refused');
    return new Uint8Array(b);
  }
  const absent = (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
  async function removed(id: string) {
    try {
      await lstat(join(root, id + '.deleted'));
      return true;
    } catch (e) {
      if (absent(e)) return false;
      throw e;
    }
  }
  async function unlinkOwned(path: string) {
    try {
      await unlink(path);
    } catch (e) {
      if (!absent(e)) throw e;
    }
  }
  async function requireLive(id: string) {
    if (await removed(id)) throw Error('Private object deleted');
  }
  return {
    async put(a, b) {
      const target = await path(a);
      await requireLive(a.id);
      if (b.length !== a.size || sha(b) !== a.sha256) throw Error('Private object refused');
      try {
        const raw = await read(target, maximum * 2);
        decode(a, raw);
        await requireLive(a.id);
        return sha(raw);
      } catch (e) {
        if (!absent(e)) throw e;
      }
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', keys[current]!, iv);
      cipher.setAAD(aad(a, current));
      const ciphertext = Buffer.concat([cipher.update(b), cipher.final()]),
        sealed = Buffer.from(
          JSON.stringify({
            v: 1,
            key: current,
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex'),
            cipher: ciphertext.toString('base64'),
          }),
        );
      const temporary = join(root, a.id + '.' + randomBytes(16).toString('hex') + '.tmp'),
        file = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
      try {
        try {
          await file.writeFile(sealed);
          await file.sync();
        } finally {
          await file.close();
        }
        await requireLive(a.id);
        try {
          await link(temporary, target);
        } catch (e) {
          if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e;
        }
        if (await removed(a.id)) {
          await unlinkOwned(target);
          throw Error('Private object deleted');
        }
        const stored = await read(target, maximum * 2);
        decode(a, stored);
        await requireLive(a.id);
        return sha(stored);
      } finally {
        await unlinkOwned(temporary);
      }
    },
    async get(a) {
      const target = await path(a);
      await requireLive(a.id);
      const raw = await read(target, maximum * 2);
      if (!a.version || sha(raw) !== a.version) throw Error('Private object refused');
      const bytes = decode(a, raw);
      await requireLive(a.id);
      return bytes;
    },
    async erase(a) {
      const target = await path(a),
        marker = join(root, a.id + '.deleted');
      // Negative state precedes erasure and survives a process restart. It is local custody, not an external fence.
      try {
        const file = await open(
          marker,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile('deleted:v1\n');
          await file.sync();
        } finally {
          await file.close();
        }
      } catch (e) {
        if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e;
        const stat = await lstat(marker);
        if (!stat.isFile() || stat.size > 32)
          throw Error('Private deletion marker refused', { cause: e });
      }
      await unlinkOwned(target);
      let scanned = 0,
        removedCount = 0;
      const entries = await opendir(root),
        prefix = a.id + '.';
      for await (const entry of entries) {
        if (++scanned > 100000) throw Error('Private erasure scan incomplete');
        if (
          entry.name.startsWith(prefix) &&
          /^[a-f0-9]{32}\.tmp$/.test(entry.name.slice(prefix.length))
        ) {
          await unlinkOwned(join(root, entry.name));
          if (++removedCount >= 100) throw Error('Private erasure incomplete');
        }
      }
    },
  };
}
