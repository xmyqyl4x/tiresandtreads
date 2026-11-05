import type pg from 'pg';
import type { seedGateRecords } from './seed-schema-gate.ts';

// Fixed synthetic photo graph only. Not a production purge executor or retention policy.
export async function purgeGatePhoto(
  c: pg.Client,
  records: Awaited<ReturnType<typeof seedGateRecords>>,
) {
  const p = records.photo;
  await c.query('BEGIN');
  try {
    await c.query(
      "UPDATE app.job_runs SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=$1",
      [p.job],
    );
    await c.query('INSERT INTO privacy.asset_barriers(asset_id) VALUES($1),($2)', [
      p.original,
      p.sanitized,
    ]);
    await c.query(
      "UPDATE app.ai_budget_reservations SET state='settled',settled_minor=40,reconciled_at=clock_timestamp() WHERE id=$1",
      [p.reservation],
    );
    const accounting = (
      await c.query(
        'SELECT reserved_minor::int,spent_minor::int FROM app.ai_budget_windows WHERE id=$1',
        [p.budget],
      )
    ).rows[0];
    await c.query('DELETE FROM app.confirmed_photo_fields WHERE upload_id=$1', [p.upload]);
    await c.query('DELETE FROM app.photo_field_candidates WHERE extraction_id=$1', [p.extraction]);
    await c.query('DELETE FROM app.photo_extractions WHERE id=$1', [p.extraction]);
    await c.query('DELETE FROM app.ai_artifact_sources WHERE artifact_id=$1', [p.artifact]);
    await c.query('DELETE FROM app.ai_artifacts WHERE id=$1', [p.artifact]);
    await c.query('DELETE FROM app.ai_budget_reservations WHERE id=$1', [p.reservation]);
    const afterPurge = (
      await c.query(
        'SELECT reserved_minor::int,spent_minor::int FROM app.ai_budget_windows WHERE id=$1',
        [p.budget],
      )
    ).rows[0];
    await c.query('DELETE FROM app.ai_attempts WHERE id=$1', [p.attempt]);
    await c.query('DELETE FROM app.ai_analysis_requests WHERE id=$1', [p.request]);
    await c.query('DELETE FROM app.photo_asset_claims WHERE upload_id=$1', [p.upload]);
    await c.query('DELETE FROM app.tire_photo_uploads WHERE id=$1', [p.upload]);
    await c.query('DELETE FROM app.ai_scope_guards WHERE scope_id=$1', [p.scope]);
    await c.query('DELETE FROM app.ai_reuse_scopes WHERE id=$1', [p.scope]);
    await c.query('DELETE FROM app.ai_budget_windows WHERE id=$1', [p.budget]);
    await c.query('DELETE FROM app.ai_policy_versions WHERE id=$1', [p.policy]);
    await c.query('DELETE FROM app.object_assets WHERE id=ANY($1)', [[p.original, p.sanitized]]);
    await c.query('DELETE FROM app.job_runs WHERE id=$1', [p.job]);
    await c.query('COMMIT');
    return { accounting, afterPurge };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  }
}
