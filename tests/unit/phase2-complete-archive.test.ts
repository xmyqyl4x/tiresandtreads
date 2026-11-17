import { it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { id, revision } from '../../packages/domain/src/values/core.ts';
import { createLocalEncryptedObjects } from '../../packages/integrations/src/local-encrypted-objects.ts';
import {
  archivePrivateObjects,
  restorePrivateObjects,
  parseObjectArchive,
  admitControlledRecoveryReads,
  type ParentHeldCheckpoint,
} from '../fixtures/phase2/complete-object-archive.ts';
const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tt-p2-archive-'));
  owned.push(root);
  const source = join(root, 'source'),
    archive = join(root, 'archive'),
    target = join(root, 'target');
  for (const p of [source, archive, target]) await mkdir(p);
  const a = id('asset', '11111111-1111-4111-8111-111111111111'),
    rev = revision('1');
  if (!a.ok || !rev.ok) throw Error();
  const bytes = new TextEncoder().encode('SYNTHETIC_PRIVATE_RECOVERY'),
    material = {
      current: 'v1',
      keys: { v1: new Uint8Array(32).fill(41) },
      lookup: new Uint8Array(32).fill(42),
    },
    objects = await createLocalEncryptedObjects(source, material),
    asset = {
      id: a.value,
      revision: rev.value,
      key: 'assets/' + a.value,
      mime: 'text/csv',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      version: null,
      state: 'ready' as const,
    },
    version = await objects.put(asset, bytes),
    ready = { ...asset, version },
    manifest = await archivePrivateObjects(source, archive, [ready], '1'.repeat(64)),
    checkpoint: ParentHeldCheckpoint = {
      archive: manifest.id,
      objectDigest: manifest.digest,
      sqlDigest: manifest.sqlDigest,
      p1Digest: '2'.repeat(64),
      analysisDigest: '3'.repeat(64),
      unknownAttempts: ['22222222-2222-4222-8222-222222222222'],
    };
  return { root, source, archive, target, bytes, material, asset: ready, manifest, checkpoint };
}
it.each(['archive', 'restore'] as const)(
  'refuses a FIFO before blocking on local recovery %s input',
  async (operation) => {
    const f = await fixture(),
      from = operation === 'archive' ? f.source : f.archive,
      fifo = join(from, f.asset.id + '.sealed');
    await rm(fifo);
    execFileSync('mkfifo', [fifo], { timeout: 1000 });
    const program = `
      import {archivePrivateObjects,restorePrivateObjects,parseObjectArchive} from './tests/fixtures/phase2/complete-object-archive.ts';
      const [mode,from,to,rawAsset,rawManifest,rawCheckpoint]=process.argv.slice(1);
      if(!['archive','restore'].includes(mode))throw Error('Invalid owned probe action');
      const asset=JSON.parse(rawAsset),manifest=parseObjectArchive(JSON.parse(rawManifest)),checkpoint=JSON.parse(rawCheckpoint);
      try {
        if(mode==='archive')await archivePrivateObjects(from,to,[asset],manifest.sqlDigest);
        else await restorePrivateObjects(from,to,manifest,checkpoint);
        process.exitCode=2;
      } catch { process.stdout.write('nonfile-refused'); }
    `;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type',
        'module',
        '-e',
        program,
        operation,
        from,
        f.target,
        JSON.stringify({ ...f.asset, revision: f.asset.revision.toString() }),
        JSON.stringify(f.manifest),
        JSON.stringify(f.checkpoint),
      ],
      { encoding: 'utf8', timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 8192 },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('nonfile-refused');
  },
);
it('restores exact authenticated ciphertext versions and permits only fully reconciled controlled test reads', async () => {
  const f = await fixture();
  expect(await readFile(join(f.archive, f.asset.id + '.sealed'), 'utf8')).not.toContain(
    'SYNTHETIC_PRIVATE',
  );
  await restorePrivateObjects(f.archive, f.target, f.manifest, f.checkpoint);
  const objects = await createLocalEncryptedObjects(f.target, f.material);
  expect(await objects.get(f.asset)).toEqual(f.bytes);
  expect(
    admitControlledRecoveryReads({
      database: 'tt_app_p2_security_restore',
      manifest: f.manifest,
      checkpoint: f.checkpoint,
      actualSqlDigest: f.manifest.sqlDigest,
      assets: [f.asset],
      replayedDigests: [f.checkpoint.p1Digest, f.checkpoint.analysisDigest],
      unknownAttemptIds: f.checkpoint.unknownAttempts,
      p1Ready: true,
    }),
  ).toEqual({
    controlledTestReads: true,
    trafficActivation: false,
    independentlyDurableCustody: false,
  });
});
it.each(['foreign-archive', 'foreign-sql', 'foreign-manifest'] as const)(
  'refuses %s receipt bindings before object writes',
  async (kind) => {
    const f = await fixture(),
      c = { ...f.checkpoint };
    if (kind === 'foreign-archive') c.archive = '33333333-3333-4333-8333-333333333333';
    if (kind === 'foreign-sql') c.sqlDigest = '4'.repeat(64);
    if (kind === 'foreign-manifest') c.objectDigest = '5'.repeat(64);
    await expect(restorePrivateObjects(f.archive, f.target, f.manifest, c)).rejects.toThrow(
      'binding refused',
    );
  },
);
it.each(['missing', 'tampered'] as const)(
  'fails closed for %s encrypted backup bytes',
  async (kind) => {
    const f = await fixture(),
      file = join(f.archive, f.asset.id + '.sealed');
    if (kind === 'missing') await rm(file);
    else await writeFile(file, 'tampered');
    await expect(
      restorePrivateObjects(f.archive, f.target, f.manifest, f.checkpoint),
    ).rejects.toThrow();
  },
);
it.each([
  'missing-p1',
  'missing-analysis',
  'partial',
  'stale-sql',
  'wrong-target',
  'unresolved-p1',
  'unknown-lost',
  'object-ref-mismatch',
] as const)('refuses incomplete recovery: %s', async (kind) => {
  const f = await fixture(),
    input = {
      database: 'tt_app_p2_security_restore',
      manifest: f.manifest,
      checkpoint: f.checkpoint,
      actualSqlDigest: f.manifest.sqlDigest,
      assets: [f.asset],
      replayedDigests: [f.checkpoint.p1Digest, f.checkpoint.analysisDigest],
      unknownAttemptIds: [...f.checkpoint.unknownAttempts],
      p1Ready: true,
    };
  if (kind === 'missing-p1') input.replayedDigests = [f.checkpoint.analysisDigest];
  if (kind === 'missing-analysis') input.replayedDigests = [f.checkpoint.p1Digest];
  if (kind === 'partial') input.replayedDigests = [];
  if (kind === 'stale-sql') input.actualSqlDigest = '6'.repeat(64);
  if (kind === 'wrong-target') input.database = 'tt_app_dev';
  if (kind === 'unresolved-p1') input.p1Ready = false;
  if (kind === 'unknown-lost') input.unknownAttemptIds = [];
  if (kind === 'object-ref-mismatch') input.assets = [{ ...f.asset, version: '7'.repeat(64) }];
  expect(() => admitControlledRecoveryReads(input)).toThrow();
});
it.each([
  null,
  [],
  {},
  { schemaVersion: 2 },
  {
    schemaVersion: 1,
    id: 'invalid',
    sqlDigest: 'a'.repeat(64),
    objects: [],
    digest: 'b'.repeat(64),
  },
])('rejects unsupported/unbounded archive input %#', (value) =>
  expect(() => parseObjectArchive(value)).toThrow(),
);
it('rejects foreign unlisted fields, duplicate objects and unsupported object properties', async () => {
  const f = await fixture();
  expect(() => parseObjectArchive({ ...f.manifest, authority: 'injected' })).toThrow();
  expect(() =>
    parseObjectArchive({ ...f.manifest, objects: [...f.manifest.objects, ...f.manifest.objects] }),
  ).toThrow();
  expect(() =>
    parseObjectArchive({
      ...f.manifest,
      objects: [{ ...f.manifest.objects[0], objectKey: '../outside' }],
    }),
  ).toThrow();
});
