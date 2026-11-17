import { it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  createLocalEncryptedObjects,
  readLocalPhase2Material,
} from '../../packages/integrations/src/local-encrypted-objects.ts';
import { createLocalEnvelopeEncryption } from '../../packages/integrations/src/local-envelope-encryption.ts';
import { id, revision } from '../../packages/domain/src/values/core.ts';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'tt-p2-storage-'));
  roots.push(root);
  const objects = join(root, 'objects'),
    file = join(root, 'keys.json');
  await mkdir(objects);
  const raw = {
    current: 'v1',
    keys: { v1: randomBytes(32).toString('hex') },
    lookup: randomBytes(32).toString('hex'),
  };
  await writeFile(file, JSON.stringify(raw), { mode: 0o600 });
  return { root, objects, file, raw, material: await readLocalPhase2Material(file) };
}
const bytes = new TextEncoder().encode('SYNTHETIC_PRIVATE_OBJECT_DO_NOT_EXPOSE'),
  assetId = '11111111-1111-4111-8111-111111111111';
function asset() {
  const ident = id('asset', assetId),
    rev = revision('1');
  if (!ident.ok || !rev.ok) throw Error();
  return {
    id: ident.value,
    revision: rev.value,
    key: 'assets/' + assetId,
    mime: 'text/csv',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    version: null,
    state: 'pending' as const,
  };
}
it('reopens retained encrypted immutable bytes after a fresh adapter and exact key-file load', async () => {
  const s = await setup(),
    a = asset(),
    first = await createLocalEncryptedObjects(s.objects, s.material),
    version = await first.put(a, bytes),
    raw = await readFile(join(s.objects, assetId + '.sealed'));
  expect(raw.toString()).not.toContain('SYNTHETIC_PRIVATE');
  const fresh = await createLocalEncryptedObjects(s.objects, await readLocalPhase2Material(s.file));
  expect(await fresh.get({ ...a, version })).toEqual(bytes);
  expect(await fresh.put(a, bytes)).toBe(version);
});
it.each([4 * 1024 * 1024, 16 * 1024 * 1024])(
  'round-trips a supported multi-megabyte object of %s bytes without a regex stack failure',
  async (size) => {
    const s = await setup(),
      data = new Uint8Array(size).fill(91),
      a = { ...asset(), size, sha256: createHash('sha256').update(data).digest('hex') },
      first = await createLocalEncryptedObjects(s.objects, s.material),
      version = await first.put(a, data),
      fresh = await createLocalEncryptedObjects(s.objects, await readLocalPhase2Material(s.file));
    const restored = await fresh.get({ ...a, version });
    expect(restored.length).toBe(size);
    expect(createHash('sha256').update(restored).digest('hex')).toBe(a.sha256);
    expect(await fresh.put(a, data)).toBe(version);
  },
);
it('serializes competing immutable creates and adopts exactly the committed version', async () => {
  const s = await setup(),
    objects = await createLocalEncryptedObjects(s.objects, s.material),
    a = asset(),
    versions = await Promise.all([objects.put(a, bytes), objects.put(a, bytes)]);
  expect(versions[0]).toBe(versions[1]);
  expect(await objects.get({ ...a, version: versions[0]! })).toEqual(bytes);
});
it('retains old decryption keys while new writes select the configured current key', async () => {
  const s = await setup(),
    a = asset(),
    first = await createLocalEncryptedObjects(s.objects, s.material),
    v = await first.put(a, bytes);
  await writeFile(
    s.file,
    JSON.stringify({
      ...s.raw,
      current: 'v2',
      keys: { ...s.raw.keys, v2: randomBytes(32).toString('hex') },
    }),
  );
  const next = await createLocalEncryptedObjects(s.objects, await readLocalPhase2Material(s.file));
  expect(await next.get({ ...a, version: v })).toEqual(bytes);
});
it.each([
  'missing-key',
  'wrong-key',
  'tamper',
  'missing-object',
  'wrong-version',
  'wrong-metadata',
] as const)('refuses %s without returning bytes', async (mode) => {
  const s = await setup(),
    a = asset(),
    first = await createLocalEncryptedObjects(s.objects, s.material),
    v = await first.put(a, bytes);
  let material = s.material;
  if (mode === 'missing-key')
    material = { ...material, current: 'v2', keys: { v2: randomBytes(32) } };
  if (mode === 'wrong-key') material = { ...material, keys: { v1: randomBytes(32) } };
  const path = join(s.objects, assetId + '.sealed');
  if (mode === 'tamper') {
    const x = JSON.parse(await readFile(path, 'utf8'));
    x.tag = '0'.repeat(32);
    await writeFile(path, JSON.stringify(x));
  }
  if (mode === 'missing-object') await rm(path);
  const fresh = await createLocalEncryptedObjects(s.objects, material);
  await expect(
    fresh.get({
      ...a,
      version: mode === 'wrong-version' ? '0'.repeat(64) : v,
      ...(mode === 'wrong-metadata' ? { mime: 'application/json' } : {}),
    }),
  ).rejects.toThrow();
});
it('refuses conflicting content, unsafe locations, invalid input and symlink targets', async () => {
  const s = await setup(),
    o = await createLocalEncryptedObjects(s.objects, s.material),
    a = asset();
  await expect(o.put(a, new Uint8Array())).rejects.toThrow();
  await expect(o.put({ ...a, key: '../keys.json' }, bytes)).rejects.toThrow();
  await expect(o.put({ ...a, id: '../../keys' as never }, bytes)).rejects.toThrow();
  await expect(o.put({ ...a, size: 16777217 }, bytes)).rejects.toThrow();
  await symlink(s.file, join(s.objects, assetId + '.sealed'));
  await expect(o.put(a, bytes)).rejects.toThrow();
  await expect(o.get({ ...a, version: '0'.repeat(64) })).rejects.toThrow();
});
it('erases only the named object and treats a repeated erase as complete', async () => {
  const s = await setup(),
    o = await createLocalEncryptedObjects(s.objects, s.material),
    a = asset(),
    v = await o.put(a, bytes);
  await o.erase(a);
  await o.erase(a);
  await expect(o.get({ ...a, version: v })).rejects.toThrow();
  expect(await readLocalPhase2Material(s.file)).toEqual(s.material);
});
it.each([
  null,
  [],
  {},
  { current: 'v1', keys: {}, lookup: 'a'.repeat(64) },
  { current: 'v1', keys: { v1: 'wrong' }, lookup: 'a'.repeat(64) },
  { current: 'v1', keys: { v1: 'a'.repeat(64) }, lookup: 'wrong' },
])('refuses malformed retained material %#', async (raw) => {
  const s = await setup();
  await writeFile(s.file, JSON.stringify(raw));
  await expect(readLocalPhase2Material(s.file)).rejects.toThrow('Private material refused');
});
it('refuses missing, non-file, relative and malformed JSON key paths without creating keys', async () => {
  const s = await setup();
  for (const path of ['relative.json', join(s.root, 'absent'), s.root])
    await expect(readLocalPhase2Material(path)).rejects.toThrow('Private material refused');
  await writeFile(s.file, '{"current":"secret');
  await expect(readLocalPhase2Material(s.file)).rejects.toThrow('Private material refused');
});
it('binds retained envelope encryption to purpose, resource and key version across reconstruction', async () => {
  const s = await setup(),
    first = createLocalEnvelopeEncryption(s.material),
    box = await first.encrypt(bytes, 'partner_dispute', assetId),
    next = createLocalEnvelopeEncryption(await readLocalPhase2Material(s.file));
  expect(await next.decrypt(box, 'partner_dispute', assetId)).toEqual(bytes);
  for (const [purpose, resource] of [
    ['other', assetId],
    ['partner_dispute', '22222222-2222-4222-8222-222222222222'],
  ])
    await expect(next.decrypt(box, purpose!, resource!)).rejects.toThrow();
  await expect(
    next.decrypt({ ...box, keyVersion: 'absent' }, 'partner_dispute', assetId),
  ).rejects.toThrow();
  await expect(next.decrypt({ ...box, hex: 'bad' }, 'partner_dispute', assetId)).rejects.toThrow();
});
it('round-trips the purpose-specific pilot envelope limit while retaining smaller-purpose limits', async () => {
  const s = await setup(),
    first = createLocalEnvelopeEncryption(s.material),
    pilot = new Uint8Array(7 * 1024 * 1024).fill(72),
    box = await first.encrypt(pilot, 'pilot_payload', assetId),
    fresh = createLocalEnvelopeEncryption(await readLocalPhase2Material(s.file)),
    decoded = await fresh.decrypt(box, 'pilot_payload', assetId);
  expect(decoded.length).toBe(pilot.length);
  expect(createHash('sha256').update(decoded).digest('hex')).toBe(
    createHash('sha256').update(pilot).digest('hex'),
  );
  const ordinary = new Uint8Array(1024 * 1024),
    ordinaryBox = await first.encrypt(ordinary, 'partner_dispute', assetId);
  expect((await fresh.decrypt(ordinaryBox, 'partner_dispute', assetId)).length).toBe(
    ordinary.length,
  );
  await expect(
    first.encrypt(new Uint8Array(1024 * 1024 + 1), 'partner_dispute', assetId),
  ).rejects.toThrow();
  await expect(fresh.decrypt(box, 'partner_dispute', assetId)).rejects.toThrow();
  await expect(
    first.encrypt(new Uint8Array(7 * 1024 * 1024 + 1), 'pilot_payload', assetId),
  ).rejects.toThrow();
  await expect(
    fresh.decrypt({ ...box, hex: box.hex + '00' }, 'pilot_payload', assetId),
  ).rejects.toThrow();
});

it('retains a negative asset marker across restart and removes only that asset’s encrypted crash fragments', async () => {
  const s = await setup(),
    o = await createLocalEncryptedObjects(s.objects, s.material),
    a = asset();
  await o.put(a, bytes);
  const sealed = await readFile(join(s.objects, assetId + '.sealed')),
    orphan = join(s.objects, assetId + '.' + 'a'.repeat(32) + '.tmp'),
    foreign = '22222222-2222-4222-8222-222222222222.' + 'b'.repeat(32) + '.tmp';
  await writeFile(orphan, sealed);
  await writeFile(join(s.objects, foreign), sealed);
  await o.erase(a);
  expect((await readdir(s.objects)).sort()).toEqual([assetId + '.deleted', foreign].sort());
  const fresh = await createLocalEncryptedObjects(s.objects, await readLocalPhase2Material(s.file));
  await expect(fresh.put(a, bytes)).rejects.toThrow('deleted');
  await fresh.erase(a);
  expect(await readFile(join(s.objects, foreign))).toEqual(sealed);
});
it('keeps racing late puts unreadable after erasure completes', async () => {
  const s = await setup(),
    o = await createLocalEncryptedObjects(s.objects, s.material),
    a = asset();
  await Promise.allSettled([o.put(a, bytes), o.erase(a)]);
  const fresh = await createLocalEncryptedObjects(s.objects, s.material);
  await expect(fresh.get({ ...a, version: '0'.repeat(64) })).rejects.toThrow();
  await expect(fresh.put(a, bytes)).rejects.toThrow('deleted');
});
it.each(['material', 'get', 'put'] as const)(
  'refuses a FIFO before blocking on local %s input',
  async (mode) => {
    const s = await setup(),
      fifo = mode === 'material' ? join(s.root, 'keys.fifo') : join(s.objects, assetId + '.sealed');
    execFileSync('mkfifo', [fifo], { timeout: 1000 });
    // A blocked open must not hang Vitest itself. Only this owned child is killed on timeout.
    const program = `
      import {createHash} from 'node:crypto';
      import {readLocalPhase2Material,createLocalEncryptedObjects} from './packages/integrations/src/local-encrypted-objects.ts';
      import {id,revision} from './packages/domain/src/values/core.ts';
      const [mode,keys,directory,fifo]=process.argv.slice(1);
      const material=await readLocalPhase2Material(keys);
      const objects=await createLocalEncryptedObjects(directory,material);
      const ident=id('asset','11111111-1111-4111-8111-111111111111'),rev=revision('1');
      if(!ident.ok||!rev.ok)throw Error('Invalid positive control');
      const bytes=new TextEncoder().encode('SYNTHETIC_PRIVATE_OBJECT_DO_NOT_EXPOSE');
      const asset={id:ident.value,revision:rev.value,key:'assets/'+ident.value,mime:'text/csv',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,version:null,state:'pending'};
      try {
        if(mode==='material')await readLocalPhase2Material(fifo);
        else if(mode==='get')await objects.get({...asset,version:'0'.repeat(64)});
        else if(mode==='put')await objects.put(asset,bytes);
        else throw Error('Invalid probe action');
        process.exitCode=2;
      } catch { process.stdout.write('nonfile-refused'); }
    `;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type', 'module', '-e', program, mode, s.file, s.objects, fifo],
      { encoding: 'utf8', timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 8192 },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('nonfile-refused');
  },
);
