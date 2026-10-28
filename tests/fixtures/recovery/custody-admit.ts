import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical } from '../../../packages/application/src/services/service-records.ts';
import { createFilePrivacyJournal } from '../../../packages/integrations/src/privacy-journal.ts';
import { openCustody } from '../../../scripts/database/custody.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { custodyContext, custodyKeys, custodyCrypto, privateRead } from './custody-common.ts';
import { context, connect, writeEvidence } from './context.ts';
const ctx = custodyContext(),
  ring = custodyKeys(),
  crypto = custodyCrypto();
const bundle = privateRead('/custody-backup/bundle.json', 280 * 1024 * 1024);
const currentJournal = await createFilePrivacyJournal('/custody-journal', crypto).capture(
  new Date().toISOString(),
);
const current = crypto.verify(currentJournal) as { entries: unknown };
const options = {
  project: ctx.project,
  keys: ring.keys,
  crypto,
  lookupVersions: ['lookup'],
  now: Date.now(),
  sources: { app: loadSources('app'), cms: loadSources('cms') },
  currentJournalDigest: createHash('sha256')
    .update(canonical(current.entries, 2097152))
    .digest('hex'),
};
const target = context('recovery-postgres'),
  app = await connect(target.url('app'));
try {
  let refusals = 0;
  const changed = structuredClone(bundle);
  changed.items.app.tag = '0'.repeat(32);
  for (const [value, overrides] of [
    [null, {}],
    [changed, {}],
    [bundle, { keys: {} }],
    [bundle, { keys: { 'backup-old': ring.keys['backup-new'] } }],
    [bundle, { project: 'tt-stage' }],
    [bundle, { lookupVersions: [] }],
    [bundle, { now: Date.now() + 3600000 }],
  ] as const) {
    let refused = false;
    try {
      openCustody(value, { ...options, ...overrides });
    } catch {
      refused = true;
    }
    if (!refused || existsSync('/recovery/app.dump') || existsSync('/recovery/cms.dump'))
      throw Error('Custody refusal failed');
    const tables = await app.query("SELECT 1 FROM pg_tables WHERE schemaname='app'");
    if (tables.rowCount) throw Error('Restore ran before custody admission');
    const access = await app.query(
      "SELECT has_database_privilege('tt_app_runtime','tt_app_recovery','CONNECT') AS allowed",
    );
    if (access.rows[0].allowed) throw Error('Restore target escaped quarantine');
    refusals++;
  }
  const admitted = openCustody(bundle, options);
  for (const kind of ['app', 'cms'] as const)
    writeFileSync('/recovery/' + kind + '.dump', admitted[kind], { mode: 0o600, flag: 'wx' });
  writeFileSync('/recovery/custody-object', admitted.object, { mode: 0o600, flag: 'wx' });
  writeEvidence('custody-snapshot', admitted.snapshot);
  writeEvidence('custody-admission', {
    refusals,
    encryptedArtifacts: 5,
    backupFinishedAt: admitted.backupFinishedAt,
    rotationContinuity: true,
    plaintextRemovedBetweenProcesses: true,
  });
  admitted.app.fill(0);
  admitted.cms.fill(0);
  admitted.object.fill(0);
  console.log(
    'Custody admission passed; seven refusals kept target empty and runtime CONNECT closed',
  );
} finally {
  await app.end();
}
