import { readFileSync } from 'node:fs';
import { getPayload } from 'payload';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
} from '../../../scripts/database/bootstrap.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { migrateCms } from '../../../scripts/database/cms.ts';
import { cmsFoundationConfig } from '../../../scripts/database/cms-config.ts';
import { schemaInventory } from '../../../scripts/database/inventory.ts';
import { context, connect, cmsId, writeEvidence } from './context.ts';
import { fingerprints } from './fingerprints.ts';

async function main() {
  for (const host of ['postgres', 'recovery-postgres'] as const) {
    const ctx = context(host);
    for (const kind of ['app', 'cms'] as const) {
      const database = `tt_${kind}_recovery`;
      const admin = await connect(ctx.admin);
      try {
        await admin.query(`CREATE DATABASE ${identifier(database)}`);
      } finally {
        await admin.end();
      }
      const adminUrl = new URL(ctx.admin);
      adminUrl.pathname = `/${database}`;
      await bootstrapDatabase(adminUrl.toString(), kind, database, ctx.passwords);
      if (host === 'recovery-postgres') {
        const owner = await connect(ctx.url(kind));
        try {
          for (const role of databaseRoles[kind].slice(1))
            await owner.query(
              `REVOKE CONNECT ON DATABASE ${identifier(database)} FROM ${identifier(role)}`,
            );
        } finally {
          await owner.end();
        }
      }
    }
  }
  const target = context('recovery-postgres');
  const admin = await connect(target.admin);
  try {
    await admin.query('CREATE DATABASE tt_app_recovery_bad');
  } finally {
    await admin.end();
  }
  const badUrl = new URL(target.admin);
  badUrl.pathname = '/tt_app_recovery_bad';
  await bootstrapDatabase(badUrl.toString(), 'app', 'tt_app_recovery_bad', target.passwords);
  const bad = await connect(target.url('app', 'tt_app_migrator', true));
  try {
    for (const role of databaseRoles.app.slice(1))
      await bad.query(`REVOKE CONNECT ON DATABASE tt_app_recovery_bad FROM ${identifier(role)}`);
  } finally {
    await bad.end();
  }

  const source = context('postgres');
  await migrateApplication(
    { url: source.url('app'), kind: 'app', database: 'tt_app_recovery' },
    loadSources('app'),
  );
  await migrateCms(
    { url: source.url('cms'), kind: 'cms', database: 'tt_cms_recovery' },
    source.secret,
  );
  const app = await connect(source.url('app'));
  const cms = await connect(source.url('cms'));
  try {
    await app.query(readFileSync('infra/database/seeds/synthetic.sql', 'utf8'));
    await app.query(readFileSync('tests/fixtures/schema/pr005-upgrade.sql', 'utf8'));
    await app.query(readFileSync('tests/fixtures/recovery/subject-graph.sql', 'utf8'));
    const reviewer = (
      await cms.query(
        "INSERT INTO cms_staff(app_staff_id) VALUES('22222222-2222-4222-8222-222222222222') RETURNING id",
      )
    ).rows[0].id as string;
    const payload = await getPayload({
      key: 'recovery-prepare',
      config: cmsFoundationConfig(source.url('cms'), source.secret),
    });
    try {
      // The SQL fixture fixes a cross-process ID; real Payload edits exercise generated version data.
      await cms.query(
        "INSERT INTO articles(id,content_key,locale,market,revision,schema_version,title,source_url,review_status,reviewer_id,reviewed_at,body,_status) VALUES($1,'recovery-article','en-US','US',1,1,'Recovery article','https://example.invalid/source','approved',$2,now(),'{}','published')",
        [cmsId, reviewer],
      );
      await payload.update({
        collection: 'articles',
        id: cmsId,
        overrideAccess: true,
        data: { title: 'Recovered editorial content' },
      });
      await payload.create({
        collection: 'publication-work',
        overrideAccess: true,
        data: {
          collectionSlug: 'articles',
          documentId: cmsId,
          contentRevision: 1,
          eventId: '88888888-8888-4888-8888-000000000081',
          publicDto: { title: 'Recovered editorial content' },
          schemaVersion: 1,
        },
      });
    } finally {
      await payload.destroy();
    }
    writeEvidence('source-inventory', {
      app: await schemaInventory(app),
      cms: await schemaInventory(cms),
    });
    writeEvidence('source-fingerprints', {
      app: await fingerprints(app),
      cms: await fingerprints(cms),
    });
    writeEvidence('backup-window', {
      startedAt: new Date().toISOString(),
      project: source.project,
    });
    console.log('Recovery source prepared; isolated target runtime CONNECT remains revoked');
  } finally {
    await app.end();
    await cms.end();
  }
}
// Payload tooling retains idle handles after destroy; all owned work and clients finish first.
main()
  .then(() => process.exit(0))
  .catch(() => {
    console.error('Recovery preparation failed; target remains quarantined');
    process.exit(1);
  });
