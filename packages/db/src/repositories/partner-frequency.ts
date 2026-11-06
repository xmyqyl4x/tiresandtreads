import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import type { allocationInput } from './partner-allocation-input.ts';
import { stop, type WriteScope } from './mutations.ts';
import { reject } from './bounds.ts';

// SQL owns the evaluation clock/windows; a caller cannot shrink a rolling lookback.
export async function lockFrequencies(
  s: WriteScope,
  tx: Tx,
  p: ReturnType<typeof allocationInput>,
) {
  const q = s.query;
  for (const f of p.frequencies) {
    await q(
      tx,
      'INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,$2,$3) ON CONFLICT(subject_id,scope_key) DO NOTHING',
      [p.subjectId, f.scope, p.policyVersion],
    );
    const guard = (
      await q(
        tx,
        'SELECT policy_version FROM partners.frequency_guards WHERE subject_id=$1 AND scope_key=$2 FOR UPDATE',
        [p.subjectId, f.scope],
      )
    ).rows[0];
    if (guard?.policy_version !== p.policyVersion) return stop('conflict');
  }
  const clock = (
    await q(
      tx,
      "WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS at) SELECT at::text AS evaluated_at,(at+interval '1 microsecond'-interval '30 days')::text AS rolling_start,(at+interval '1 microsecond')::text AS rolling_end FROM clock",
    )
  ).rows[0]!;
  const result = [];
  for (const f of p.frequencies) {
    let start = String(clock.rolling_start),
      end = String(clock.rolling_end);
    if (f.kind === 'calendar_month') {
      const month = (
        await q(
          tx,
          "SELECT (date_trunc('month',$1::timestamptz AT TIME ZONE $2) AT TIME ZONE $2)::text AS start,((date_trunc('month',$1::timestamptz AT TIME ZONE $2)+interval '1 month') AT TIME ZONE $2)::text AS end WHERE EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=$2)",
          [clock.evaluated_at, f.timeZone],
        )
      ).rows[0];
      if (!month) return reject();
      start = String(month.start);
      end = String(month.end);
    }
    const current = (
      await q(
        tx,
        'SELECT state,window_kind,calendar_time_zone,policy_version,(reserved_at>=$3::timestamptz AND reserved_at<$4::timestamptz) AS in_window FROM partners.frequency_reservations WHERE send_id=$1 AND scope_key=$2',
        [p.sendId, f.scope, start, end],
      )
    ).rows[0];
    if (
      current &&
      (current.state === 'released' ||
        current.policy_version !== p.policyVersion ||
        current.window_kind !== f.kind ||
        current.calendar_time_zone !== f.timeZone ||
        !current.in_window)
    )
      return stop('conflict');
    const count = (
      await q(
        tx,
        "SELECT count(*)::int AS used FROM partners.frequency_reservations WHERE subject_id=$1 AND scope_key=$2 AND state<>'released' AND send_id<>$3 AND reserved_at>=$4::timestamptz AND reserved_at<$5::timestamptz",
        [p.subjectId, f.scope, p.sendId, start, end],
      )
    ).rows[0]!;
    if (Number(count.used) >= f.limit) return stop('conflict');
    result.push({ ...f, start, end, reservedAt: String(clock.evaluated_at) });
  }
  return result;
}
