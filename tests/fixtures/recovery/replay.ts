import type pg from 'pg';
import { digest } from '../../../scripts/database/inventory.ts';
import { context, subjectId, reportId, cmsId } from './context.ts';

export interface Journal {
  version: 1;
  project: string;
  capturedAt: string;
  marker: string;
  keyVersion: 'fixture';
}
export function validateJournal(value: unknown, backupAt: string): asserts value is Journal {
  const ctx = context('postgres');
  if (!value || typeof value !== 'object') throw new Error('Current recovery journal is required');
  const row = value as Record<string, unknown>;
  if (
    row.version !== 1 ||
    row.project !== ctx.project ||
    row.marker !== ctx.marker ||
    row.keyVersion !== 'fixture' ||
    !Number.isFinite(Date.parse(backupAt)) ||
    typeof row.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.capturedAt)) ||
    Date.parse(row.capturedAt) < Date.parse(backupAt) ||
    Date.parse(row.capturedAt) > Date.now() + 5000
  )
    throw new Error('Current recovery journal is required');
}

// This deliberately bounded fixture rehearses the dependency order, not a production privacy worker.
export async function restrictGraph(db: pg.Client, journal: Journal) {
  await db.query('BEGIN');
  try {
    await db.query(
      "UPDATE app.subjects SET status='pending_deletion',permission_revision=permission_revision+1 WHERE id=$1",
      [subjectId],
    );
    await db.query(
      "INSERT INTO privacy.deletion_markers(resource_kind,resource_key_hmac,key_version,deleted_at,policy_version) VALUES('subject',decode($1,'hex'),'fixture',$2,'fixture') ON CONFLICT(resource_kind,resource_key_hmac,key_version) DO NOTHING",
      [journal.marker, journal.capturedAt],
    );
    await db.query(
      "INSERT INTO privacy.suppression_tombstones(key_version,lookup_hmac,scope_key,reason_code,effective_at,review_after) VALUES('fixture',decode(repeat('ab',32),'hex'),'all','deletion',$1,$1::timestamptz+interval '1 year') ON CONFLICT(key_version,lookup_hmac,scope_key) DO NOTHING",
      [journal.capturedAt],
    );
    await db.query(
      'UPDATE app.owner_sessions SET revoked_at=now() WHERE subject_id=$1 AND revoked_at IS NULL',
      [subjectId],
    );
    await db.query(
      'UPDATE app.download_grants SET revoked_at=now() WHERE report_id=$1 AND revoked_at IS NULL',
      [reportId],
    );
    await db.query(
      "UPDATE email.email_sends SET dispatch_state='suppressed',recipient_contact_id=NULL,owner_subject_id=NULL,report_id=NULL,report_version=NULL,comparison_revision=NULL,payload_asset_id=NULL,payload_hash=NULL,notice_id=NULL,authorized_consent_revision=NULL,requested_purposes='[]',anonymized_at=now() WHERE owner_subject_id=$1 AND dispatch_state='scheduled'",
      [subjectId],
    );
    await db.query(
      "UPDATE app.outbox SET state='cancelled' WHERE aggregate_kind='subject' AND aggregate_id=$1",
      [subjectId],
    );
    await db.query(
      'UPDATE analytics.dirty_days SET requested_revision=requested_revision+1,privacy_revision=requested_revision+1,privacy_blocked=true WHERE day IN (SELECT event_day FROM analytics.events WHERE subject_id=$1)',
      [subjectId],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function purgeGraph(db: pg.Client) {
  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM analytics.events WHERE subject_id=$1', [subjectId]);
    await db.query('DELETE FROM app.download_grants WHERE report_id=$1', [reportId]);
    await db.query('DELETE FROM app.report_assets WHERE report_id=$1', [reportId]);
    await db.query("DELETE FROM app.object_assets WHERE id='88888888-8888-4888-8888-000000000041'");
    await db.query('DELETE FROM app.report_drafts WHERE report_id=$1', [reportId]);
    await db.query('DELETE FROM privacy.report_private_data WHERE report_id=$1', [reportId]);
    await db.query(
      "UPDATE app.reports SET status='pending_deletion',current_version=NULL WHERE id=$1",
      [reportId],
    );
    await db.query('DELETE FROM app.report_versions WHERE report_id=$1', [reportId]);
    await db.query('DELETE FROM app.reports WHERE id=$1', [reportId]);
    await db.query(
      'DELETE FROM privacy.contact_lookups WHERE contact_id IN (SELECT id FROM privacy.contacts WHERE subject_id=$1)',
      [subjectId],
    );
    await db.query('DELETE FROM privacy.contacts WHERE subject_id=$1', [subjectId]);
    await db.query('DELETE FROM app.owner_sessions WHERE subject_id=$1', [subjectId]);
    await db.query('DELETE FROM app.subjects WHERE id=$1', [subjectId]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function rebuildFixtureMetrics(db: pg.Client) {
  await db.query('BEGIN');
  try {
    await db.query('SELECT day FROM analytics.dirty_days ORDER BY day FOR UPDATE');
    await db.query('DELETE FROM analytics.daily_metrics');
    await db.query(
      "INSERT INTO analytics.daily_metrics(day,metric_code,market,dimension_key,value,generation,computed_at,definition_version) SELECT e.event_day,'events',e.market,'all',count(*),d.requested_revision,now(),'fixture' FROM analytics.events e JOIN analytics.dirty_days d ON d.day=e.event_day GROUP BY e.event_day,e.market,d.requested_revision",
    );
    await db.query(
      'UPDATE analytics.dirty_days SET completed_revision=requested_revision,completed_at=now(),privacy_blocked=false',
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function reconcileCms(app: pg.Client, cms: pg.Client, failAfterProjection = false) {
  const result = await cms.query(
    "SELECT w.*,a.content_key,a.locale,a.market FROM publication_work w JOIN articles a ON a.id::text=w.document_id AND a.revision=w.content_revision WHERE w.document_id=$1 AND a._status='published' AND a.review_status='approved'",
    [cmsId],
  );
  if (result.rows.length !== 1) throw new Error('CMS reconciliation requires a reviewed document');
  const row = result.rows[0];
  await app.query(
    'INSERT INTO app.published_content(content_key,cms_revision,locale,market,public_dto,schema_version,content_hash,published_at) VALUES($1,$2,$3,$4,$5,1,$6,now()) ON CONFLICT(content_key,cms_revision,locale,market) DO NOTHING',
    [
      row.content_key,
      String(row.content_revision),
      row.locale,
      row.market,
      JSON.stringify(row.public_dto),
      digest(row.public_dto),
    ],
  );
  const stored = (
    await app.query(
      'SELECT content_hash FROM app.published_content WHERE content_key=$1 AND cms_revision=$2 AND locale=$3 AND market=$4',
      [row.content_key, String(row.content_revision), row.locale, row.market],
    )
  ).rows[0];
  if (stored?.content_hash !== digest(row.public_dto)) throw new Error('Projection conflict');
  if (failAfterProjection) throw new Error('Injected crash after application commit');
  await cms.query(
    "UPDATE publication_work SET state='published',published_at=COALESCE(published_at,now()) WHERE id=$1",
    [row.id],
  );
}

export async function assertFixtureReady(
  app: pg.Client,
  cms: pg.Client,
  value: unknown,
  backupAt: string,
) {
  validateJournal(value, backupAt);
  const state = (
    await app.query(
      `SELECT
    NOT EXISTS(SELECT 1 FROM app.subjects WHERE id=$1) AS erased,
    EXISTS(SELECT 1 FROM privacy.deletion_markers WHERE resource_kind='subject' AND resource_key_hmac=decode($2,'hex') AND key_version='fixture') AS marked,
    EXISTS(SELECT 1 FROM privacy.suppression_tombstones WHERE key_version='fixture' AND lookup_hmac=decode(repeat('ab',32),'hex')) AS suppressed,
    NOT EXISTS(SELECT 1 FROM app.outbox WHERE aggregate_id=$1 AND state<>'cancelled') AS cancelled,
    NOT EXISTS(SELECT 1 FROM analytics.dirty_days WHERE privacy_blocked OR completed_revision<>requested_revision) AS rebuilt,
    EXISTS(SELECT 1 FROM app.published_content WHERE content_key='recovery-article' AND cms_revision='1') AS projected`,
      [subjectId, value.marker],
    )
  ).rows[0];
  const publication = (
    await cms.query('SELECT state FROM publication_work WHERE document_id=$1', [cmsId])
  ).rows;
  if (
    Object.values(state).some((ok) => ok !== true) ||
    publication.length !== 1 ||
    publication[0].state !== 'published'
  )
    throw new Error('Recovery remains quarantined');
}
