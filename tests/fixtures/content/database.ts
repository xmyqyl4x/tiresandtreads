import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { catalogFixture, uid, time } from '../catalog/database.ts';
import { disposableTargets } from '../foundation/target.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
import type { CmsRef } from '../../../packages/application/src/ports/content-services.ts';
export { uid, time, success, result } from '../catalog/database.ts';
export async function contentFixture() {
  const f = await catalogFixture(),
    target = disposableTargets(process.env),
    admin = new pg.Client({ connectionString: target.cms });
  await admin.connect();
  const database = 'tt_cms_content';
  await admin.query(`CREATE DATABASE ${database}`);
  const root = new URL(target.cms);
  root.pathname = '/' + database;
  const passwords = Object.fromEntries(
    databaseRoles.cms.map((r) => [r, randomBytes(32).toString('hex')]),
  ) as RolePasswords;
  let owner: pg.Client | undefined, pool: pg.Pool | undefined;
  async function cleanup() {
    await pool?.end();
    await owner?.end();
    await admin.query(`DROP DATABASE ${database}`);
    for (const r of databaseRoles.cms) await admin.query(`DROP ROLE IF EXISTS ${identifier(r)}`);
    await admin.end();
    await f.cleanup();
  }
  try {
    await bootstrapDatabase(root.toString(), 'cms', database, passwords);
    const url = (role: (typeof databaseRoles.cms)[number]) => {
      const u = new URL(root);
      u.username = role;
      u.password = passwords[role];
      return u.toString();
    };
    const migration = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/content/migrate.ts'],
      {
        env: { ...process.env, TT_CONTENT_CMS_URL: url('tt_cms_migrator') },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    if (migration.status !== 0) throw Error('Isolated CMS fixture migration failed');
    owner = new pg.Client({ connectionString: url('tt_cms_migrator') });
    await owner.connect();
    const cmsAdmin = owner;
    pool = new pg.Pool({ connectionString: url('tt_cms_runtime'), max: 3 });
    const cmsScope = createTransactions(pool, {
        transactionMs: 10000,
        statementMs: 5000,
        lockMs: 2000,
      }),
      appScope = f.adapter('tt_content_runtime'),
      publicScope = f.adapter('tt_public_runtime');
    const role = uid('role');
    await f.owner.query(
      "INSERT INTO admin.roles(id,code,permissions,policy_version) VALUES($1,'content_fixture','[\"content.publish\",\"seo.publish\"]','synthetic')",
      [role],
    );
    await f.owner.query(
      'INSERT INTO admin.staff_role_assignments(staff_id,role_id) VALUES($1,$2)',
      [f.staff, role],
    );
    const cmsStaff = uid('cms_staff');
    await cmsAdmin.query('INSERT INTO public.cms_staff(id,app_staff_id) VALUES($1,$2)', [
      cmsStaff,
      f.staff,
    ]);
    async function document(collection: CmsRef['collection'] = 'articles', path?: string) {
      const id = uid('cms_document'),
        ref = { collection, id, revision: 1 },
        stamp = time(-1000),
        reviewed = time(-2000),
        expires = time(3600000),
        key = uid('content_key'),
        slug = 'fixture-' + id;
      const table = collection === 'articles' ? 'articles' : 'glossary_terms',
        field = collection === 'articles' ? 'body' : 'definition';
      const body = {
        path: path ?? (collection === 'articles' ? '/learn/' : '/glossary/') + slug,
        canonical: path ?? (collection === 'articles' ? '/learn/' : '/glossary/') + slug,
        summary: 'Synthetic reviewed summary',
        paragraphs: ['Synthetic public text.'],
        topics: ['buying'],
        related: [],
        author: 'Synthetic author',
        reviewer: 'Synthetic reviewer',
      };
      await cmsAdmin.query(
        `INSERT INTO public.${table}(id,content_key,locale,market,revision,schema_version,title,review_status,source_url,reviewer_id,reviewed_at,expires_at,updated_at,_status,${field}) VALUES($1,$2,'en-US','US',1,1,'Synthetic title','approved','https://example.invalid/reference',$3,$4,$5,$6,'published',$7)`,
        [id, key, cmsStaff, reviewed, expires, stamp, JSON.stringify(body)],
      );
      await cmsAdmin.query(
        "INSERT INTO public.editorial_reviews(collection_slug,document_id,content_revision,reviewer_id,result,reason_code,reviewed_at) VALUES($1,$2,1,$3,'approved','synthetic',$4)",
        [collection, id, cmsStaff, reviewed],
      );
      return { ref, key, body, stamp, expires, table, field };
    }
    async function update(
      doc: Awaited<ReturnType<typeof document>>,
      revision: number,
      body = doc.body,
      published = true,
    ) {
      const ref = { ...doc.ref, revision },
        stamp = time(-500),
        reviewed = time(-750),
        expires = time(3600000);
      await cmsAdmin.query(
        `UPDATE public.${doc.table} SET revision=$2,${doc.field}=$3,updated_at=$4,reviewed_at=$5,expires_at=$6,_status=$7 WHERE id=$1`,
        [
          ref.id,
          revision,
          JSON.stringify(body),
          stamp,
          reviewed,
          expires,
          published ? 'published' : 'draft',
        ],
      );
      await cmsAdmin.query(
        "INSERT INTO public.editorial_reviews(collection_slug,document_id,content_revision,reviewer_id,result,reason_code,reviewed_at) VALUES($1,$2,$3,$4,'approved','synthetic',$5)",
        [ref.collection, ref.id, revision, cmsStaff, reviewed],
      );
      return ref;
    }
    return {
      ...f,
      appScope,
      publicScope,
      cmsScope,
      cmsAdmin,
      cmsStaff,
      role,
      document,
      update,
      cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
