import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { AssetLocation } from '../../../packages/application/src/ports/assets.ts';
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex'),
  hex = /^[a-f0-9]{64}$/,
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface ArchivedObject {
  readonly id: string;
  readonly version: string;
  readonly sealedBytes: number;
  readonly plainBytes: number;
  readonly sha256: string;
  readonly mime: string;
}
export interface ObjectArchive {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sqlDigest: string;
  readonly objects: readonly ArchivedObject[];
  readonly digest: string;
}
export interface ParentHeldCheckpoint {
  readonly archive: string;
  readonly objectDigest: string;
  readonly sqlDigest: string;
  readonly p1Digest: string;
  readonly analysisDigest: string;
  readonly unknownAttempts: readonly string[];
}
function exact(value: unknown, keys: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys
  )
    throw Error('Closed local recovery record required');
  return value as Record<string, unknown>;
}
export function parseObjectArchive(value: unknown): ObjectArchive {
  const x = exact(value, 'digest,id,objects,schemaVersion,sqlDigest');
  if (
    x.schemaVersion !== 1 ||
    typeof x.id !== 'string' ||
    !uuid.test(x.id) ||
    typeof x.sqlDigest !== 'string' ||
    !hex.test(x.sqlDigest) ||
    typeof x.digest !== 'string' ||
    !hex.test(x.digest) ||
    !Array.isArray(x.objects) ||
    x.objects.length > 100
  )
    throw Error('Bounded local object archive required');
  const objects = x.objects.map((value) => {
    const r = exact(value, 'id,mime,plainBytes,sealedBytes,sha256,version');
    if (
      typeof r.id !== 'string' ||
      !uuid.test(r.id) ||
      typeof r.version !== 'string' ||
      !hex.test(r.version) ||
      typeof r.sha256 !== 'string' ||
      !hex.test(r.sha256) ||
      !Number.isSafeInteger(r.sealedBytes) ||
      Number(r.sealedBytes) < 1 ||
      Number(r.sealedBytes) > 33554432 ||
      !Number.isSafeInteger(r.plainBytes) ||
      Number(r.plainBytes) < 0 ||
      Number(r.plainBytes) > 16777216 ||
      typeof r.mime !== 'string' ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(r.mime)
    )
      throw Error('Bounded local object record required');
    return {
      id: r.id,
      version: r.version,
      sealedBytes: Number(r.sealedBytes),
      plainBytes: Number(r.plainBytes),
      sha256: r.sha256,
      mime: r.mime,
    };
  });
  if (
    new Set(objects.map((x) => x.id)).size !== objects.length ||
    objects.map((x) => x.id).join(',') !==
      objects
        .map((x) => x.id)
        .sort()
        .join(',')
  )
    throw Error('Unique ordered local objects required');
  const canonical = { schemaVersion: 1 as const, id: x.id, sqlDigest: x.sqlDigest, objects };
  if (digest(JSON.stringify(canonical)) !== x.digest)
    throw Error('Local object manifest checksum refused');
  return { ...canonical, digest: x.digest };
}
async function directory(path: string) {
  if (
    !isAbsolute(path) ||
    (await lstat(path)).isSymbolicLink() ||
    !(await lstat(path)).isDirectory()
  )
    throw Error('Owned local archive directory required');
  return realpath(path);
}
async function read(path: string) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await f.stat();
    if (!s.isFile() || s.size < 1 || s.size > 33554432)
      throw Error('Bounded encrypted file required');
    return await f.readFile();
  } finally {
    await f.close();
  }
}
async function write(path: string, bytes: Uint8Array) {
  const f = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await f.writeFile(bytes);
    await f.sync();
  } finally {
    await f.close();
  }
}
export async function archivePrivateObjects(
  source: string,
  target: string,
  assets: readonly AssetLocation[],
  sqlDigest: string,
): Promise<ObjectArchive> {
  const from = await directory(source),
    to = await directory(target);
  if (from === to || !hex.test(sqlDigest) || assets.length > 100 || (await readdir(to)).length)
    throw Error('Empty owned object archive required');
  const rows: ArchivedObject[] = [];
  for (const a of [...assets].sort((a, b) => a.id.localeCompare(b.id))) {
    if (
      !uuid.test(a.id) ||
      a.key !== 'assets/' + a.id ||
      !a.version ||
      !hex.test(a.version) ||
      a.state !== 'ready'
    )
      throw Error('Exact ready object reference required');
    const bytes = await read(join(from, a.id + '.sealed'));
    if (digest(bytes) !== a.version) throw Error('Encrypted object version checksum refused');
    await write(join(to, a.id + '.sealed'), bytes);
    rows.push({
      id: a.id,
      version: a.version,
      sealedBytes: bytes.length,
      plainBytes: a.size,
      sha256: a.sha256,
      mime: a.mime,
    });
  }
  const manifest = { schemaVersion: 1 as const, id: randomUUID(), sqlDigest, objects: rows };
  return parseObjectArchive({ ...manifest, digest: digest(JSON.stringify(manifest)) });
}
export async function restorePrivateObjects(
  archive: string,
  target: string,
  value: unknown,
  checkpoint: ParentHeldCheckpoint,
) {
  const manifest = parseObjectArchive(value),
    from = await directory(archive),
    to = await directory(target);
  if (
    from === to ||
    (await readdir(to)).length ||
    checkpoint.archive !== manifest.id ||
    checkpoint.objectDigest !== manifest.digest ||
    checkpoint.sqlDigest !== manifest.sqlDigest
  )
    throw Error('Parent-held archive binding refused');
  for (const a of manifest.objects) {
    const bytes = await read(join(from, a.id + '.sealed'));
    if (bytes.length !== a.sealedBytes || digest(bytes) !== a.version)
      throw Error('Encrypted object archive checksum refused');
    await write(join(to, a.id + '.sealed'), bytes);
  }
  return manifest;
}
export function admitControlledRecoveryReads(input: {
  database: string;
  manifest: unknown;
  checkpoint: ParentHeldCheckpoint;
  actualSqlDigest: string;
  assets: readonly AssetLocation[];
  replayedDigests: readonly string[];
  unknownAttemptIds: readonly string[];
  p1Ready: boolean;
}) {
  const m = parseObjectArchive(input.manifest),
    c = input.checkpoint;
  if (
    input.database !== 'tt_app_p2_security_restore' ||
    m.id !== c.archive ||
    m.digest !== c.objectDigest ||
    m.sqlDigest !== c.sqlDigest ||
    input.actualSqlDigest !== c.sqlDigest ||
    !input.p1Ready ||
    !hex.test(c.p1Digest) ||
    !hex.test(c.analysisDigest) ||
    c.p1Digest === c.analysisDigest ||
    input.replayedDigests.length !== 2 ||
    [...input.replayedDigests].sort().join(',') !==
      [c.p1Digest, c.analysisDigest].sort().join(',') ||
    !c.unknownAttempts.every((x) => uuid.test(x)) ||
    new Set(c.unknownAttempts).size !== c.unknownAttempts.length ||
    [...input.unknownAttemptIds].sort().join(',') !== [...c.unknownAttempts].sort().join(',')
  )
    throw Error('Complete local replay checkpoint required');
  const assets = [...input.assets].sort((a, b) => a.id.localeCompare(b.id));
  if (
    assets.length !== m.objects.length ||
    assets.some((a, i) => {
      const x = m.objects[i]!;
      return (
        a.id !== x.id ||
        a.key !== 'assets/' + a.id ||
        a.version !== x.version ||
        a.sha256 !== x.sha256 ||
        a.mime !== x.mime ||
        a.size !== x.plainBytes
      );
    })
  )
    throw Error('SQL and encrypted object references disagree');
  return Object.freeze({
    controlledTestReads: true,
    trafficActivation: false,
    independentlyDurableCustody: false,
  });
}
