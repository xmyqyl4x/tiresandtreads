import type { AIRequestRepository } from '../../../application/src/ports/analysis-repositories.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { aiRequestFromRow, aiAttemptFromRow } from './analysis-mappers.ts';
import {
  uid,
  word,
  num,
  big,
  choice,
  stored,
  nullable,
  requestStates,
  type Row,
} from './analysis-values.ts';
import { canonicalManifest, manifestValue } from './analysis-input.ts';
import { createAIScopeRepository, lockScope } from './analysis-scope.ts';
import { boundedJson, reject } from './bounds.ts';
export async function lockRequest(s: WriteScope, tx: Tx, id: unknown, current = false) {
  const target = uid('ai_request', id),
    r = (await s.query(tx, 'SELECT scope_id FROM app.ai_analysis_requests WHERE id=$1', [target]))
      .rows[0];
  if (!r) return stop('not_found');
  await lockScope(s, tx, r.scope_id, current);
  return (
    (await s.query(tx, 'SELECT * FROM app.ai_analysis_requests WHERE id=$1 FOR UPDATE', [target]))
      .rows[0] ?? stop('not_found')
  );
}
export async function lockAttempt(s: WriteScope, tx: Tx, id: unknown): Promise<Row> {
  const target = uid('ai_attempt', id),
    r = (await s.query(tx, 'SELECT request_id FROM app.ai_attempts WHERE id=$1', [target])).rows[0];
  if (!r) return stop('not_found');
  await lockRequest(s, tx, r.request_id);
  return (
    (await s.query(tx, 'SELECT * FROM app.ai_attempts WHERE id=$1 FOR UPDATE', [target])).rows[0] ??
    stop('not_found')
  );
}
export function createAIRequestRepository(s: WriteScope): AIRequestRepository {
  const scopes = createAIScopeRepository(s);
  const repo: AIRequestRepository = {
    async create(tx, input) {
      const id = uid('ai_request', input.id),
        scopeId = uid('ai_scope', input.scopeId),
        key = word(input.key),
        manifest = manifestValue(input.manifest),
        seconds = num(input.deadlineSeconds, 1, 120);
      await lockScope(s, tx, scopeId);
      const scope = (await scopes.scope(tx, scopeId)) ?? stop('not_found'),
        policy = (await scopes.policy(tx, scope.policyId)) ?? stop('not_found'),
        json = canonicalManifest(manifest, policy, scope);
      const digest = (
        await s.query(tx, 'SELECT app.ai_input_digest($1,$2,$3,$4::jsonb) AS digest', [
          scopeId,
          policy.id,
          policy.canonicalVersion,
          json,
        ])
      ).rows[0]!.digest;
      const old = (
        await s.query(
          tx,
          'SELECT *,extract(epoch FROM expires_at-created_at)::integer AS deadline_seconds FROM app.ai_analysis_requests WHERE scope_id=$1 AND request_key=$2',
          [scopeId, key],
        )
      ).rows[0];
      if (old) {
        if (
          old.deadline_seconds !== seconds ||
          old.input_digest !== digest ||
          old.permission_revision !== scope.permissionRevision.toString() ||
          old.invalidation_revision !== scope.invalidationRevision.toString()
        )
          return stop('conflict');
        return stored(aiRequestFromRow(old));
      }
      const row = (
        await s.query(
          tx,
          `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock.at,clock.at+make_interval(secs=>$12) FROM (SELECT clock_timestamp() AS at) clock RETURNING *`,
          [
            id,
            scopeId,
            scope.ownerId,
            policy.id,
            digest,
            json,
            key,
            scope.noticeVersion,
            scope.permissionRevision.toString(),
            scope.subjectRevision?.toString() ?? null,
            scope.invalidationRevision.toString(),
            seconds,
          ],
        )
      ).rows[0]!;
      return stored(aiRequestFromRow(row));
    },
    async get(tx, id) {
      const r = (
        await s.query(tx, 'SELECT * FROM app.ai_analysis_requests WHERE id=$1', [
          uid('ai_request', id),
        ])
      ).rows[0];
      return r ? stored(aiRequestFromRow(r)) : null;
    },
    async transition(tx, id, expected, next) {
      choice(expected, requestStates);
      choice(next, requestStates);
      const r = await lockRequest(s, tx, id);
      if (r.state !== expected) {
        if (r.state === next) return stored(aiRequestFromRow(r));
        return stop('conflict');
      }
      return stored(
        aiRequestFromRow(
          (
            await s.query(
              tx,
              'UPDATE app.ai_analysis_requests SET state=$2 WHERE id=$1 RETURNING *',
              [id, next],
            )
          ).rows[0]!,
        ),
      );
    },
    async attempt(tx, input) {
      const id = uid('ai_attempt', input.id),
        requestId = uid('ai_request', input.requestId),
        ordinal = num(input.ordinal, 1, 3),
        currency = word(input.currency, 3);
      if (!/^[A-Z]{3}$/.test(currency)) return reject();
      const r = await lockRequest(s, tx, requestId, true),
        old = (
          await s.query(tx, 'SELECT * FROM app.ai_attempts WHERE request_id=$1 AND attempt=$2', [
            requestId,
            ordinal,
          ])
        ).rows[0];
      if (old) {
        if (old.id !== id || old.currency_code !== currency) return stop('conflict');
        return stored(aiAttemptFromRow(old));
      }
      return stored(
        aiAttemptFromRow(
          (
            await s.query(
              tx,
              'INSERT INTO app.ai_attempts(id,request_id,scope_id,policy_version_id,attempt,currency_code) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
              [id, requestId, r.scope_id, r.policy_version_id, ordinal, currency],
            )
          ).rows[0]!,
        ),
      );
    },
    async start(tx, id) {
      const r = await lockAttempt(s, tx, id);
      if (r.state === 'started') return stored(aiAttemptFromRow(r));
      if (r.state !== 'created') return stop('conflict');
      await lockRequest(s, tx, r.request_id, true);
      const holds = (
        await s.query(
          tx,
          'SELECT budget_id FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY budget_id',
          [id],
        )
      ).rows;
      if (holds.length < 1 || holds.length > 3) return stop('conflict');
      await s.query(tx, 'SELECT app.ai_repository_budget_locks($1::uuid[])', [
        holds.map((h) => h.budget_id),
      ]);
      const live = (
        await s.query(
          tx,
          "SELECT 1 FROM app.ai_budget_reservations h JOIN app.ai_budget_windows b ON b.id=h.budget_id WHERE h.attempt_id=$1 AND h.state='reserved' AND b.window_start<=clock_timestamp() AND b.window_end>clock_timestamp()",
          [id],
        )
      ).rows;
      if (live.length !== holds.length) return stop('conflict');
      return stored(
        aiAttemptFromRow(
          (
            await s.query(
              tx,
              "UPDATE app.ai_attempts SET state='started',started_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [id],
            )
          ).rows[0]!,
        ),
      );
    },
    async finish(tx, input) {
      const i = {
        id: uid('ai_attempt', input.id),
        state: choice(input.state, ['succeeded', 'failed', 'uncertain']),
        provider: nullable(input.providerRequestId, (v) => word(v, 300)),
        tokensIn: nullable(input.inputTokens, (v) => big(v).toString()),
        tokensOut: nullable(input.outputTokens, (v) => big(v).toString()),
        cost: nullable(input.costMinor, (v) => big(v).toString()),
        costStatus: choice(input.costStatus, ['unknown', 'estimated', 'reconciled']),
        error: nullable(input.error, (v) =>
          choice(v, [
            'timeout',
            'refused',
            'invalid_output',
            'provider_unavailable',
            'cancelled',
            'unknown_charge',
          ]),
        ),
      };
      if ((i.costStatus === 'unknown') !== (i.cost === null)) return reject();
      const old = await lockAttempt(s, tx, i.id);
      if (
        old.state === i.state &&
        boundedJson(
          [
            old.provider_request_id,
            old.input_tokens,
            old.output_tokens,
            old.cost_minor,
            old.cost_status,
            old.error_code,
          ],
          2048,
        ) ===
          boundedJson([i.provider, i.tokensIn, i.tokensOut, i.cost, i.costStatus, i.error], 2048)
      )
        return stored(aiAttemptFromRow(old));
      return stored(
        aiAttemptFromRow(
          (
            await s.query(
              tx,
              "UPDATE app.ai_attempts SET state=$2,provider_request_id=$3,input_tokens=$4,output_tokens=$5,cost_minor=$6,cost_status=$7,error_code=$8,finished_at=CASE WHEN $2 IN ('succeeded','failed') THEN coalesce(finished_at,clock_timestamp()) ELSE finished_at END WHERE id=$1 RETURNING *",
              [i.id, i.state, i.provider, i.tokensIn, i.tokensOut, i.cost, i.costStatus, i.error],
            )
          ).rows[0]!,
        ),
      );
    },
  };
  return guarded(s, repo);
}
