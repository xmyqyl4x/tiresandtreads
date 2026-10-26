import type {
  JobRepository,
  RelayRepository,
  CommandRepository,
  CommandResponse,
} from '../../../application/src/ports/jobs.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { hex, integer, jsonObject, one, rev, rid, text } from './private-values.ts';
import { createReliabilityRepository } from './reliability.ts';
import { instant } from '../../../domain/src/values/core.ts';

export function createJobRepository(scope: WriteScope): JobRepository {
  const q = scope.query;
  return guarded(scope, {
    async register(tx, i) {
      await q(
        tx,
        `INSERT INTO app.job_runs(job_type,business_key,schema_version,resource_id) VALUES($1,$2,$3,$4) ON CONFLICT(job_type,business_key) DO NOTHING`,
        [text(i.type, 100), text(i.businessKey), integer(i.version), i.resourceId],
      );
      const x = one(
        (
          await q(
            tx,
            'SELECT id,schema_version,resource_id FROM app.job_runs WHERE job_type=$1 AND business_key=$2',
            [i.type, i.businessKey],
          )
        ).rows,
      );
      if (x.schema_version !== i.version || x.resource_id !== i.resourceId) stop('conflict');
      return rid('job', x.id);
    },
    async lease(tx, id) {
      const x = (
        await q(
          tx,
          `UPDATE app.job_runs SET state='running',lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND state IN ('pending','failed') AND coalesce(next_attempt_at,created_at)<=clock_timestamp() AND attempts<8 AND deadline_at>clock_timestamp()+interval '30 seconds' AND resource_id IS NOT NULL RETURNING *`,
          [id],
        )
      ).rows[0];
      return x
        ? {
            id: rid('job', x.id),
            token: rid('lease', x.lease_token),
            generation: rev(x.lease_generation),
            input: {
              type: text(x.job_type, 100),
              businessKey: text(x.business_key),
              version: integer(x.schema_version),
              resourceId: rid('resource', x.resource_id),
            },
          }
        : null;
    },
    async fence(tx, l) {
      one(
        (
          await q(
            tx,
            `SELECT id FROM app.job_runs WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp() FOR UPDATE`,
            [l.id, l.token, l.generation.toString()],
          )
        ).rows,
      );
    },
    async complete(tx, l) {
      one(
        (
          await q(
            tx,
            `UPDATE app.job_runs SET state='completed',lease_token=NULL,lease_until=NULL,last_error_code=NULL,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING id`,
            [l.id, l.token, l.generation.toString()],
          )
        ).rows,
      );
    },
    async fail(tx, l) {
      await q(
        tx,
        `UPDATE app.job_runs SET state=CASE WHEN attempts>=8 OR deadline_at<=clock_timestamp()+interval '30 seconds' THEN 'manual_review' ELSE 'failed' END,lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+least(300,power(2,attempts)) * interval '1 second',last_error_code='execution_failed',updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp()`,
        [l.id, l.token, l.generation.toString()],
      );
    },
    async reconcile(tx) {
      // Bounded locks per invocation. A scheduler repeats this until the backlog drains.
      await q(
        tx,
        `WITH c AS (SELECT id FROM app.job_runs WHERE (state='running' AND lease_until<=clock_timestamp()) OR (state IN ('pending','failed') AND (attempts>=8 OR deadline_at<=clock_timestamp()+interval '30 seconds' OR resource_id IS NULL)) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED) UPDATE app.job_runs j SET state=CASE WHEN attempts>=8 OR deadline_at<=clock_timestamp()+interval '30 seconds' OR resource_id IS NULL THEN 'manual_review' ELSE 'failed' END,lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp(),last_error_code=CASE WHEN attempts>=8 THEN 'retry_exhausted' ELSE 'lease_or_deadline' END,updated_at=clock_timestamp(),revision=revision+1 FROM c WHERE j.id=c.id`,
      );
      return (
        await q(
          tx,
          `SELECT id FROM app.job_runs WHERE state IN ('pending','failed') AND attempts<8 AND deadline_at>clock_timestamp()+interval '30 seconds' AND resource_id IS NOT NULL AND coalesce(next_attempt_at,created_at)<=clock_timestamp() ORDER BY coalesce(next_attempt_at,created_at),id LIMIT 4`,
        )
      ).rows.map((x) => rid('job', x.id));
    },
  } satisfies JobRepository);
}
export function createRelayRepository(scope: WriteScope): RelayRepository {
  const q = scope.query,
    reliability = createReliabilityRepository(scope);
  return guarded(scope, {
    async lease(tx) {
      const x = (
        await q(
          tx,
          `WITH c AS (SELECT id FROM app.outbox WHERE state IN ('pending','failed') AND available_at<=clock_timestamp() AND attempts<8 ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE app.outbox o SET state='leased',lease_owner='runtime-relay',lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1,updated_at=clock_timestamp(),revision=revision+1 FROM c WHERE o.id=c.id RETURNING o.*`,
        )
      ).rows[0];
      return x
        ? {
            id: rid('outbox', x.id),
            eventId: rid('event', x.event_id),
            token: rid('lease', x.lease_token),
            generation: rev(x.lease_generation),
            event: {
              eventId: rid('event', x.event_id),
              aggregateId: rid('aggregate', x.aggregate_id),
              aggregateKind: text(x.aggregate_kind, 100),
              type: text(x.event_type, 100),
              version: integer(x.schema_version),
              payload: JSON.parse(jsonObject(x.payload, 4096)),
            },
          }
        : null;
    },
    acknowledge: reliability.acknowledge,
    async fail(tx, l) {
      await q(
        tx,
        `UPDATE app.outbox SET state=CASE WHEN attempts>=8 THEN 'quarantined' ELSE 'failed' END,lease_token=NULL,lease_owner=NULL,lease_until=NULL,available_at=clock_timestamp()+least(300,power(2,attempts))*interval '1 second',updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp()`,
        [l.id, l.token, l.generation.toString()],
      );
    },
    async reconcile(tx) {
      const r = await q(
        tx,
        `WITH c AS (SELECT id FROM app.outbox WHERE (state='leased' AND lease_until<=clock_timestamp()) OR (state IN ('pending','failed') AND attempts>=8) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED) UPDATE app.outbox o SET state=CASE WHEN attempts>=8 THEN 'quarantined' ELSE 'failed' END,lease_token=NULL,lease_owner=NULL,lease_until=NULL,available_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 FROM c WHERE o.id=c.id`,
      );
      return r.rowCount;
    },
  } satisfies RelayRepository);
}
export function createCommandRepository(scope: WriteScope): CommandRepository {
  const q = scope.query;
  const keys = (i: Parameters<CommandRepository['claim']>[1]) => [
    hex(i.actorHash),
    text(i.operation, 100),
    hex(i.keyHash),
    hex(i.bodyHash),
    integer(i.canonicalVersion),
  ];
  return guarded(scope, {
    async lookup(tx, i) {
      const k = keys(i),
        x = (
          await q(
            tx,
            'SELECT *,expires_at>clock_timestamp() AS live FROM app.idempotency_requests WHERE actor_scope_hash=$1 AND operation=$2 AND key_hash=$3',
            k.slice(0, 3),
          )
        ).rows[0];
      if (!x) return null;
      if (
        !Buffer.isBuffer(x.body_hash) ||
        x.body_hash.toString('hex') !== i.bodyHash ||
        x.canonical_version !== i.canonicalVersion ||
        !x.live ||
        x.state !== 'completed'
      )
        return stop('conflict');
      return response(x.safe_response);
    },
    async claim(tx, i) {
      const k = keys(i),
        inserted = await q(
          tx,
          `INSERT INTO app.idempotency_requests(actor_scope_hash,operation,key_hash,body_hash,canonical_version,state,expires_at) VALUES($1,$2,$3,$4,$5,'pending',now()+interval '7 days') ON CONFLICT(actor_scope_hash,operation,key_hash) DO NOTHING RETURNING id`,
          k,
        );
      const x = one(
        (
          await q(
            tx,
            `SELECT *,expires_at>clock_timestamp() AS live FROM app.idempotency_requests WHERE actor_scope_hash=$1 AND operation=$2 AND key_hash=$3 FOR UPDATE`,
            k.slice(0, 3),
          )
        ).rows,
      );
      if (
        !Buffer.isBuffer(x.body_hash) ||
        x.body_hash.toString('hex') !== i.bodyHash ||
        x.canonical_version !== i.canonicalVersion ||
        !x.live
      )
        stop('conflict');
      if (inserted.rowCount) return null;
      if (x.state !== 'completed') return stop('conflict');
      return response(x.safe_response);
    },
    async complete(tx, i, r) {
      const k = keys(i);
      response(r);
      one(
        (
          await q(
            tx,
            `UPDATE app.idempotency_requests SET state='completed',resource_kind='resource',resource_id=$6,result_status=$8,safe_response=$7,updated_at=clock_timestamp(),revision=revision+1 WHERE actor_scope_hash=$1 AND operation=$2 AND key_hash=$3 AND body_hash=$4 AND canonical_version=$5 AND state='pending' AND expires_at>clock_timestamp() RETURNING id`,
            [...k, r.resource_id, jsonObject(r, 1024), r.status === 'created' ? 201 : 202],
          )
        ).rows,
      );
    },
  } satisfies CommandRepository);
}
function response(value: unknown): CommandResponse {
  const x = JSON.parse(jsonObject(value, 1024));
  if (
    Object.keys(x).some(
      (k) =>
        ![
          'schema_version',
          'resource_id',
          'status',
          'report_id',
          'report_version',
          'result_revision',
          'token_key_version',
          'expires_at',
        ].includes(k),
    ) ||
    x.schema_version !== 1 ||
    !['created', 'accepted'].includes(x.status)
  )
    return stop('integrity');
  const extra: Record<string, string | number> = {};
  if ('report_id' in x) extra.report_id = rid('report', x.report_id);
  if ('report_version' in x) extra.report_version = integer(x.report_version);
  if ('result_revision' in x) extra.result_revision = rev(x.result_revision).toString();
  if ('token_key_version' in x) extra.token_key_version = text(x.token_key_version, 100);
  if ('expires_at' in x) {
    const t = instant(x.expires_at);
    if (!t.ok) return stop('integrity');
    extra.expires_at = t.value;
  }
  return {
    schema_version: 1,
    resource_id: rid('resource', x.resource_id),
    status: x.status,
    ...extra,
  };
}
