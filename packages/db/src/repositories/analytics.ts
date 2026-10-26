import type { AnalyticsRepository, Metric } from '../../../application/src/ports/analytics.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { boundedJson, digest, reject } from './bounds.ts';
import { integer, jsonObject, one, rev, rid, text, lockSubjects, stamp } from './private-values.ts';

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
        `SELECT s.id FROM app.subjects s JOIN analytics.current_permissions c ON c.subject_id=s.id WHERE s.id=$1 AND s.status='active' AND s.permission_revision=$2 AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp()) AND c.purpose='analytics' AND c.scope_key=$3 AND c.policy_version=$4 AND c.status='confirmed' AND date_trunc('milliseconds',c.effective_at)<=$5::timestamptz AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())
         AND NOT EXISTS(SELECT 1 FROM analytics.processing_restrictions r WHERE r.subject_id=s.id AND r.scope_key=$3)`,
        [
          c.subjectId,
          c.permission.toString(),
          c.scope,
          c.policy,
          events.map((e) => e.occurredAt).sort()[0],
        ],
      );
      if (!permission.rows.length) stop('forbidden');
      const days = new Set<string>();
      let inserted = 0;
      for (const e of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
        if (
          (
            await q(
              tx,
              'SELECT 1 FROM analytics.replay_barriers WHERE event_id=$1 AND expires_at>clock_timestamp()',
              [e.id],
            )
          ).rows.length
        )
          stop('forbidden');
        const hash = digest({ ...e, context: { ...c, permission: c.permission.toString() } });
        const r = await q(
          tx,
          `INSERT INTO analytics.events(id,subject_id,session_ref,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at,collection_scope)
      VALUES($1,$2,$3,$4,1,$5,statement_timestamp(),$6,$7,$8,$9,$10,$11,$12,$13,$14,statement_timestamp()+interval '13 months',$15) ON CONFLICT(id) DO NOTHING RETURNING event_day::text`,
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
            c.scope,
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
      // Lock the day first, then take a fresh source snapshot. A single READ COMMITTED UPDATE CTE
      // may recheck a newer day row while its sibling SELECT still sees older event rows.
      // Receipt/restriction/purge cannot commit changes to this day while we hold its row lock.
      const r = await q(
        tx,
        `WITH candidate AS (
     SELECT day FROM analytics.dirty_days WHERE completed_revision<requested_revision AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND attempts<1000 ORDER BY next_attempt_at,day LIMIT 1 FOR UPDATE SKIP LOCKED
    ), leased AS (
     UPDATE analytics.dirty_days d SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+$1*interval '1 second',attempts=attempts+1,updated_at=clock_timestamp(),revision=revision+1 FROM candidate c WHERE d.day=c.day RETURNING d.*
    ) SELECT day::text,lease_token,requested_revision,privacy_revision,statement_timestamp()+interval '24 hours' AS empty_until FROM leased`,
        [seconds],
      );
      const x = r.rows[0];
      if (!x) return null;
      const source = await q(
        tx,
        `
     SELECT e.market,CASE WHEN grouping(e.channel)=1 THEN 'all' ELSE e.channel END AS dimension,count(*)::text AS events,count(DISTINCT (e.subject_id,e.session_ref)) FILTER(WHERE e.session_ref IS NOT NULL)::text AS sessions,min(least(e.expires_at,s.expires_at,p.valid_until)) AS valid_until
     FROM analytics.events e JOIN app.subjects s ON s.id=e.subject_id JOIN analytics.current_permissions p ON p.subject_id=s.id AND p.purpose='analytics' AND p.scope_key=e.collection_scope AND p.status='confirmed' AND p.policy_version=e.policy_version
     WHERE e.event_day=$1 AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp()) AND e.expires_at>statement_timestamp() AND e.bot_classification NOT IN ('internal','suspected_bot')
     AND (p.expires_at IS NULL OR p.expires_at>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM analytics.processing_restrictions r WHERE r.subject_id=s.id AND r.scope_key=e.collection_scope)
     GROUP BY GROUPING SETS((e.market),(e.market,e.channel))`,
        [x.day],
      );
      const totals = source.rows as readonly {
        market: string;
        dimension: Metric['dimension'];
        events: string;
        sessions: string;
        valid_until: Date;
      }[];
      return {
        validUntil: totals.length
          ? stamp(totals.map((t) => t.valid_until).sort((a, b) => a.getTime() - b.getTime())[0])
          : stamp(x.empty_until),
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
          'INSERT INTO analytics.daily_metrics(day,metric_code,market,dimension_key,value,generation,computed_at,definition_version,valid_until) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8)',
          [
            b.day,
            m.metric,
            m.market,
            m.dimension,
            m.value.toString(),
            b.generation.toString(),
            'internal-v1',
            b.validUntil,
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
