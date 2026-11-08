import type {
  AnalysisOperationsRepository,
  OperationsReceipt,
  AnalysisOperationsSnapshot,
  AnalysisTask,
} from '../../../application/src/ports/analysis-operations.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, word, hash, at, choice, type Row } from './analysis-values.ts';
const tasks = ['report_analysis', 'generic_explanation', 'photo_extraction'] as const;
function receipt(r: Row): OperationsReceipt {
  return Object.freeze({
    id: uid('ai_operation', r.id),
    operation: choice(r.operation, ['disable', 'resume']),
    target: uid('ai_target', r.target_id),
    state: choice(r.state, ['executing', 'succeeded', 'refused', 'unknown']),
    createdAt: at(r.created_at),
    finishedAt: r.finished_at === null ? null : at(r.finished_at),
  });
}
function counts(rows: readonly Row[], key: string, allowed: readonly string[]) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = choice(r[key], allowed);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.freeze(out);
}
export function createAnalysisOperationsRepository(s: WriteScope): AnalysisOperationsRepository {
  const q = s.query;
  async function get(
    tx: Parameters<AnalysisOperationsRepository['receipt']>[0],
    id: unknown,
    actor: unknown,
  ) {
    const r = (
      await q(
        tx,
        'SELECT id,operation,target_id,state,created_at,finished_at FROM admin.ai_operation_commands WHERE id=$1 AND actor_id=$2',
        [uid('ai_operation', id), uid('staff', actor)],
      )
    ).rows[0];
    return r ? receipt(r) : null;
  }
  return guarded<AnalysisOperationsRepository>(s, {
    async authorize(tx, actor, subject, permission) {
      return (
        (
          await q(tx, 'SELECT app.authorize_ai_operator($1,$2,$3) AS allowed', [
            uid('staff', actor),
            word(subject),
            choice(permission, ['ai.observe', 'ai.control', 'photo.observe']),
          ])
        ).rows[0]?.allowed === true
      );
    },
    async snapshot(tx, from, until, include) {
      const window = [at(from), at(until)],
        limit = 5000;
      let ai: AnalysisOperationsSnapshot['ai'] = null,
        photo: AnalysisOperationsSnapshot['photo'] = null;
      if (include.ai) {
        const requests = (
          await q(
            tx,
            `SELECT r.id,r.state,r.created_at,r.expires_at,p.task FROM app.ai_analysis_requests r JOIN app.ai_policy_versions p ON p.id=r.policy_version_id WHERE r.created_at>=$1 AND r.created_at<$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 5001`,
            window,
          )
        ).rows;
        const attempts = (
          await q(
            tx,
            `SELECT state,error_code,cost_status,cost_minor::text,currency_code FROM app.ai_attempts WHERE created_at>=$1 AND created_at<$2 ORDER BY created_at DESC,id DESC LIMIT 5001`,
            window,
          )
        ).rows;
        const reuse = (
          await q(
            tx,
            `SELECT state,(state='ready' AND valid_until<=clock_timestamp()) AS expired FROM app.ai_reuse_entries ORDER BY scope_id,cache_key LIMIT 5001`,
          )
        ).rows;
        const guards = (
          await q(
            tx,
            'SELECT state,invalidation_revision::text FROM app.ai_scope_guards ORDER BY scope_id LIMIT 5001',
          )
        ).rows;
        const policies = (
          await q(
            tx,
            'SELECT id,task,status,configuration_hash FROM app.ai_policy_versions ORDER BY id LIMIT 26',
          )
        ).rows;
        const rs = requests.slice(0, limit),
          ats = attempts.slice(0, limit),
          es = reuse.slice(0, limit),
          gs = guards.slice(0, limit);
        let reconciled = 0n,
          estimated = 0n,
          unknown = 0,
          other = 0;
        for (const a of ats) {
          const currency = word(a.currency_code, 3),
            status = choice(a.cost_status, ['unknown', 'estimated', 'reconciled']);
          if (status === 'unknown') {
            unknown++;
            if (a.cost_minor !== null) return stop('integrity');
          } else {
            const raw = word(a.cost_minor, 40);
            if (!/^\d{1,40}$/.test(raw)) return stop('integrity');
            if (currency === 'USD') {
              if (status === 'reconciled') reconciled += BigInt(raw);
              else estimated += BigInt(raw);
            }
          }
          if (currency !== 'USD') other++;
        }
        const queued = rs.slice(0, 25);
        const recorded = new Set(
          queued.length
            ? (
                await q(
                  tx,
                  `SELECT request_id FROM app.ai_report_work WHERE request_id=ANY($1::uuid[]) UNION SELECT request_id FROM app.photo_extractions WHERE request_id=ANY($1::uuid[]) UNION SELECT request_id FROM app.ai_generic_work WHERE request_id=ANY($1::uuid[])`,
                  [queued.map((r) => uid('ai_request', r.id))],
                )
              ).rows.map((r) => uid('ai_request', r.request_id))
            : [],
        );
        ai = Object.freeze({
          sampleLimit: 5000,
          requestsSampled: rs.length,
          requestsTruncated: requests.length > limit,
          requestStates: counts(rs, 'state', [
            'queued',
            'running',
            'accepted',
            'rejected',
            'failed',
            'uncertain',
            'cancelled',
          ]),
          attemptsSampled: ats.length,
          attemptsTruncated: attempts.length > limit,
          attemptStates: counts(ats, 'state', [
            'created',
            'started',
            'succeeded',
            'failed',
            'uncertain',
            'cancelled',
          ]),
          rejectionCodes: counts(
            ats.filter((a) => a.error_code !== null),
            'error_code',
            [
              'timeout',
              'refused',
              'invalid_output',
              'provider_unavailable',
              'cancelled',
              'unknown_charge',
            ],
          ),
          usdReconciledMinor: reconciled.toString(),
          usdEstimatedMinor: estimated.toString(),
          unknownCostAttempts: unknown,
          otherCurrencyAttempts: other,
          reuseSampled: es.length,
          reuseTruncated: reuse.length > limit,
          reuseStates: counts(es, 'state', ['empty', 'leased', 'ready', 'invalidated']),
          expiredStoredReady: es.filter((r) => r.expired === true).length,
          guardsSampled: gs.length,
          guardsTruncated: guards.length > limit,
          invalidatedGuards: gs.filter((r) => BigInt(word(r.invalidation_revision, 30)) > 0n)
            .length,
          guardStates: counts(gs, 'state', ['active', 'withdrawn', 'deleting']),
          policies: policies.slice(0, 25).map((p) => ({
            id: uid('ai_policy', p.id),
            task: choice(p.task, tasks),
            status: choice(p.status, ['draft', 'active', 'retired', 'blocked']),
            fingerprint: hash(p.configuration_hash),
          })),
          policiesTruncated: policies.length > 25,
          queue: queued.map((r) => ({
            id: uid('ai_request', r.id),
            task: choice(r.task, tasks),
            state: word(r.state, 20),
            recordedWork: recorded.has(uid('ai_request', r.id)),
            createdAt: at(r.created_at),
            expiresAt: at(r.expires_at),
          })),
        });
      }
      if (include.photo) {
        const confirmations = (
          await q(tx, 'SELECT origin FROM app.photo_operations_confirmations($1,$2)', window)
        ).rows;
        const purges = (
          await q(tx, 'SELECT phase,updated_at FROM privacy.ai_operations_purge_health()')
        ).rows;
        const cs = confirmations.slice(0, limit),
          ps = purges.slice(0, limit);
        photo = Object.freeze({
          sampleLimit: 5000,
          confirmationsSampled: cs.length,
          confirmationsTruncated: confirmations.length > limit,
          confirmationOrigins: counts(cs, 'origin', [
            'accepted_candidate',
            'corrected_candidate',
            'manual',
          ]),
          purgesSampled: ps.length,
          purgesTruncated: purges.length > limit,
          purgePhases: counts(ps, 'phase', [
            'journal',
            'prepare',
            'objects',
            'providers',
            'sql',
            'blocked',
          ]),
          oldestPendingUpdatedAt: ps.length ? at(ps[0]!.updated_at) : null,
        });
      }
      return Object.freeze({ ai, photo });
    },
    async claim(tx, i) {
      const id = uid('ai_operation', i.id),
        actor = uid('staff', i.actor),
        operation = choice(i.operation, ['disable', 'resume']),
        target = uid('ai_target', i.target),
        digest = hash(i.digest);
      const inserted = await q(
        tx,
        "INSERT INTO admin.ai_operation_commands(id,actor_id,operation,target_id,input_digest,state) VALUES($1,$2,$3,$4,$5,'executing') ON CONFLICT DO NOTHING RETURNING id",
        [id, actor, operation, target, digest],
      );
      const r = (
        await q(tx, 'SELECT * FROM admin.ai_operation_commands WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (
        !r ||
        r.actor_id !== actor ||
        r.operation !== operation ||
        r.target_id !== target ||
        r.input_digest !== digest
      )
        return stop('conflict');
      return { created: inserted.rows.length === 1, receipt: receipt(r) };
    },
    async finish(tx, id, actor, state) {
      const r = (
        await q(
          tx,
          "UPDATE admin.ai_operation_commands SET state=$3,finished_at=clock_timestamp() WHERE id=$1 AND actor_id=$2 AND state='executing' RETURNING id,operation,target_id,state,created_at,finished_at",
          [
            uid('ai_operation', id),
            uid('staff', actor),
            choice(state, ['succeeded', 'refused', 'unknown']),
          ],
        )
      ).rows[0];
      return r ? receipt(r) : stop('conflict');
    },
    receipt: get,
    async disable(tx, policy, fingerprint) {
      return (
        (
          await q(
            tx,
            "UPDATE app.ai_policy_versions SET status='blocked' WHERE id=$1 AND status='active' AND configuration_hash=$2 RETURNING id",
            [uid('ai_policy', policy), hash(fingerprint)],
          )
        ).rows.length === 1
      );
    },
    async work(tx, id): Promise<AnalysisTask | null> {
      const r = (
        await q(
          tx,
          "SELECT p.task FROM app.ai_analysis_requests r JOIN app.ai_policy_versions p ON p.id=r.policy_version_id WHERE r.id=$1 AND r.state IN('queued','running') AND r.expires_at>clock_timestamp() AND p.status='active' AND CASE p.task WHEN 'report_analysis' THEN EXISTS(SELECT 1 FROM app.ai_report_work w WHERE w.request_id=r.id) WHEN 'photo_extraction' THEN EXISTS(SELECT 1 FROM app.photo_extractions w WHERE w.request_id=r.id) WHEN 'generic_explanation' THEN EXISTS(SELECT 1 FROM app.ai_generic_work w WHERE w.request_id=r.id) ELSE false END",
          [uid('ai_request', id)],
        )
      ).rows[0];
      return r ? choice(r.task, tasks) : null;
    },
  });
}
