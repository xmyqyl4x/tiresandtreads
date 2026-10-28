import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createPrivacyCrypto } from '../../../packages/integrations/src/privacy-crypto.ts';
import { createFilePrivacyJournal } from '../../../packages/integrations/src/privacy-journal.ts';
import { sealCustody } from '../../../scripts/database/custody.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { custodyContext, custodySubject, custodyKeys } from './custody-common.ts';
import { readEvidence, writeEvidence, connect } from './context.ts';
const ctx = custodyContext(),
  ring = custodyKeys(),
  old = createPrivacyCrypto('old', { old: ring.privacy.old }),
  current = createPrivacyCrypto('current', ring.privacy);
// Custody has its own checkpoint: the separate S1 seal intentionally makes unrelated SQL-only
// mutations and must not create erasures outside this scenario's signed journal.
const window = {
  ...readEvidence<{ startedAt: string; project: string }>('backup-window'),
  finishedAt: new Date().toISOString(),
};
writeEvidence('backup-window', window);
const dumps = { app: readFileSync('/recovery/app.dump'), cms: readFileSync('/recovery/cms.dump') };
const artifacts = Object.fromEntries(
  (['app', 'cms'] as const).map((kind) => [
    kind,
    {
      version: 1,
      kind,
      project: ctx.project,
      postgresMajor: 18,
      sha256: createHash('sha256').update(dumps[kind]).digest('hex'),
      bytes: dumps[kind].length,
      migrations: loadSources(kind).map(({ id, sha256 }) => ({ id, sha256 })),
    },
  ]),
);
const entry = {
  version: 1 as const,
  action: 'delete' as const,
  resourceKind: 'subject' as const,
  markers: old.markers('subject', custodySubject),
  tombstones: [
    { keyVersion: 'lookup', digest: createHash('sha256').update(ring.lookup).digest('hex') },
  ],
  policy: 'custody-local',
};
const journal = createFilePrivacyJournal('/custody-journal', current);
// A durable entry signed before rotation must still verify when capturing under the new signing key.
await journal.append('a'.repeat(64), old.sign(entry));
const snapshot = await journal.capture(new Date().toISOString());
const object = Buffer.from('Synthetic private tire report object; not customer data.');
const metadata = {
  ...artifacts,
  object: {
    versionId: 'synthetic-object-v1',
    keyVersion: 'synthetic-object-key-v1',
    sha256: createHash('sha256').update(object).digest('hex'),
  },
};
const bytes = {
  ...dumps,
  object,
  journal: Buffer.from(JSON.stringify(snapshot)),
  metadata: Buffer.from(JSON.stringify(metadata)),
};
const bundle = sealCustody(
  {
    version: 1,
    project: ctx.project,
    backupFinishedAt: window.finishedAt,
    keyVersion: 'backup-old',
  },
  bytes,
  ring.keys,
);
writeFileSync('/custody-backup/bundle.json', JSON.stringify(bundle), { mode: 0o600, flag: 'wx' });
// Destroy plaintext transport before a NEW tooling process admits/decrypts the custody copy.
for (const name of ['app.dump', 'cms.dump']) unlinkSync('/recovery/' + name);
for (const value of Object.values(bytes)) value.fill(0);
const app = await connect(ctx.url('app'));
try {
  await app.query('DELETE FROM app.subjects WHERE id=$1', [custodySubject]);
} finally {
  await app.end();
}
console.log(
  'Synthetic custody sealed; plaintext archive transport removed; journal and key volumes separate',
);
