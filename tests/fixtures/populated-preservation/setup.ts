import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { context, publicPlan, settings } from '../multitarget-coordination/transport.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { capture } from './reader.ts';
import {
  articleId,
  subjectId,
  versionId,
  profile,
  phase,
  sourceDigest,
  type Observation,
  admitBaseline,
} from './contract.ts';
import { must } from '../tls-admission/contract.ts';

// Privileged, bounded setup only; it exits before the read-only observer starts.
await import('../tls-admission/setup.ts');
const c = context(publicPlan());
const variant = profile();
const baseline: Observation[] = [];
for (const e of c.endpoints) {
  const s = settings(c, e.slot, e.kind, 'tt-populated-setup');
  const u = new URL(`postgresql://${e.user}@${e.host}:5432/${e.database}`);
  u.password = e.password;
  // Migration setup is inside the new isolated network; strict native TLS is
  // separately asserted for every owner observation, not claimed for setup.
  if (e.kind === 'app')
    await migrateApplication(
      { kind: 'app', database: e.database, url: u.toString() },
      loadSources('app'),
    );
  else {
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/populated-preservation/migrate.ts'],
      {
        env: { ...process.env, POPULATED_CMS_URL: u.toString() },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    must(child.status === 0);
  }
  const db = new pg.Client({ ...s, options: '-c search_path=public,pg_catalog' });
  try {
    await db.connect();
    if (e.kind === 'app')
      await db.query(
        `INSERT INTO app.subjects(id,kind,status,last_active_at,created_at,updated_at)
      VALUES($1,'guest','restricted','2026-01-01','2026-01-01','2026-01-01')`,
        [subjectId],
      );
    else {
      await db.query(
        `INSERT INTO public.articles(id,content_key,locale,market,title,body,created_at,updated_at)
        VALUES($1,'synthetic-preservation','en-US','US','Synthetic preserved article','{}','2026-01-01','2026-01-01')`,
        [articleId],
      );
      await db.query(
        `INSERT INTO public._articles_v(id,parent_id,version_title,version_body,created_at,updated_at,latest)
        VALUES($1,$2,'Synthetic prior revision','{}','2026-01-01','2026-01-01',true)`,
        [versionId, articleId],
      );
    }
    // Histories have real committed checksums/native CMS entries. Synthetic row
    // timestamps/IDs are fixed; migration timestamps are endpoint-specific.
    await db.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL transaction_timeout='5s'",
    );
    baseline.push(await capture(db, e.slot, e.kind));
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }
}
const envelope = {
  version: 1,
  phase,
  project: c.project,
  generation: c.generation,
  sourceDigest: sourceDigest(),
  observations: baseline,
};
admitBaseline(JSON.stringify(envelope), c.project, c.generation);
writeFileSync('/populated/baseline.json', JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
// Finite fixture faults, never an exported executor or observer mutation API.
if (variant !== 'positive') {
  const kind = variant.startsWith('cms-') ? 'cms' : 'app';
  const slot = variant === 'source-row' ? 0 : 1;
  const db = new pg.Client({
    ...settings(c, slot, kind, 'tt-populated-fixed-setup'),
    options: '-c search_path=public,pg_catalog',
  });
  try {
    await db.connect();
    switch (variant) {
      case 'app-row':
      case 'source-row':
        await db.query("UPDATE app.subjects SET status='active' WHERE id=$1", [subjectId]);
        break;
      case 'cms-row':
        // Existing immutable-history enforcement stays enabled. Its refusal is
        // separate from the deliberately changed editable draft below.
        try {
          await db.query(
            "UPDATE public._articles_v SET version_title='Forbidden change' WHERE id=$1",
            [versionId],
          );
          throw Error('Synthetic immutable version unexpectedly changed');
        } catch (error) {
          must((error as { code?: string }).code === '23514');
        }
        await db.query("UPDATE public.articles SET title='Changed synthetic draft' WHERE id=$1", [
          articleId,
        ]);
        break;
      case 'missing-row':
        await db.query('DELETE FROM app.subjects WHERE id=$1', [subjectId]);
        break;
      case 'app-history':
        await db.query("UPDATE migration_meta.applied SET sha256=repeat('0',64) WHERE position=1");
        break;
      case 'cms-history':
        await db.query('UPDATE public.payload_migrations SET batch=-1');
        break;
      case 'inventory':
        await db.query('CREATE TABLE public.synthetic_unexpected(id integer)');
        break;
      case 'quarantine':
        await db.query('GRANT CONNECT ON DATABASE tt_app_recovery TO tt_app_runtime');
        break;
    }
  } finally {
    await db.end();
  }
}
const before: Observation[] = [];
for (const e of c.endpoints) {
  const db = new pg.Client(settings(c, e.slot, e.kind, 'tt-populated-before'));
  try {
    await db.connect();
    await db.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL transaction_timeout='5s'",
    );
    before.push(await capture(db, e.slot, e.kind));
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }
}
writeFileSync('/populated/pre-observation.json', JSON.stringify(before), {
  flag: 'wx',
  mode: 0o600,
});
must(readFileSync('/populated/baseline.json').length <= 16384);
console.log(
  'POPULATED_SETUP_EVIDENCE ' +
    JSON.stringify({
      profile: variant,
      endpoints: 4,
      phase,
      realAppAndCmsMigrations: true,
      sourceAndTargetSeparateInstances: true,
      ownedSyntheticSetupOnly: true,
      immutableVersionWriteRefused: variant === 'cms-row',
    }),
);
process.exit(0);
