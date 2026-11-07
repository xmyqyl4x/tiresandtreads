import type {
  AnalysisCommandCache,
  AnalysisExecutionRuntime,
} from '../../../application/src/ports/analysis-execution.ts';
import type { AnalysisAdmission } from '../../../application/src/ports/report-analysis.ts';
import type { AIRequest, AIPolicy } from '../../../domain/src/entities/analysis.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import {
  estimateAnalysisReservation,
  analysisRetry,
} from '../../../domain/src/analysis-reuse-policy.ts';
import { createAIRequestRepository } from './analysis-requests.ts';
import { canonicalManifest } from './analysis-input.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, hash, big, num, type Row } from './analysis-values.ts';
export function createAnalysisExecutionSupport(
  s: WriteScope,
  options: Readonly<{ photoJobs?: boolean }> = {},
) {
  const q = s.query,
    requests = createAIRequestRepository(s);
  async function root(tx: Tx, request: AIRequest) {
    await q(tx, 'SELECT app.ai_repository_scope($1,false)', [uid('ai_scope', request.scopeId)]);
  }
  async function price(tx: Tx, policy: unknown) {
    return (
      (
        await q(
          tx,
          "SELECT c.* FROM app.ai_cost_plans c JOIN app.ai_policy_versions p ON p.id=c.policy_id AND p.configuration_hash=c.configuration_hash WHERE c.policy_id=$1 AND c.status='active' AND p.status='active' FOR SHARE OF c,p",
          [uid('ai_policy', policy)],
        )
      ).rows[0] ?? null
    );
  }
  async function plan(tx: Tx, policy: AIPolicy, request: AIRequest) {
    const p = await price(tx, policy.id);
    if (!p) return null;
    const estimated = estimateAnalysisReservation({
      inputCeiling: String(p.input_ceiling),
      outputCeiling: String(p.output_ceiling),
      inputPerMillionMinor: String(p.input_per_million_minor),
      outputPerMillionMinor: String(p.output_per_million_minor),
    });
    if (!estimated.ok) return stop('integrity');
    const clock = (
      await q(
        tx,
        "SELECT date_trunc('day',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day,date_trunc('hour',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour",
      )
    ).rows[0]!;
    const desired = [
      { key: 'p2:' + policy.id + ':day', start: clock.day, seconds: 86400, limit: p.daily_limit },
      { key: 'p2:' + policy.id + ':hour', start: clock.hour, seconds: 3600, limit: p.hourly_limit },
    ];
    if (request.ownerId)
      desired.push({
        key: 'p2:' + policy.id + ':owner:' + request.ownerId,
        start: clock.day,
        seconds: 86400,
        limit: p.owner_daily_limit,
      });
    const windows = [];
    for (const w of desired) {
      await q(
        tx,
        "INSERT INTO app.ai_budget_windows(policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$2,$3::timestamptz,$3::timestamptz+make_interval(secs=>$4),'USD',$5) ON CONFLICT(policy_key,window_start,currency_code) DO NOTHING",
        [w.key, policy.id, w.start, w.seconds, String(w.limit)],
      );
      const r = (
        await q(
          tx,
          "SELECT * FROM app.ai_budget_windows WHERE policy_key=$1 AND window_start=$2 AND currency_code='USD'",
          [w.key, w.start],
        )
      ).rows[0];
      if (!r || r.policy_version_id !== policy.id || String(r.limit_minor) !== String(w.limit))
        return stop('integrity');
      windows.push({ id: uid('ai_budget', r.id), amountMinor: estimated.value });
    }
    return {
      configurationHash: hash(p.configuration_hash),
      currency: 'USD' as const,
      windows,
      inputCeiling: big(p.input_ceiling),
      outputCeiling: big(p.output_ceiling),
    };
  }
  const admission: AnalysisAdmission = {
    async plan(tx, policy, _scope, request) {
      return plan(tx, policy, request);
    },
  };
  const cache: AnalysisCommandCache = guarded<AnalysisCommandCache>(s, {
    async lookup(tx, i) {
      await q(tx, 'SELECT app.ai_repository_scope($1,true)', [i.scope.id]);
      const digest = (
        await q(tx, 'SELECT app.ai_input_digest($1,$2,$3,$4::jsonb) AS digest', [
          i.scope.id,
          i.policy.id,
          i.policy.canonicalVersion,
          canonicalManifest(i.manifest, i.policy, i.scope),
        ])
      ).rows[0]!.digest;
      const receipt = (
        await q(tx, 'SELECT * FROM app.ai_report_commands WHERE scope_id=$1 AND command_key=$2', [
          i.scope.id,
          i.key,
        ])
      ).rows[0];
      if (receipt) {
        if (
          receipt.digest !== digest ||
          receipt.permission_revision !== i.scope.permissionRevision.toString() ||
          receipt.invalidation_revision !== i.scope.invalidationRevision.toString() ||
          receipt.report_id !== i.reportId ||
          receipt.report_version !== i.version
        )
          return stop('conflict');
        return requests.get(tx, uid('ai_request', receipt.request_id));
      }
      const r = (
        await q(
          tx,
          `SELECT r.id FROM app.ai_analysis_requests r JOIN app.ai_report_work w ON w.request_id=r.id WHERE r.scope_id=$1 AND r.input_digest=$2 AND w.report_id=$3 AND w.report_version=$4 AND app.ai_service_current(r.id) AND ((r.state IN('queued','running') AND r.expires_at>clock_timestamp()) OR (r.state='accepted' AND EXISTS(SELECT 1 FROM app.ai_current_reuse c WHERE c.scope_id=r.scope_id AND c.cache_key=r.input_digest AND c.artifact_id IN(SELECT id FROM app.ai_artifacts WHERE request_id=r.id)))) ORDER BY r.created_at DESC,r.id LIMIT 1`,
          [i.scope.id, digest, i.reportId, i.version],
        )
      ).rows[0];
      return r ? requests.get(tx, uid('ai_request', r.id)) : null;
    },
    async remember(tx, i) {
      await q(
        tx,
        'INSERT INTO app.ai_report_commands(scope_id,command_key,digest,permission_revision,invalidation_revision,request_id,report_id,report_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [
          i.scope.id,
          i.key,
          i.request.digest,
          i.scope.permissionRevision.toString(),
          i.scope.invalidationRevision.toString(),
          i.request.id,
          i.reportId,
          i.version,
        ],
      );
      const r = (
        await q(tx, 'SELECT * FROM app.ai_report_commands WHERE scope_id=$1 AND command_key=$2', [
          i.scope.id,
          i.key,
        ])
      ).rows[0];
      if (
        !r ||
        r.request_id !== i.request.id ||
        r.digest !== i.request.digest ||
        r.permission_revision !== i.scope.permissionRevision.toString() ||
        r.invalidation_revision !== i.scope.invalidationRevision.toString() ||
        r.report_id !== i.reportId ||
        r.report_version !== i.version
      )
        return stop('conflict');
    },
  });
  async function circuit(tx: Tx, policy: unknown) {
    const p = uid('ai_policy', policy);
    await q(
      tx,
      'INSERT INTO app.ai_provider_circuits(policy_id) VALUES($1) ON CONFLICT DO NOTHING',
      [p],
    );
    return (
      await q(
        tx,
        'SELECT *,open_until>clock_timestamp() AS cooling,probe_until>clock_timestamp() AS probing FROM app.ai_provider_circuits WHERE policy_id=$1 FOR UPDATE',
        [p],
      )
    ).rows[0]!;
  }
  async function block(tx: Tx, request: AIRequest) {
    await q(
      tx,
      "UPDATE app.ai_analysis_requests SET state='failed' WHERE id=$1 AND state IN('queued','running')",
      [request.id],
    );
    await q(tx, 'SELECT app.ai_release_terminal_lease($1)', [request.id]);
    await q(
      tx,
      "UPDATE app.job_runs SET state='cancelled',lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp(),revision=revision+1 WHERE resource_id=$1 AND job_type IN('ai.report-analysis','ai.generic-analysis') AND state IN('pending','failed')",
      [request.id],
    );
    if (options.photoJobs)
      await q(
        tx,
        "UPDATE app.job_runs SET state='cancelled',lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp(),revision=revision+1 WHERE job_type='p2.photo.extract' AND resource_id IN(SELECT id FROM app.photo_extractions WHERE request_id=$1) AND state IN('pending','failed')",
        [request.id],
      );
  }
  async function signal(tx: Tx, p: unknown, c: Row, generation: bigint, bad: boolean) {
    if (big(c.generation) !== generation) return;
    if (bad) {
      const failures = Math.min(3, num(c.failures) + 1);
      if (c.state === 'half_open' || failures >= 3)
        await q(
          tx,
          "UPDATE app.ai_provider_circuits SET state='open',failures=3,generation=generation+1,open_until=clock_timestamp()+interval '60 seconds',probe_until=NULL WHERE policy_id=$1",
          [p],
        );
      else
        await q(tx, 'UPDATE app.ai_provider_circuits SET failures=$2 WHERE policy_id=$1', [
          p,
          failures,
        ]);
    } else if (c.state !== 'open')
      await q(
        tx,
        "UPDATE app.ai_provider_circuits SET state='closed',failures=0,probe_until=NULL,open_until=NULL,generation=generation+CASE WHEN state='half_open' THEN 1 ELSE 0 END WHERE policy_id=$1",
        [p],
      );
  }
  const runtime: AnalysisExecutionRuntime = guarded<AnalysisExecutionRuntime>(s, {
    async next(tx, request, policy) {
      await root(tx, request);
      const c = await circuit(tx, policy.id),
        state = (
          await q(
            tx,
            'SELECT *,lease_until>clock_timestamp() AS live,next_at<=clock_timestamp() AS due FROM app.ai_execution_states WHERE request_id=$1 FOR UPDATE',
            [request.id],
          )
        ).rows[0];
      if (state?.state === 'inflight') {
        if (state.live === true) return null;
        await signal(tx, policy.id, c, big(state.circuit_generation), true);
        await q(
          tx,
          "UPDATE app.ai_execution_states SET state='uncertain',next_at=NULL WHERE request_id=$1",
          [request.id],
        );
        await q(tx, 'SELECT app.ai_recover_expired_dispatch($1)', [request.id]);
        return null;
      }
      if (
        state &&
        state.live !== true &&
        request.state === 'running' &&
        ['complete', 'failed', 'uncertain'].includes(String(state.state))
      ) {
        // The provider outcome committed, but publication/failure finalization did not.
        await q(tx, 'SELECT app.ai_recover_expired_dispatch($1)', [request.id]);
        return null;
      }
      if (state && (state.state !== 'retry' || state.due !== true)) return null;
      const alive = (
        await q(
          tx,
          "SELECT expires_at>clock_timestamp()+interval '30 seconds' AS alive FROM app.ai_analysis_requests WHERE id=$1 AND state IN('queued','running')",
          [request.id],
        )
      ).rows[0]?.alive;
      const pricing = await plan(tx, policy, request);
      if (
        !pricing ||
        alive !== true ||
        (c.state === 'open' && c.cooling === true) ||
        (c.state === 'half_open' && c.probing === true)
      ) {
        await block(tx, request);
        return null;
      }
      if (c.state === 'half_open') {
        await q(
          tx,
          "UPDATE app.ai_provider_circuits SET state='open',failures=3,generation=generation+1,probe_until=NULL,open_until=clock_timestamp()+interval '60 seconds' WHERE policy_id=$1",
          [policy.id],
        );
        await block(tx, request);
        return null;
      }
      await q(tx, 'SELECT app.ai_repository_budget_locks($1::uuid[])', [
        pricing.windows.map((w) => w.id),
      ]);
      const permitted = (
        await q(
          tx,
          'SELECT count(*)::int n FROM app.ai_budget_windows WHERE id=ANY($1::uuid[]) AND window_end>clock_timestamp() AND reserved_minor+spent_minor<=(limit_minor-$2::bigint)',
          [pricing.windows.map((w) => w.id), pricing.windows[0]!.amountMinor.toString()],
        )
      ).rows[0]!.n;
      if (permitted !== pricing.windows.length) {
        await block(tx, request);
        return null;
      }
      const p = await price(tx, policy.id);
      if (!p) {
        await block(tx, request);
        return null;
      }
      const active = (
        await q(
          tx,
          "SELECT count(*)::int n FROM app.ai_execution_states WHERE policy_id=$1 AND state='inflight' AND lease_until>clock_timestamp()",
          [policy.id],
        )
      ).rows[0]!.n;
      if (typeof active !== 'number' || active >= num(p.max_concurrency, 1, 4)) return null;
      let generation = big(c.generation);
      if (c.state === 'open') {
        const row = (
          await q(
            tx,
            "UPDATE app.ai_provider_circuits SET state='half_open',generation=generation+1,open_until=NULL,probe_until=clock_timestamp()+interval '30 seconds' WHERE policy_id=$1 RETURNING generation",
            [policy.id],
          )
        ).rows[0]!;
        generation = big(row.generation);
      }
      let lease = null;
      if (state) {
        const r = (
          await q(
            tx,
            "SELECT scope_id,cache_key,lease_holder,fence FROM app.ai_reuse_entries WHERE scope_id=$1 AND cache_key=$2 AND state='leased' AND lease_holder=$3 AND fence=$4 AND lease_until>clock_timestamp()",
            [request.scopeId, request.digest, state.lease_holder, state.reuse_fence],
          )
        ).rows[0];
        if (!r || num(state.ordinal) >= 3) {
          await block(tx, request);
          return null;
        }
        lease = {
          scopeId: request.scopeId,
          digest: request.digest,
          holder: uid('ai_holder', r.lease_holder),
          fence: big(r.fence) as import('../../../domain/src/values/core.ts').Revision,
        };
      }
      return { ordinal: state ? num(state.ordinal) + 1 : 1, lease, generation };
    },
    async begin(tx, i) {
      await root(tx, i.request);
      const previous = (
        await q(
          tx,
          'SELECT ordinal,state FROM app.ai_execution_states WHERE request_id=$1 FOR UPDATE',
          [i.request.id],
        )
      ).rows[0];
      if (
        previous &&
        (previous.state !== 'retry' || num(previous.ordinal) + 1 !== i.dispatch.ordinal)
      )
        return stop('conflict');
      await q(
        tx,
        `INSERT INTO app.ai_execution_states(request_id,policy_id,attempt_id,ordinal,lease_holder,reuse_fence,circuit_generation,state,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,'inflight',clock_timestamp()+interval '30 seconds') ON CONFLICT(request_id) DO UPDATE SET attempt_id=EXCLUDED.attempt_id,ordinal=EXCLUDED.ordinal,circuit_generation=EXCLUDED.circuit_generation,state='inflight',next_at=NULL,lease_until=EXCLUDED.lease_until WHERE app.ai_execution_states.state='retry'`,
        [
          i.request.id,
          i.request.policyId,
          i.attemptId,
          i.dispatch.ordinal,
          i.lease.holder,
          i.lease.fence.toString(),
          i.dispatch.generation.toString(),
        ],
      );
    },
    async terminal(tx, request) {
      await q(tx, 'SELECT app.ai_release_terminal_lease($1)', [request.id]);
    },
    async finish(tx, i) {
      await root(tx, i.request);
      const c = await circuit(tx, i.request.policyId),
        r = (
          await q(tx, 'SELECT * FROM app.ai_execution_states WHERE request_id=$1 FOR UPDATE', [
            i.request.id,
          ])
        ).rows[0];
      if (!r || r.attempt_id !== i.attemptId) return stop('conflict');
      if (r.state !== 'inflight') return r.state === 'retry';
      const planRow = await price(tx, i.request.policyId),
        reserve = (
          await q(
            tx,
            'SELECT min(reserved_minor)::text AS amount FROM app.ai_budget_reservations WHERE attempt_id=$1',
            [i.attemptId],
          )
        ).rows[0]?.amount;
      const exceeded =
        (i.response.costMinor !== null &&
          reserve !== null &&
          reserve !== undefined &&
          i.response.costMinor > big(reserve)) ||
        (planRow &&
          ((i.response.inputTokens !== null &&
            i.response.inputTokens > big(planRow.input_ceiling)) ||
            (i.response.outputTokens !== null &&
              i.response.outputTokens > big(planRow.output_ceiling))));
      if (exceeded)
        await q(tx, "UPDATE app.ai_cost_plans SET status='blocked' WHERE policy_id=$1", [
          i.request.policyId,
        ]);
      await signal(
        tx,
        i.request.policyId,
        c,
        big(r.circuit_generation),
        !i.accepted && i.response.state !== 'refused',
      );
      const retry = exceeded
        ? null
        : analysisRetry(i.response.state, i.response.costMinor, num(r.ordinal), i.remainingMs);
      const state = retry
        ? 'retry'
        : i.accepted
          ? 'complete'
          : i.response.costMinor === null ||
              i.response.state === 'timeout' ||
              i.response.state === 'unavailable'
            ? 'uncertain'
            : 'failed';
      await q(
        tx,
        "UPDATE app.ai_execution_states SET state=$2,next_at=CASE WHEN $2='retry' THEN clock_timestamp()+make_interval(secs=>$3) ELSE NULL END WHERE request_id=$1",
        [i.request.id, state, retry ? retry.delayMs / 1000 : 0],
      );
      return retry !== null;
    },
  });
  return { cache, runtime, admission: guarded(s, admission) };
}
