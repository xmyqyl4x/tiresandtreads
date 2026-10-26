import type {
  AnalyticsMaintenance,
  AnalyticsAuthority,
  HealthRepository,
} from '../../../application/src/ports/analytics-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { integer, lockSubjects, rid, stamp, rev } from './private-values.ts';
import { createOwnerRepository } from './owners.ts';
export function createAnalyticsAuthority(scope: WriteScope): AnalyticsAuthority {
  const owners = createOwnerRepository(scope);
  return guarded(scope, {
    async grant(tx, keys, policy, noticeId) {
      const o = await owners.resolve(tx, keys);
      if (!o) return null;
      await lockSubjects(scope, tx, [o.subjectId]);
      const p = (
        await scope.query(
          tx,
          `SELECT s.permission_revision FROM app.subjects s JOIN privacy.consent_state p ON p.subject_id=s.id JOIN privacy.consent_events e ON e.id=p.source_event_id JOIN privacy.notices n ON n.id=e.notice_id WHERE s.id=$1 AND s.status='active' AND p.purpose='analytics' AND p.scope_key='site' AND p.status='confirmed' AND p.policy_version=$2 AND n.id=$3 AND n.purpose='analytics' AND n.market_policy=$2 AND n.published_at<=clock_timestamp() AND p.effective_at<=clock_timestamp() AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM analytics.processing_restrictions r WHERE r.subject_id=s.id AND r.scope_key='site') AND NOT EXISTS(SELECT 1 FROM privacy.suppressions z WHERE z.subject_id=s.id AND z.scope_key IN ('analytics','all-analytics','site') AND z.lifted_at IS NULL AND z.effective_at<=clock_timestamp() AND (z.expires_at IS NULL OR z.expires_at>clock_timestamp()))`,
          [o.subjectId, policy, noticeId],
        )
      ).rows[0];
      return p
        ? {
            subjectId: o.subjectId,
            permission: rev(p.permission_revision),
            scope: 'site',
            policy,
            sessionId: o.sessionId,
          }
        : null;
    },
  });
}
export function createAnalyticsMaintenance(scope: WriteScope): AnalyticsMaintenance {
  const q = scope.query;
  return guarded(scope, {
    async purgeWithdrawn(tx, limit) {
      if (integer(limit) > 1000) return stop('invalid_input');
      await q(
        tx,
        `WITH b AS(SELECT event_id FROM analytics.replay_barriers WHERE expires_at<=clock_timestamp() ORDER BY expires_at,event_id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM analytics.replay_barriers r USING b WHERE r.event_id=b.event_id`,
        [limit],
      );
      const candidate = (
        await q(
          tx,
          `SELECT subject_id,scope_key FROM analytics.processing_restrictions ORDER BY created_at,subject_id,scope_key LIMIT 1`,
        )
      ).rows[0];
      if (!candidate) return 0;
      await lockSubjects(scope, tx, [rid('subject', candidate.subject_id)]);
      const r = await q(
        tx,
        `WITH batch AS(SELECT id FROM analytics.events WHERE subject_id=$1 AND collection_scope=$2 ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED) DELETE FROM analytics.events e USING batch b WHERE e.id=b.id RETURNING e.id,e.received_at,e.event_day::text`,
        [candidate.subject_id, candidate.scope_key, limit],
      );
      if (r.rows.length)
        await q(
          tx,
          `INSERT INTO analytics.replay_barriers(event_id,expires_at) SELECT id,received_at+interval '25 hours' FROM jsonb_to_recordset($1::jsonb) AS b(id uuid,received_at timestamptz) ON CONFLICT(event_id) DO NOTHING`,
          [JSON.stringify(r.rows)],
        );
      if (r.rows.length)
        await q(tx, 'SELECT analytics.invalidate_days($1::date[],true)', [
          [...new Set(r.rows.map((x) => x.event_day))].sort(),
        ]);
      // Current withdrawn permission still blocks receipt after the last source row is removed.
      await q(
        tx,
        `DELETE FROM analytics.processing_restrictions r WHERE subject_id=$1 AND scope_key=$2 AND NOT EXISTS(SELECT 1 FROM analytics.events e WHERE e.subject_id=r.subject_id AND e.collection_scope=r.scope_key)`,
        [candidate.subject_id, candidate.scope_key],
      );
      return r.rowCount;
    },
    async expireGenerations(tx, limit) {
      if (integer(limit) > 1000) return stop('invalid_input');
      const rows = (
        await q(
          tx,
          `SELECT DISTINCT m.day::text FROM analytics.daily_metrics m JOIN analytics.dirty_days d ON d.day=m.day WHERE m.valid_until<=statement_timestamp() AND NOT d.privacy_blocked ORDER BY m.day::text LIMIT $1`,
          [limit],
        )
      ).rows;
      if (rows.length)
        await q(tx, 'SELECT analytics.invalidate_days($1::date[],true)', [rows.map((x) => x.day)]);
      return rows.length;
    },
  });
}
export function createHealthRepository(scope: WriteScope): HealthRepository {
  return guarded(scope, {
    async snapshot(tx) {
      const r = (await scope.query(tx, 'SELECT * FROM admin.runtime_health')).rows[0];
      if (!r) return stop('unavailable');
      const counts = [r.analytics_pending, r.sends_queued, r.sends_uncertain, r.outbox_pending].map(
        (v) => integer(v, 0),
      );
      return {
        sampledAt: stamp(r.sampled_at),
        analyticsPending: counts[0]!,
        sendsQueued: counts[1]!,
        sendsUncertain: counts[2]!,
        outboxPending: counts[3]!,
        quotaRows: integer(r.quota_rows, 0),
        quotaCapacity: integer(r.quota_capacity),
        capped: counts.some((v) => v === 1001),
      };
    },
  });
}
