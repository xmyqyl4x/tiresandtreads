import type { ReliabilityRepository, Inbox } from '../../../application/src/ports/reliability.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { digest, reject } from './bounds.ts';
import { hex, integer, jsonObject, one, rev, rid, text, type Row } from './private-values.ts';
export const inboxRecoveryQuery = `WITH c AS MATERIALIZED ((SELECT id FROM app.webhook_inbox WHERE state IN ('pending','failed') AND job_id IS NULL AND next_attempt_at IS NULL ORDER BY id LIMIT 4) UNION ALL (SELECT id FROM app.webhook_inbox WHERE state IN ('pending','failed') AND job_id IS NULL AND next_attempt_at<=statement_timestamp() ORDER BY next_attempt_at,id LIMIT 4)) SELECT i.id,i.revision,i.state FROM app.webhook_inbox i JOIN c USING(id) WHERE i.job_id IS NULL AND i.state IN ('pending','failed') ORDER BY i.created_at,i.id LIMIT 4 FOR UPDATE OF i SKIP LOCKED`;

function inbox(row: Row): Inbox {
  if (!['pending', 'processing', 'processed', 'quarantined', 'failed'].includes(String(row.state)))
    return stop('integrity');
  return {
    id: rid('inbox', row.id),
    revision: rev(row.revision),
    state: row.state as Inbox['state'],
  };
}
export function createReliabilityRepository(scope: WriteScope): ReliabilityRepository {
  const q = scope.query;
  return guarded(scope, {
    async current(tx, id, jobId) {
      const x = (
        await q(
          tx,
          'SELECT id,revision,state FROM app.webhook_inbox WHERE id=$1 AND ($2::uuid IS NULL OR job_id=$2) FOR UPDATE',
          [id, jobId ?? null],
        )
      ).rows[0];
      return x ? inbox(x) : null;
    },
    async unscheduled(tx) {
      return (await q(tx, inboxRecoveryQuery)).rows.map(inbox);
    },
    async scheduled(tx, id, jobId) {
      one(
        (
          await q(
            tx,
            `UPDATE app.webhook_inbox SET job_id=$2 WHERE id=$1 AND (job_id IS NULL OR job_id=$2) RETURNING id`,
            [id, jobId],
          )
        ).rows,
      );
    },
    async quarantineOrphans(tx) {
      // New consumers never commit 'processing' separately from their SQL effect/completion.
      // Preserve uncertainty from legacy/unfenced consumers instead of blindly repeating them.
      await q(
        tx,
        `WITH c AS (SELECT id FROM app.webhook_inbox WHERE state='processing' ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED) UPDATE app.webhook_inbox i SET state='quarantined',last_error_code='legacy_processing',revision=revision+1,updated_at=clock_timestamp() FROM c WHERE i.id=c.id AND NOT EXISTS(SELECT 1 FROM app.job_runs j WHERE j.id=i.job_id AND j.state IN ('pending','running','failed'))`,
      );
    },
    async append(tx, e) {
      const payload = jsonObject(e.payload, 4096);
      integer(e.version);
      await q(
        tx,
        'INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO NOTHING',
        [
          e.eventId,
          text(e.aggregateKind, 100),
          e.aggregateId,
          text(e.type, 100),
          e.version,
          payload,
        ],
      );
      const x = one(
        (
          await q(
            tx,
            'SELECT id,aggregate_kind,aggregate_id,event_type,schema_version,payload FROM app.outbox WHERE event_id=$1',
            [e.eventId],
          )
        ).rows,
      );
      if (
        x.aggregate_kind !== e.aggregateKind ||
        x.aggregate_id !== e.aggregateId ||
        x.event_type !== e.type ||
        x.schema_version !== e.version ||
        digest(x.payload) !== digest(e.payload)
      )
        stop('conflict');
      return rid('outbox', x.id);
    },
    async lease(tx, worker, seconds) {
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) reject();
      const r = await q(
        tx,
        `WITH candidate AS (SELECT id FROM app.outbox WHERE ((state IN ('pending','failed') AND available_at<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp())) AND attempts<1000 ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
        UPDATE app.outbox o SET state='leased',lease_owner=$1,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+$2*interval '1 second',attempts=attempts+1,revision=revision+1,updated_at=clock_timestamp() FROM candidate c WHERE o.id=c.id RETURNING o.id,o.event_id,o.lease_token,o.lease_generation`,
        [text(worker, 100), seconds],
      );
      const x = r.rows[0];
      return x
        ? {
            id: rid('outbox', x.id),
            eventId: rid('event', x.event_id),
            token: rid('lease', x.lease_token),
            generation: rev(x.lease_generation),
          }
        : null;
    },
    async acknowledge(tx, lease) {
      one(
        (
          await q(
            tx,
            "UPDATE app.outbox SET state='published',published_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND lease_generation=$3 AND state='leased' AND lease_until>clock_timestamp() RETURNING id",
            [lease.id, lease.token, lease.generation.toString()],
          )
        ).rows,
      );
    },
    async receive(tx, i) {
      await q(
        tx,
        'INSERT INTO app.webhook_inbox(provider,provider_event_id,payload_digest,raw_asset_id,received_at,signature_verified_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,provider_event_id) DO NOTHING',
        [
          text(i.provider, 100),
          text(i.eventId),
          hex(i.digest),
          i.assetId,
          i.receivedAt,
          i.verifiedAt,
        ],
      );
      const x = one(
        (
          await q(
            tx,
            'SELECT id,revision,state,payload_digest FROM app.webhook_inbox WHERE provider=$1 AND provider_event_id=$2',
            [i.provider, i.eventId],
          )
        ).rows,
      );
      if (!Buffer.isBuffer(x.payload_digest) || x.payload_digest.toString('hex') !== i.digest)
        stop('conflict');
      return inbox(x);
    },
    async process(tx, id, expected, state) {
      if (!['processing', 'processed', 'quarantined', 'failed'].includes(state)) reject();
      const r = await q(
        tx,
        `UPDATE app.webhook_inbox SET state=$3,attempts=attempts+CASE WHEN $3='processing' THEN 1 ELSE 0 END,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND (($3='processing' AND state IN ('pending','failed')) OR ($3 IN ('processed','quarantined','failed') AND state='processing')) RETURNING id,revision,state`,
        [id, expected.toString(), state],
      );
      return inbox(one(r.rows));
    },
  } satisfies ReliabilityRepository);
}
