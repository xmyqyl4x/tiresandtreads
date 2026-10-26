import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import pg from 'pg';
import { getPayload, type Payload } from 'payload';
import { cmsFoundationConfig } from '../../scripts/database/cms-config.ts';
import type { DatabaseRole } from '../../scripts/database/bootstrap.ts';

const hash = 'd'.repeat(64);
const staff = '22222222-2222-4222-8222-222222222222';

export function registerPublicOperationsTests(
  clients: () => Record<DatabaseRole, pg.Client>,
  ownerUrl: () => string,
) {
  function scenario(
    name: string,
    test: (
      db: pg.Client,
      deny: (sql: string, values?: unknown[], code?: string) => Promise<void>,
    ) => Promise<void>,
  ) {
    it(`P1-PR-007 ${name}`, async () => {
      const db = clients().tt_app_migrator;
      await db.query('BEGIN');
      async function deny(sql: string, values: unknown[] = [], code = '23514') {
        await db.query('SAVEPOINT denial');
        try {
          await expect(db.query(sql, values)).rejects.toMatchObject({ code });
        } finally {
          await db.query('ROLLBACK TO SAVEPOINT denial');
          await db.query('RELEASE SAVEPOINT denial');
        }
      }
      try {
        await test(db, deny);
      } finally {
        await db.query('ROLLBACK');
      }
    });
  }
  async function config(db: pg.Client) {
    return (
      await db.query(
        "INSERT INTO admin.configuration_versions(key,version,value,status,reviewed_by,published_at) VALUES('external_ads',1,'{}','published',$1,now()) RETURNING id",
        [staff],
      )
    ).rows[0].id as string;
  }
  async function page(db: pg.Client) {
    return (
      await db.query(
        "INSERT INTO admin.seo_page_registry(public_path,locale,market,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES('/learn/tread','en-US','US','education',$1,now()+interval '1 day','eligible','/learn/tread') RETURNING id",
        [staff],
      )
    ).rows[0].id as string;
  }
  scenario(
    'UC10 DB16 deduplicates immutable public projections without a CMS database dependency',
    async (db, deny) => {
      const sql =
        "INSERT INTO app.published_content(content_key,cms_revision,locale,market,public_dto,content_hash,published_at,schema_version) VALUES('synthetic','cms-1','en-US','US','{}',$1,now(),1)";
      await db.query(sql, [hash]);
      await deny(sql, [hash], '23505');
      await deny("UPDATE app.published_content SET public_dto='{}'");
      await deny(
        "INSERT INTO app.published_content(content_key,cms_revision,locale,market,public_dto,content_hash,published_at,schema_version) VALUES('bad','2','en-US','US','[]',$1,now(),1)",
        [hash],
      );
    },
  );
  scenario(
    'UC10 fixes published config and makes features default off with matching published keys',
    async (db, deny) => {
      const id = await config(db);
      await db.query(
        "INSERT INTO admin.feature_states(key,configuration_id) VALUES('external_ads',$1)",
        [id],
      );
      expect((await db.query('SELECT enabled FROM admin.feature_states')).rows[0].enabled).toBe(
        false,
      );
      await deny("UPDATE admin.configuration_versions SET value='{}' WHERE id=$1", [id]);
      await deny(
        "INSERT INTO admin.feature_states(key,configuration_id) VALUES('other',$1)",
        [id],
        '23503',
      );
    },
  );
  scenario(
    'UC17 DB27 excludes private paths, query tokens and invalid canonical targets from SEO',
    async (db, deny) => {
      const id = await page(db);
      for (const path of [
        '/reports/secret',
        '/learn/tread?token=secret',
        '//evil.invalid',
        '/learn/%2e%2e',
        '/admin',
        '/learn/private/extra',
      ])
        await deny('UPDATE admin.seo_page_registry SET public_path=$1 WHERE id=$2', [path, id]);
      await deny(
        "UPDATE admin.seo_page_registry SET canonical_path='/privacy/request' WHERE id=$1",
        [id],
      );
      await deny(
        "INSERT INTO admin.seo_page_registry(public_path,locale,market,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES('/learn/tread','en-US','US','education',$1,now(),'eligible','/learn/tread')",
        [staff],
        '23505',
      );
    },
  );
  scenario(
    'UC17 bounds SEO findings and search aggregates without raw queries',
    async (db, deny) => {
      const id = await page(db);
      await db.query(
        "INSERT INTO admin.search_daily_metrics(page_id,day,source,clicks,impressions,position_sum,source_revision,fetched_at) VALUES($1,current_date,'search_console',0,10,NULL,'1',now())",
        [id],
      );
      await deny('UPDATE admin.search_daily_metrics SET clicks=-1');
      await deny("UPDATE admin.search_daily_metrics SET position_sum='NaN'");
      await deny(
        "INSERT INTO admin.search_daily_metrics(page_id,day,source,clicks,impressions,source_revision,fetched_at) VALUES($1,current_date,'search_console',0,0,'2',now())",
        [id],
        '23505',
      );
      await deny(
        "INSERT INTO admin.seo_audit_runs(started_at,crawler_version,state,page_count) VALUES(now(),'test','completed',0)",
      );
    },
  );
  scenario(
    'UC17 stores public ad slots and separates unverified network accounts',
    async (db, deny) => {
      const id = await config(db);
      await db.query(
        "INSERT INTO admin.ad_slots(slot_key,route_class,configuration_id,status) VALUES('education_footer','education',$1,'disabled')",
        [id],
      );
      await deny(
        "INSERT INTO admin.ad_slots(slot_key,route_class,configuration_id,status) VALUES('private','report',$1,'active')",
        [id],
      );
      await deny(
        "INSERT INTO admin.ad_slots(slot_key,route_class,configuration_id,status) VALUES('assessment_home','home',$1,'active')",
        [id],
      );
      await deny(
        "INSERT INTO admin.ad_network_accounts(network,external_account_id,status,configuration_id) VALUES('adsense','synthetic','verified',$1)",
        [id],
      );
    },
  );
  scenario(
    'UC17 DB27 replaces ad corrections and hides omitted dimensions instead of summing old revisions',
    async (db, deny) => {
      const cfg = await config(db);
      const account = (
        await db.query(
          "INSERT INTO admin.ad_network_accounts(network,external_account_id,status,configuration_id) VALUES('adsense','synthetic','pending',$1) RETURNING id",
          [cfg],
        )
      ).rows[0].id;
      const importSql =
        "INSERT INTO admin.ad_report_imports(account_id,period_start,period_end,source_revision,source_generation,checksum,state,fetched_at) VALUES($1,current_date,current_date,$2,$3,$4,'staging',now()) RETURNING id";
      const first = (await db.query(importSql, [account, 'v1', 1, hash])).rows[0].id;
      await db.query(
        "INSERT INTO admin.ad_daily_metrics(import_id,day,dimension_key,currency,impressions,revenue_minor,revenue_status) VALUES($1,current_date,'all','USD',20,100,'estimated')",
        [first],
      );
      await deny(
        'UPDATE admin.ad_report_imports SET period_start=current_date+1,period_end=current_date+1 WHERE id=$1',
        [first],
      );
      await deny(
        "INSERT INTO admin.ad_daily_metrics(import_id,day,dimension_key,currency,impressions,revenue_minor,revenue_status) VALUES($1,current_date,'report:private','USD',1,1,'estimated')",
        [first],
      );
      await deny(
        "INSERT INTO admin.ad_daily_metrics(import_id,day,dimension_key,currency,impressions,revenue_minor,revenue_status) VALUES($1,current_date+1,'all','USD',1,1,'estimated')",
        [first],
      );
      await db.query("UPDATE admin.ad_report_imports SET state='approved' WHERE id=$1", [first]);
      await deny('UPDATE admin.ad_daily_metrics SET revenue_minor=99 WHERE import_id=$1', [first]);
      await deny(importSql, [account, 'v1', 2, hash], '23505');
      expect(
        (await db.query('SELECT revenue_minor FROM admin.current_ad_daily_metrics')).rows,
      ).toEqual([{ revenue_minor: '100' }]);
      const second = (await db.query(importSql, [account, 'v2', 2, hash])).rows[0].id;
      await db.query(
        "INSERT INTO admin.ad_daily_metrics(import_id,day,dimension_key,currency,impressions,revenue_minor,revenue_status) VALUES($1,current_date,'all','USD',20,-20,'finalized')",
        [second],
      );
      await db.query("UPDATE admin.ad_report_imports SET state='approved' WHERE id=$1", [second]);
      expect(
        (await db.query('SELECT revenue_minor,revenue_status FROM admin.current_ad_daily_metrics'))
          .rows,
      ).toEqual([{ revenue_minor: '-20', revenue_status: 'finalized' }]);
    },
  );
  scenario(
    'UC08 DB17 deduplicates events and rejects private routes, arbitrary properties and invalid times',
    async (db, deny) => {
      const subject = (
        await db.query("INSERT INTO app.subjects(kind) VALUES('guest') RETURNING id")
      ).rows[0].id;
      const id = randomUUID();
      const sql =
        "INSERT INTO analytics.events(id,subject_id,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at) VALUES($1,$2,'public_page_view',1,now(),now(),'US','en-US','/learn/:slug','web',1,'test','{}',$3,'unknown',now()+interval '1 month')";
      await db.query(sql, [id, subject, randomBytes(32)]);
      await deny(sql, [id, subject, randomBytes(32)], '23505');
      await deny(
        "INSERT INTO analytics.events(id,subject_id,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at) VALUES($1,$2,'public_page_view',1,now(),now(),'US','en-US','/reports/secret','web',1,'test','{}',$3,'unknown',now()+interval '1 month')",
        [randomUUID(), subject, randomBytes(32)],
      );
      await deny('UPDATE analytics.events SET props=\'{"email":"forbidden"}\' WHERE id=$1', [id]);
      await deny(sql.replace("'{}'", '\'{"email":"forbidden"}\''), [
        randomUUID(),
        subject,
        randomBytes(32),
      ]);
      await deny(sql.replace('1,now(),now()', "1,now()-interval '25 hours',now()"), [
        randomUUID(),
        subject,
        randomBytes(32),
      ]);
      await deny(
        "UPDATE analytics.events SET occurred_at=received_at-interval '25 hours' WHERE id=$1",
        [id],
      );
      expect(
        (
          await db.query(
            "SELECT event_day=(received_at AT TIME ZONE 'UTC')::date AS correct FROM analytics.events WHERE id=$1",
            [id],
          )
        ).rows[0].correct,
      ).toBe(true);
    },
  );
  scenario(
    'UC08 DB17 DB18 hides invalidated or mismatched metric generations',
    async (db, deny) => {
      await db.query(
        'INSERT INTO analytics.dirty_days(day,requested_revision,completed_revision,requested_at,completed_at,next_attempt_at) VALUES(current_date,2,1,now(),now(),now())',
      );
      await db.query(
        "INSERT INTO analytics.daily_metrics(day,metric_code,market,dimension_key,value,generation,computed_at,definition_version) VALUES(current_date,'events','US','all',1,1,now(),'1')",
      );
      expect((await db.query('SELECT value FROM analytics.visible_daily_metrics')).rows).toEqual([
        { value: '1' },
      ]);
      await db.query('UPDATE analytics.dirty_days SET privacy_blocked=true,privacy_revision=2');
      expect((await db.query('SELECT * FROM analytics.visible_daily_metrics')).rows).toEqual([]);
      await deny('UPDATE analytics.dirty_days SET completed_revision=3');
      await deny('UPDATE analytics.dirty_days SET lease_token=gen_random_uuid()');
      await db.query('UPDATE analytics.dirty_days SET privacy_blocked=false,completed_revision=2');
      expect((await db.query('SELECT * FROM analytics.visible_daily_metrics')).rows).toEqual([]);
      await db.query('UPDATE analytics.daily_metrics SET generation=2');
      expect((await db.query('SELECT value FROM analytics.visible_daily_metrics')).rows).toEqual([
        { value: '1' },
      ]);
      await deny("UPDATE analytics.daily_metrics SET dimension_key='subject:private'", [], '23503');
    },
  );
  scenario(
    'DB19 binds capped buckets to policy, digest, aligned windows and bounded TTL',
    async (db, deny) => {
      const sql =
        "INSERT INTO app.rate_limit_buckets(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds,limit_value,used,expires_at) VALUES('report_email','1','test',$1,date_trunc('hour',now()),3600,3,1,date_trunc('hour',now())+interval '2 hours')";
      await db.query(sql, [randomBytes(32)]);
      await deny('UPDATE app.rate_limit_buckets SET used=4');
      await deny('UPDATE app.rate_limit_buckets SET limit_value=10', [], '23503');
      await deny("UPDATE app.rate_limit_buckets SET window_start=window_start+interval '1 second'");
      await deny("UPDATE app.rate_limit_buckets SET expires_at=window_start+interval '49 hours'");
      await deny('UPDATE app.rate_limit_buckets SET principal_hmac=$1', [randomBytes(2)]);
    },
  );
  scenario(
    'retains default-deny runtime access and omits the conditional computation cache',
    async (db) => {
      for (const role of ['tt_app_runtime', 'tt_staff_runtime', 'tt_asset_runtime'] as const)
        for (const table of [
          'app.published_content',
          'admin.seo_page_registry',
          'analytics.events',
          'analytics.visible_daily_metrics',
          'app.rate_limit_buckets',
        ])
          await expect(clients()[role].query(`SELECT * FROM ${table}`)).rejects.toMatchObject({
            code: '42501',
          });
      expect(
        (await db.query("SELECT to_regclass('app.computation_cache') AS name")).rows[0].name,
      ).toBeNull();
    },
  );
  it('P1-PR-007 DB19 serializes the final quota slot using a capped upsert', async () => {
    const first = clients().tt_app_migrator;
    const second = new pg.Client({ connectionString: ownerUrl(), connectionTimeoutMillis: 3000 });
    await second.connect();
    const digest = randomBytes(32);
    const sql =
      "INSERT INTO app.rate_limit_buckets(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds,limit_value,used,expires_at) VALUES('report_email','1','test',$1,date_trunc('hour',now()),3600,3,1,date_trunc('hour',now())+interval '2 hours') ON CONFLICT(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds) DO UPDATE SET used=app.rate_limit_buckets.used+1 WHERE app.rate_limit_buckets.used<app.rate_limit_buckets.limit_value RETURNING used";
    try {
      await first.query(sql, [digest]);
      await first.query(sql, [digest]);
      await first.query('BEGIN');
      expect((await first.query(sql, [digest])).rows[0].used).toBe(3);
      await second.query('BEGIN');
      await second.query("SET LOCAL lock_timeout='100ms'");
      await expect(second.query(sql, [digest])).rejects.toMatchObject({ code: '55P03' });
      await second.query('ROLLBACK');
      await first.query('COMMIT');
      expect((await second.query(sql, [digest])).rowCount).toBe(0);
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      await second.query('DELETE FROM app.rate_limit_buckets WHERE principal_hmac=$1', [digest]);
      await second.end();
    }
  });
}

export function registerCmsEditorialTests(
  clients: () => Record<DatabaseRole, pg.Client>,
  payload: () => Payload | undefined,
  ownerUrl: () => string,
) {
  it('P1-PR-007 UC10 edits drafts through Payload and preserves immutable version history', async () => {
    // Migrator credentials and access override exist only in this disposable storage proof.
    const cms = await getPayload({
      key: `editorial-proof-${randomUUID()}`,
      config: cmsFoundationConfig(ownerUrl(), randomBytes(32).toString('hex')),
    });
    let transactionID: number | string | null = null;
    try {
      transactionID = await cms.db.beginTransaction();
      if (!transactionID) throw new Error('CMS transactions are required');
      const article = await cms.create({
        collection: 'articles',
        req: { transactionID },
        draft: true,
        overrideAccess: true,
        data: {
          contentKey: 'payload-proof',
          locale: 'en-US',
          market: 'US',
          revision: 1,
          schemaVersion: 1,
          title: 'Original draft',
          body: {},
          reviewStatus: 'draft',
          _status: 'draft',
        },
      });
      await cms.create({
        collection: 'publication-work',
        overrideAccess: true,
        req: { transactionID },
        data: {
          collectionSlug: 'articles',
          documentId: article.id,
          contentRevision: 1,
          eventId: randomUUID(),
          publicDto: {},
          schemaVersion: 1,
        },
      });
      expect(
        (await clients().tt_cms_migrator.query('SELECT id FROM articles WHERE id=$1', [article.id]))
          .rows,
      ).toEqual([]);
      await cms.db.commitTransaction(transactionID);
      transactionID = null;
      expect(
        (
          await clients().tt_cms_migrator.query(
            'SELECT id FROM publication_work WHERE document_id=$1',
            [article.id],
          )
        ).rowCount,
      ).toBe(1);
      await cms.update({
        collection: 'articles',
        id: article.id,
        draft: true,
        overrideAccess: true,
        data: { title: 'Revised draft', revision: 2 },
      });
      const versions = await cms.findVersions({
        collection: 'articles',
        overrideAccess: true,
        where: { parent: { equals: article.id } },
        limit: 10,
      });
      expect(versions.docs.map((doc) => doc.version.title)).toEqual(
        expect.arrayContaining(['Original draft', 'Revised draft']),
      );
      const reviewer = (await clients().tt_cms_migrator.query('SELECT id FROM cms_staff LIMIT 1'))
        .rows[0].id as string;
      await cms.update({
        collection: 'articles',
        id: article.id,
        overrideAccess: true,
        data: {
          _status: 'published',
          reviewStatus: 'approved',
          reviewer,
          reviewedAt: new Date().toISOString(),
          sourceUrl: 'https://example.invalid/editorial-proof',
        },
      });
      await expect(
        clients().tt_cms_migrator.query(
          'UPDATE public._articles_v SET version_title=$1 WHERE parent_id=$2',
          ['Tampered', article.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      if (transactionID) await cms.db.rollbackTransaction(transactionID);
      await cms.destroy();
    }
  });
  it('P1-PR-007 UC10 creates editorial/version/review/publication storage only in the CMS database', async () => {
    for (const table of [
      'articles',
      '_articles_v',
      'glossary_terms',
      'topics',
      'explanation_templates',
      'media',
      'seo_metadata',
      'redirects',
      'editorial_reviews',
      'publication_work',
    ]) {
      expect(
        (
          await clients().tt_cms_migrator.query('SELECT to_regclass($1) AS name', [
            `public.${table}`,
          ])
        ).rows[0].name,
      ).toBe(table);
      expect(
        (
          await clients().tt_app_migrator.query('SELECT to_regclass($1) AS name', [
            `public.${table}`,
          ])
        ).rows[0].name,
      ).toBeNull();
    }
  });
  it('P1-PR-007 UC10 denies anonymous editorial reads and writes through real Payload and SQL runtime roles', async () => {
    const cms = payload();
    if (!cms) throw new Error('Missing CMS runtime');
    for (const collection of [
      'articles',
      'glossary-terms',
      'topics',
      'explanation-templates',
      'media',
      'seo-metadata',
      'redirects',
      'editorial-reviews',
      'publication-work',
    ]) {
      await expect(cms.find({ collection, overrideAccess: false })).rejects.toMatchObject({
        status: 403,
      });
    }
    await expect(
      cms.create({ collection: 'articles', overrideAccess: false, data: { title: 'Denied' } }),
    ).rejects.toMatchObject({ status: 403 });
    // PR-021 grants the trusted bridge source reads; Payload HTTP/local access checks still deny guests.
    await expect(
      clients().tt_cms_runtime.query('SELECT id FROM public.articles'),
    ).resolves.toBeDefined();
  });
  it('P1-PR-007 UC10 DB16 constrains publication identity and rolls back content plus work atomically', async () => {
    const db = clients().tt_cms_migrator;
    const document = randomUUID();
    await db.query('BEGIN');
    try {
      await db.query(
        "INSERT INTO articles(id,content_key,locale,market,revision,schema_version,title,body,review_status,_status) VALUES($1,'synthetic','en-US','US',1,1,'Synthetic','{}','draft','draft')",
        [document],
      );
      const sql =
        "INSERT INTO publication_work(collection_slug,document_id,content_revision,event_id,public_dto,schema_version,state,attempts,lease_generation) VALUES('articles',$1,1,$2,'{}',1,'pending',0,0)";
      await db.query(sql, [document, randomUUID()]);
      await db.query('SAVEPOINT duplicate');
      await expect(db.query(sql, [document, randomUUID()])).rejects.toMatchObject({
        code: '23505',
      });
      await db.query('ROLLBACK TO SAVEPOINT duplicate');
      await db.query('SAVEPOINT review');
      await expect(
        db.query("UPDATE articles SET _status='published' WHERE id=$1", [document]),
      ).rejects.toMatchObject({ code: '23514' });
      await db.query('ROLLBACK TO SAVEPOINT review');
      for (const statement of [
        'UPDATE publication_work SET public_dto=\'{"changed":true}\' WHERE document_id=$1',
        "UPDATE publication_work SET state='leased',lease_token=gen_random_uuid() WHERE document_id=$1",
        "UPDATE publication_work SET state='published' WHERE document_id=$1",
      ]) {
        await db.query('SAVEPOINT denied_work');
        await expect(db.query(statement, [document])).rejects.toMatchObject({ code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT denied_work');
      }
    } finally {
      await db.query('ROLLBACK');
    }
    expect((await db.query('SELECT id FROM articles WHERE id=$1', [document])).rows).toEqual([]);
    expect(
      (await db.query('SELECT id FROM publication_work WHERE document_id=$1', [document])).rows,
    ).toEqual([]);
  });
  it('P1-PR-007 UC17 constrains public redirect targets and 301/302/410 behavior', async () => {
    const db = clients().tt_cms_migrator;
    await db.query('BEGIN');
    try {
      const id = (
        await db.query(
          "INSERT INTO redirects(content_key,locale,market,revision,schema_version,title,review_status,_status,source_path,redirect_code) VALUES('retired','en-US','US',1,1,'Retired page','draft','draft','/learn/retired','410') RETURNING id",
        )
      ).rows[0].id;
      for (const sql of [
        "UPDATE redirects SET target_path='/learn/next' WHERE id=$1",
        "UPDATE redirects SET source_path='/reports/private' WHERE id=$1",
        "UPDATE redirects SET redirect_status='active' WHERE id=$1",
        "UPDATE redirects SET redirect_code='307' WHERE id=$1",
      ]) {
        await db.query('SAVEPOINT invalid_redirect');
        await expect(db.query(sql, [id])).rejects.toMatchObject({
          code: sql.includes("'307'") ? '22P02' : '23514',
        });
        await db.query('ROLLBACK TO SAVEPOINT invalid_redirect');
      }
      await db.query(
        "UPDATE redirects SET redirect_code='302',target_path='/learn/next' WHERE id=$1",
        [id],
      );
      await db.query("UPDATE redirects SET redirect_code='301' WHERE id=$1", [id]);
    } finally {
      await db.query('ROLLBACK');
    }
  });
}
