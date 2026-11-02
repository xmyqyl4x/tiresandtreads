import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openCustody } from '../../../scripts/database/custody.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { canonical } from '../../../packages/application/src/services/service-records.ts';
import { createFilePrivacyJournal } from '../../../packages/integrations/src/privacy-journal.ts';
import {
  custodyContext,
  custodyCrypto,
  custodyKeys,
  privateRead,
} from '../recovery/custody-common.ts';
import { context, connect } from '../recovery/context.ts';
import { guard, profile } from './common.ts';
guard();
async function admit() {
  const p = profile();
  if (!['bundle-corrupt', 'bundle-project', 'bundle-manifest'].includes(p)) {
    await import('../recovery/custody-admit.ts');
    console.log(
      'RESTORE_HANDOFF_ADMISSION ' +
        JSON.stringify({
          profile: p,
          admitted: true,
          restoreExecuted: false,
          existingAdmissionRefusals: 7,
        }),
    );
    return;
  }
  const c = custodyContext(),
    crypto = custodyCrypto();
  const bundle = privateRead('/custody-backup/bundle.json', 280 * 1024 * 1024);
  if (p === 'bundle-corrupt') {
    const item = (bundle as { items: { app: { tag: string } } }).items.app;
    item.tag = item.tag.slice(0, -1) + (item.tag.endsWith('a') ? 'b' : 'a');
  }
  const current = crypto.verify(
    await createFilePrivacyJournal('/custody-journal', crypto).capture(new Date().toISOString()),
  ) as { entries: unknown };
  const sources = { app: loadSources('app'), cms: loadSources('cms') };
  if (p === 'bundle-manifest')
    sources.app = sources.app.map((s, i) =>
      i === 0 ? { ...s, sha256: s.sha256.slice(0, -1) + (s.sha256.endsWith('a') ? 'b' : 'a') } : s,
    );
  let refused = false;
  const wrongProject = c.project.slice(0, -1) + (c.project.endsWith('a') ? 'b' : 'a');
  try {
    openCustody(bundle, {
      project: p === 'bundle-project' ? wrongProject : c.project,
      keys: custodyKeys().keys,
      crypto,
      lookupVersions: ['lookup'],
      now: Date.now(),
      sources,
      currentJournalDigest: createHash('sha256')
        .update(canonical(current.entries, 2097152))
        .digest('hex'),
    });
  } catch {
    refused = true;
  }
  if (!refused || existsSync('/recovery/app.dump') || existsSync('/recovery/cms.dump'))
    throw Error('Pre-restore artifact refusal failed');
  for (const kind of ['app', 'cms'] as const) {
    const db = await connect(context('recovery-postgres').url(kind));
    try {
      const row = (
        await db.query(
          "SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS tables,has_database_privilege($1,current_database(),'CONNECT') AS connect",
          [kind === 'app' ? 'tt_app_runtime' : 'tt_cms_runtime'],
        )
      ).rows[0];
      if (row.tables !== 0 || row.connect)
        throw Error('Refused restore target not empty/quarantined');
    } finally {
      await db.end();
    }
  }
  console.log(
    'RESTORE_HANDOFF_ADMISSION ' +
      JSON.stringify({
        profile: p,
        admitted: false,
        restoreExecuted: false,
        targetEmpty: true,
        targetProductConnectClosed: true,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
admit().catch(() => {
  console.error('Restore handoff archive admission proof refused');
  process.exitCode = 1;
});
