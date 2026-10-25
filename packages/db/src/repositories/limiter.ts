import type { LimiterRepository } from '../../../application/src/ports/limiter.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { reject } from './bounds.ts';
import { digestKeys, integer, text } from './private-values.ts';

export function createLimiterRepository(
  scope: WriteScope,
  activeKeyVersions: readonly string[],
): LimiterRepository {
  if (
    !activeKeyVersions.length ||
    activeKeyVersions.length > 4 ||
    new Set(activeKeyVersions).size !== activeKeyVersions.length
  )
    reject();
  activeKeyVersions.forEach((k) => text(k, 100));
  const q = scope.query;
  return guarded(scope, {
    async consume(tx, principals) {
      if (!Array.isArray(principals) || !principals.length || principals.length > 8) reject();
      const inputs = principals
        .map((p) => {
          const keys = digestKeys(p.keys);
          if (
            keys.length !== activeKeyVersions.length ||
            !activeKeyVersions.every((v) => keys.some((k) => k.key_version === v))
          )
            reject();
          return { policy: text(p.policy, 100), version: text(p.version, 100), keys };
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      // Lock every overlapping rotation alias in global order. Old/new deployments share the old lock.
      const locks = [
        ...new Set(inputs.flatMap((p) => p.keys.map((k) => `${k.key_version}:${k.digest}`))),
      ].sort();
      for (const lock of locks)
        await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,1203))', [lock]);
      const policies = await q(
        tx,
        `SELECT p.*,floor(extract(epoch FROM statement_timestamp())/p.window_seconds)*p.window_seconds AS window_epoch,ceil((floor(extract(epoch FROM statement_timestamp())/p.window_seconds)+1)*p.window_seconds-extract(epoch FROM statement_timestamp()))::integer AS retry
     FROM app.rate_limit_policies p JOIN jsonb_to_recordset($1::jsonb) AS i(policy text,version text) ON p.policy_key=i.policy AND p.policy_version=i.version ORDER BY p.policy_key,p.policy_version,p.window_seconds FOR SHARE OF p`,
        [
          JSON.stringify([
            ...new Map(
              inputs.map((p) => [
                p.policy + '\0' + p.version,
                { policy: p.policy, version: p.version },
              ]),
            ).values(),
          ]),
        ],
      );
      const writes: {
        policy: string;
        version: string;
        keyVersion: string;
        digest: string;
        epoch: string;
        seconds: number;
        limit: number;
        used: number;
      }[] = [];
      let retryAfterSeconds = 0;
      const seen = new Set<string>();
      for (const p of inputs) {
        const rows = policies.rows.filter(
          (r) => r.policy_key === p.policy && r.policy_version === p.version,
        );
        if (!rows.length || rows.some((r) => !r.enabled)) stop('forbidden');
        for (const r of rows) {
          const identity = p.policy + ':' + p.version + ':' + String(r.window_seconds);
          for (const k of p.keys) {
            const key = identity + ':' + k.key_version + ':' + k.digest;
            if (seen.has(key)) reject();
            seen.add(key);
          }
          const usage = await q(
            tx,
            `SELECT COALESCE(max(b.used),0)::integer AS used FROM app.rate_limit_buckets b JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON b.key_version=k.key_version AND b.principal_hmac=decode(k.digest,'hex') WHERE b.policy_key=$2 AND b.policy_version=$3 AND b.window_seconds=$4 AND b.window_start=to_timestamp($5::numeric)`,
            [JSON.stringify(p.keys), p.policy, p.version, r.window_seconds, r.window_epoch],
          );
          const used = Number(usage.rows[0]!.used);
          if (used >= Number(r.limit_value))
            retryAfterSeconds = Math.max(retryAfterSeconds, Number(r.retry));
          for (const k of p.keys)
            writes.push({
              policy: p.policy,
              version: p.version,
              keyVersion: k.key_version,
              digest: k.digest,
              epoch: String(r.window_epoch),
              seconds: Number(r.window_seconds),
              limit: Number(r.limit_value),
              used: used + 1,
            });
        }
      }
      if (retryAfterSeconds) return { allowed: false, retryAfterSeconds };
      for (const w of writes) {
        const r = await q(
          tx,
          `INSERT INTO app.rate_limit_buckets(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds,limit_value,used,expires_at)
     VALUES($1,$2,$3,$4,to_timestamp($5::numeric),$6,$7,$8,to_timestamp($5::numeric)+($6+3600)*interval '1 second')
     ON CONFLICT(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds) DO UPDATE SET used=greatest(rate_limit_buckets.used,excluded.used) WHERE rate_limit_buckets.used<rate_limit_buckets.limit_value RETURNING used`,
          [
            w.policy,
            w.version,
            w.keyVersion,
            Buffer.from(w.digest, 'hex'),
            w.epoch,
            w.seconds,
            w.limit,
            w.used,
          ],
        );
        if (!r.rows.length) stop('conflict');
      }
      return { allowed: true };
    },
    async cleanup(tx, limit) {
      if (integer(limit) > 1000) reject();
      return (
        await q(
          tx,
          `WITH batch AS(SELECT ctid FROM app.rate_limit_buckets WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM app.rate_limit_buckets b USING batch x WHERE b.ctid=x.ctid`,
          [limit],
        )
      ).rowCount;
    },
  } satisfies LimiterRepository);
}
