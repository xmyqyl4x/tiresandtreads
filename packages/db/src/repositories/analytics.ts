import type { AnalyticsRepository, Metric } from '../../../application/src/ports/analytics.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { boundedJson, digest, reject } from './bounds.ts';
import { integer, jsonObject, one, rev, rid, text, lockSubjects } from './private-values.ts';

function batchLimit(value: number) {
  if (integer(value) > 1000) reject();
  return value;
}
export function createAnalyticsRepository(scope: WriteScope): AnalyticsRepository {
  const q = scope.query;
  async function dirty(tx: Parameters<typeof q>[0], days: readonly unknown[]) {
    if (days.length) await q(tx, 'SELECT analytics.invalidate_days($1::date[],true)', [days]);
  }
  return guarded(scope, {
    async receive(tx, c, events) {
      if (
        !Array.isArray(events) ||
        events.length < 1 ||
        events.length > 50 ||
        new Set(events.map((e) => e.id)).size !== events.length
      )
        reject();
      boundedJson(events, 65536);
      text(c.scope);
      text(c.policy, 100);
      await lockSubjects(scope, tx, [c.subjectId]);
      const permission = await q(
        tx,
        `SELECT s.id FROM app.subjects s JOIN privacy.consent_state c ON c.subject_id=s.id WHERE s.id=$1 AND s.status='active' AND s.permission_revision=$2 AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp()) AND c.purpose='analytics' AND c.scope_key=$3 AND c.policy_version=$4 AND c.status='confirmed' AND c.effective_at<=clock_timestamp() AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())`,
        [c.subjectId, c.permission.toString(), c.scope, c.policy],
      );
      if (!permission.rows.length) stop('forbidden');
      const days = new Set<string>();
      let inserted = 0;
      for (const e of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
        const hash = digest({ ...e, context: { ...c, permission: c.permission.toString() } });
        const r = await q(
          tx,
          `INSERT INTO analytics.events(id,subject_id,session_ref,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at)
      VALUES($1,$2,$3,$4,1,$5,statement_timestamp(),$6,$7,$8,$9,$10,$11,$12,$13,$14,statement_timestamp()+interval '13 months') ON CONFLICT(id) DO NOTHING RETURNING event_day::text`,
          [
            e.id,
            c.subjectId,
            e.sessionId,
            e.name,
            e.occurredAt,
            e.market,
            e.locale,
            e.route,
            e.channel,
            c.permission.toString(),
            c.policy,
            jsonObject(e.props, 4096),
            Buffer.from(hash, 'hex'),
            e.bot,
          ],
        );
        if (r.rows.length) {
          inserted++;
          days.add(String(one(r.rows).event_day));
        } else {
          const prior = one(
            (
              await q(tx, 'SELECT subject_id,payload_digest FROM analytics.events WHERE id=$1', [
                e.id,
              ])
            ).rows,
          );
          if (
            prior.subject_id !== c.subjectId ||
            !Buffer.isBuffer(prior.payload_digest) ||
            prior.payload_digest.toString('hex') !== hash
          )
            stop('conflict');
        }
      }
      if (days.size)
        await q(tx, 'SELECT analytics.invalidate_days($1::date[],false)', [[...days].sort()]);
      return { inserted };
    },
    async capture(tx, seconds) {
      if (integer(seconds) > 300) reject();
      // One SQL statement supplies one MVCC snapshot for generation, restrictions and all source counts.
      const r = await q(
        tx,
        `WITH candidate AS (
     SELECT day FROM analytics.dirty_days WHERE completed_revision<requested_revision AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND attempts<1000 ORDER BY next_attempt_at,day LIMIT 1 FOR UPDATE SKIP LOCKED
    ), leased AS (
     UPDATE analytics.dirty_days d SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+$1*interval '1 second',attempts=attempts+1,updated_at=clock_timestamp(),revision=revision+1 FROM candidate c WHERE d.day=c.day RETURNING d.*
    ), totals AS (
     SELECT e.market,CASE WHEN grouping(e.channel)=1 THEN 'all' ELSE e.channel END AS dimension,count(*)::text AS events,count(DISTINCT (e.subject_id,e.session_ref)) FILTER(WHERE e.session_ref IS NOT NULL)::text AS sessions
     FROM analytics.events e JOIN leased l ON l.day=e.event_day JOIN app.subjects s ON s.id=e.subject_id
     WHERE s.status='active' AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp()) AND e.expires_at>statement_timestamp() AND e.bot_classification NOT IN ('internal','suspected_bot')
     GROUP BY GROUPING SETS((e.market),(e.market,e.channel))
    ) SELECT l.day::text,l.lease_token,l.requested_revision,l.privacy_revision,COALESCE((SELECT jsonb_agg(t) FROM totals t),'[]'::jsonb) AS totals FROM leased l`,
        [seconds],
      );
      const x = r.rows[0];
      if (!x) return null;
      const totals = x.totals as {
        market: string;
        dimension: Metric['dimension'];
        events: string;
        sessions: string;
      }[];
      return {
        day: String(x.day),
        token: rid('lease', x.lease_token),
        generation: rev(x.requested_revision),
        privacyRevision: BigInt(String(x.privacy_revision)),
        metrics: totals.flatMap((t) =>
          (['events', 'sessions'] as const).map((metric) => ({
            metric,
            market: t.market,
            dimension: t.dimension,
            value: BigInt(t[metric]),
          })),
        ),
      };
    },
    async publish(tx, b) {
      if (!Array.isArray(b.metrics) || b.metrics.length > 1000) reject();
      one(
        (
          await q(
            tx,
            `SELECT day FROM analytics.dirty_days WHERE day=$1 AND lease_token=$2 AND lease_until>clock_timestamp() AND privacy_revision=$3 AND completed_revision<$4 AND requested_revision>=$4 FOR UPDATE`,
            [b.day, b.token, b.privacyRevision.toString(), b.generation.toString()],
          )
        ).rows,
      );
      await q(tx, 'DELETE FROM analytics.daily_metrics WHERE day=$1', [b.day]);
      for (const m of b.metrics)
        await q(
          tx,
          'INSERT INTO analytics.daily_metrics(day,metric_code,market,dimension_key,value,generation,computed_at,definition_version) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)',
          [
            b.day,
            m.metric,
            m.market,
            m.dimension,
            m.value.toString(),
            b.generation.toString(),
            'internal-v1',
          ],
        );
      await q(
        tx,
        `UPDATE analytics.dirty_days SET completed_revision=$2,completed_at=clock_timestamp(),privacy_blocked=false,lease_token=NULL,lease_until=NULL,attempts=0,last_error_code=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 WHERE day=$1`,
        [b.day, b.generation.toString()],
      );
    },
    async retry(tx, b) {
      one(
        (
          await q(
            tx,
            `UPDATE analytics.dirty_days SET lease_token=NULL,lease_until=NULL,last_error_code='rebuild_retry',next_attempt_at=clock_timestamp()+least(300,power(2,least(attempts,8))) * interval '1 second',updated_at=clock_timestamp(),revision=revision+1 WHERE day=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING day`,
            [b.day, b.token],
          )
        ).rows,
      );
    },
    async purgeSubject(tx, subjectId, limit) {
      batchLimit(limit);
      await lockSubjects(scope, tx, [subjectId]);
      if (
        !(await q(tx, "SELECT id FROM app.subjects WHERE id=$1 AND status<>'active'", [subjectId]))
          .rows.length
      )
        stop('forbidden');
      const r = await q(
        tx,
        `WITH batch AS(SELECT id FROM analytics.events WHERE subject_id=$1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED) DELETE FROM analytics.events e USING batch b WHERE e.id=b.id RETURNING e.event_day::text`,
        [subjectId, limit],
      );
      await dirty(
        tx,
        r.rows.map((x) => x.event_day),
      );
      return r.rowCount;
    },
    async cleanup(tx, limit) {
      const r = await q(
        tx,
        `WITH batch AS(SELECT id FROM analytics.events WHERE expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM analytics.events e USING batch b WHERE e.id=b.id RETURNING e.event_day::text`,
        [batchLimit(limit)],
      );
      await dirty(
        tx,
        r.rows.map((x) => x.event_day),
      );
      return r.rowCount;
    },
  } satisfies AnalyticsRepository);
}
