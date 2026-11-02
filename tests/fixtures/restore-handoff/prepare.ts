import { spawnSync } from 'node:child_process';
import { context, connect, writeEvidence } from '../recovery/context.ts';
import { fingerprints } from '../recovery/fingerprints.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { schemaInventory } from '../../../scripts/database/inventory.ts';
import { articleId, subjectId, versionId } from '../populated-preservation/contract.ts';
import { survivorId, cmsId } from '../recovery/context.ts';
import { guard } from './common.ts';
guard();
async function prepare() {
  // Unchanged owner-only foundation initializer for both separate instances.
  await import('../tls-admission/setup.ts');
  const c = context('postgres');
  await migrateApplication(
    { kind: 'app', database: 'tt_app_recovery', url: c.url('app') },
    loadSources('app'),
  );
  const url = new URL(c.url('cms'));
  url.hostname = 'postgres.preflight.test';
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/populated-preservation/migrate.ts'],
    {
      env: { ...process.env, POPULATED_CMS_URL: url.toString() },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (child.status !== 0) throw Error('Fixed source CMS setup refused');
  const app = await connect(c.url('app')),
    cms = await connect(c.url('cms'));
  try {
    for (const [id, status] of [
      [subjectId, 'restricted'],
      [survivorId, 'active'],
    ] as const)
      await app.query(
        "INSERT INTO app.subjects(id,kind,status,last_active_at,created_at,updated_at) VALUES($1,'guest',$2,'2026-01-01','2026-01-01','2026-01-01')",
        [id, status],
      );
    for (const [id, key, title] of [
      [articleId, 'synthetic-preservation', 'Synthetic preserved article'],
      [cmsId, 'synthetic-custody', 'Synthetic custody article'],
    ])
      await cms.query(
        "INSERT INTO public.articles(id,content_key,locale,market,title,body,created_at,updated_at) VALUES($1,$2,'en-US','US',$3,'{}','2026-01-01','2026-01-01')",
        [id, key, title],
      );
    await cms.query(
      "INSERT INTO public._articles_v(id,parent_id,version_title,version_body,created_at,updated_at,latest) VALUES($1,$2,'Synthetic prior revision','{}','2026-01-01','2026-01-01',true)",
      [versionId, articleId],
    );
    writeEvidence('source-inventory', {
      app: await schemaInventory(app),
      cms: await schemaInventory(cms),
    });
    writeEvidence('source-fingerprints', {
      app: await fingerprints(app),
      cms: await fingerprints(cms),
    });
    writeEvidence('backup-window', { project: c.project, startedAt: new Date().toISOString() });
  } finally {
    await app.end();
    await cms.end();
  }
  console.log(
    'RESTORE_HANDOFF_PREPARE ' +
      JSON.stringify({
        sourceMigrations: true,
        fixedSyntheticSeeds: true,
        fourRecoveryEndpoints: true,
        productConnectClosed: true,
        externalEffects: 0,
      }),
  );
}
prepare()
  .then(() => process.exit(0))
  .catch(() => {
    console.error('Restore handoff fixed preparation refused');
    process.exit(1);
  });
