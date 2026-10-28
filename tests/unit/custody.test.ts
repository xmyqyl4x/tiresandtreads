import { randomBytes, createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { openCustody, sealCustody } from '../../scripts/database/custody.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { canonical } from '../../packages/application/src/services/service-records.ts';
const project = 'tt-test-1234abcd',
  now = Date.now(),
  keys = { backup1: randomBytes(32), backup2: randomBytes(32) };
const privacyKeys = { old: randomBytes(32), current: randomBytes(32) };
const crypto = createPrivacyCrypto('current', privacyKeys);
const h = {
  version: 1 as const,
  project,
  keyVersion: 'backup1',
  backupFinishedAt: new Date(now - 1000).toISOString(),
};
const entry = {
  version: 1,
  action: 'delete',
  resourceKind: 'subject',
  markers: [{ keyVersion: 'old', digest: 'a'.repeat(64) }],
  tombstones: [{ keyVersion: 'lookup1', digest: 'b'.repeat(64) }],
  policy: 'synthetic',
};
const snapshot = crypto.sign({
  version: 1,
  capturedAt: new Date(now).toISOString(),
  entries: [entry],
});
const object = Buffer.from('synthetic private object');
const raw = {
  app: Buffer.from('PGDMP-app'),
  cms: Buffer.from('PGDMP-cms'),
  object,
  journal: Buffer.from(JSON.stringify(snapshot)),
  metadata: Buffer.alloc(0),
};
raw.metadata = Buffer.from(
  JSON.stringify(
    Object.fromEntries([
      ...(['app', 'cms'] as const).map((kind) => [
        kind,
        {
          version: 1,
          kind,
          project,
          postgresMajor: 18,
          bytes: raw[kind].length,
          sha256: createHash('sha256').update(raw[kind]).digest('hex'),
          migrations: [],
        },
      ]),
      [
        'object',
        {
          versionId: 'synthetic-object-v1',
          keyVersion: 'synthetic-object-key-v1',
          sha256: createHash('sha256').update(object).digest('hex'),
        },
      ],
    ]),
  ),
);
const options = {
  project,
  keys,
  crypto,
  lookupVersions: ['lookup1'],
  now,
  sources: { app: [], cms: [] },
  currentJournalDigest: createHash('sha256')
    .update(canonical([entry]))
    .digest('hex'),
};
const bundle = () => sealCustody(h, raw, keys);
function refused(
  b: unknown,
  overrides: Partial<Omit<typeof options, 'keys'> & { keys: Record<string, Uint8Array> }> = {},
) {
  expect(() => openCustody(b, { ...options, ...overrides })).toThrow(
    'Local custody admission refused',
  );
}
it('recovers all artifacts after backup and signing key rotation with retained versions', () => {
  const admitted = openCustody(bundle(), options);
  expect(admitted.app).toEqual(raw.app);
  expect(admitted.cms).toEqual(raw.cms);
  expect(admitted.object).toEqual(object);
  expect(admitted.snapshot).toEqual(snapshot);
});
it('uses fresh authenticated nonces without including keys or plaintext in custody', () => {
  const a = bundle(),
    b = bundle();
  expect(a.items.app.iv).not.toBe(b.items.app.iv);
  expect(JSON.stringify(a)).not.toContain(object.toString());
  expect(JSON.stringify(a)).not.toContain(keys.backup1.toString('hex'));
});
for (const name of ['app', 'cms', 'object', 'journal', 'metadata'] as const)
  it(`refuses tampered ${name} before returning restore plaintext`, () => {
    const b = bundle();
    b.items[name].tag = '0'.repeat(32);
    refused(b);
  });
it('refuses unavailable and incorrect backup keys', () => {
  refused(bundle(), { keys: { backup2: keys.backup2 } });
  refused(bundle(), { keys: { backup1: randomBytes(32) } });
});
it('refuses missing signing keys and missing historical marker keys', () => {
  refused(bundle(), { crypto: createPrivacyCrypto('old', { old: privacyKeys.old }) });
  refused(bundle(), { crypto: createPrivacyCrypto('current', { current: privacyKeys.current }) });
});
it('refuses missing lookup/tombstone key continuity', () =>
  refused(bundle(), { lookupVersions: [] }));
it('refuses another project and unauthenticated header changes', () => {
  refused(bundle(), { project: 'tt-test-abcdef12' });
  const b = bundle();
  b.keyVersion = 'backup2';
  refused(b);
});
it('refuses expired, future and retained-environment backup headers', () => {
  for (const b of [
    { ...h, backupFinishedAt: new Date(now - 86400001).toISOString() },
    { ...h, backupFinishedAt: new Date(now + 1000).toISOString() },
  ])
    refused(sealCustody(b, raw, keys));
  expect(() => sealCustody({ ...h, project: 'tt-stage' }, raw, keys)).toThrow();
});
it('refuses absent, truncated and extended artifact envelopes', () => {
  refused(null);
  refused({ ...bundle(), extra: true });
  const b = bundle();
  b.items.app.hex = b.items.app.hex.slice(2);
  refused(b);
  const c = bundle();
  delete (c.items as Partial<typeof c.items>).journal;
  refused(c);
});
it('refuses incorrect archive digests, migration histories and swapped database kinds', () => {
  for (const mutate of [
    (m: { app: { sha256: string } }) => (m.app.sha256 = '0'.repeat(64)),
    (m: { app: { migrations: unknown[] } }) =>
      (m.app.migrations = [{ id: 'extra', sha256: 'a'.repeat(64) }]),
    (m: { app: { kind: string } }) => (m.app.kind = 'cms'),
  ]) {
    const m = JSON.parse(raw.metadata.toString());
    mutate(m);
    refused(sealCustody(h, { ...raw, metadata: Buffer.from(JSON.stringify(m)) }, keys));
  }
});
it('refuses a mismatched object version or content checksum', () => {
  const m = JSON.parse(raw.metadata.toString());
  m.object.versionId = 'other';
  refused(sealCustody(h, { ...raw, metadata: Buffer.from(JSON.stringify(m)) }, keys));
  refused(sealCustody(h, { ...raw, object: Buffer.from('other') }, keys));
});
it('refuses forged, empty, stale, future and pre-backup signed journals', () => {
  for (const document of [
    { version: 1, capturedAt: new Date(now).toISOString(), entries: [] },
    ...[-3600000, 6000, -2000].map((offset) => ({
      version: 1,
      capturedAt: new Date(now + offset).toISOString(),
      entries: [entry],
    })),
  ])
    refused(
      sealCustody(h, { ...raw, journal: Buffer.from(JSON.stringify(crypto.sign(document))) }, keys),
    );
  refused(
    sealCustody(
      h,
      { ...raw, journal: Buffer.from(JSON.stringify({ ...snapshot, digest: '0'.repeat(64) })) },
      keys,
    ),
  );
});
it('refuses a fresh valid signed snapshot that omits a newer independently held erasure', () => {
  const newer = { ...entry, markers: [{ keyVersion: 'old', digest: 'c'.repeat(64) }] };
  refused(bundle(), {
    currentJournalDigest: createHash('sha256')
      .update(canonical([entry, newer]))
      .digest('hex'),
  });
});
