import type { PartnerAllocationRepository } from '../../../application/src/ports/partner-repositories.ts';
import type { CouponAssignment } from '../../../domain/src/entities/partner.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { identifier, mapped } from './partner-support.ts';
import { couponAssignmentFromRow } from './partner-mappers.ts';
import { allocationInput } from './partner-allocation-input.ts';
import { text, stamp } from './private-values.ts';
import { lockFrequencies } from './partner-frequency.ts';
import { instant } from '../../../domain/src/values/core.ts';
import { boundedJson, reject } from './bounds.ts';
const assignmentColumns =
  'id,org_id,send_id,owner_subject_id,offer_id,offer_version,pool_id,pool_mode,code_id,slot,policy_version,state,reserved_at';
export function createPartnerAllocationRepository(s: WriteScope): PartnerAllocationRepository {
  const q = s.query;
  async function read(tx: Tx, org: unknown, id: unknown, lock = false) {
    identifier('organization', org);
    identifier('coupon_assignment', id);
    const row = (
      await q(
        tx,
        `SELECT ${assignmentColumns} FROM partners.coupon_reservations WHERE org_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
        [org, id],
      )
    ).rows[0];
    return row ? mapped(couponAssignmentFromRow(row)) : null;
  }
  async function root(tx: Tx, a: CouponAssignment) {
    await q(tx, 'SELECT partners.lock_allocation_root($1,$2,false)', [a.subjectId, a.sendId]);
    await q(
      tx,
      'SELECT scope_key FROM partners.frequency_guards WHERE subject_id=$1 AND scope_key=ANY($2::text[]) ORDER BY scope_key FOR UPDATE',
      [a.subjectId, ['overall_marketing', 'offer:' + a.offerId]],
    );
    await q(
      tx,
      'SELECT w.id FROM partners.offer_cap_windows w JOIN partners.cap_reservations r ON r.org_id=w.org_id AND r.cap_id=w.id WHERE r.org_id=$1 AND r.reservation_id=$2 ORDER BY w.id FOR UPDATE OF w',
      [a.organizationId, a.id],
    );
    return (await read(tx, a.organizationId, a.id, true)) ?? stop('not_found');
  }
  const repo: PartnerAllocationRepository = {
    assignment: async (tx, org, id) => read(tx, org, id),
    async reserve(tx, input) {
      const p = allocationInput(input);
      await q(tx, 'SELECT partners.lock_allocation_root($1,$2,false)', [p.subjectId, p.sendId]);
      await q(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended('partner-allocation:'||$1||':'||$2,0))",
        [p.organizationId, p.requestKey],
      );
      const receipt = (
        await q(
          tx,
          'SELECT request_sha256,reservation_id FROM partners.allocation_receipts WHERE org_id=$1 AND request_key=$2',
          [p.organizationId, p.requestKey],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.request_sha256 !== p.sha256) return stop('conflict');
        return (await read(tx, p.organizationId, receipt.reservation_id)) ?? stop('integrity');
      }
      await q(tx, 'SELECT partners.lock_allocation_root($1,$2,true)', [p.subjectId, p.sendId]);
      const frequencies = await lockFrequencies(s, tx, p);
      const mode = (
        await q(tx, 'SELECT partners.lock_allocation_offer($1,$2,$3,$4) AS mode', [
          p.organizationId,
          p.offerId,
          p.version,
          p.poolId,
        ])
      ).rows[0]!.mode;
      if (!['shared', 'unique', 'generated'].includes(String(mode))) return stop('integrity');
      const windows = (
        await q(
          tx,
          'SELECT id,kind,limit_units::text,consumed_units::text FROM partners.offer_cap_windows WHERE org_id=$1 AND offer_id=$2 AND policy_version=$3 AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY id LIMIT 4 FOR UPDATE',
          [p.organizationId, p.offerId, p.policyVersion],
        )
      ).rows;
      if (
        windows.length !== p.caps.length ||
        windows.some((w, n) => w.id !== p.caps[n]?.id) ||
        new Set(windows.map((w) => w.kind)).size !== windows.length
      )
        return stop('conflict');
      // FOR UPDATE can wait past a window boundary after its WHERE was evaluated.
      const currentCaps = (
        await q(
          tx,
          'WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS at) SELECT count(*)::int AS n FROM partners.offer_cap_windows w,clock WHERE w.org_id=$1 AND w.id=ANY($2::uuid[]) AND w.window_start<=clock.at AND w.window_end>clock.at',
          [p.organizationId, p.caps.map((c) => c.id)],
        )
      ).rows[0]!;
      if (currentCaps.n !== windows.length) return stop('conflict');
      await q(tx, 'SELECT partners.lock_allocation_offer($1,$2,$3,$4)', [
        p.organizationId,
        p.offerId,
        p.version,
        p.poolId,
      ]);
      for (const [n, w] of windows.entries())
        if (
          BigInt(String(w.consumed_units)) + BigInt(p.caps[n]!.units) >
          BigInt(String(w.limit_units))
        )
          return stop('conflict');
      let codeId: unknown = null;
      if (mode !== 'shared') {
        const code = (
          await q(
            tx,
            "SELECT id FROM partners.coupon_codes WHERE org_id=$1 AND pool_id=$2 AND pool_mode=$3 AND state='available' AND expires_at>clock_timestamp() ORDER BY expires_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
            [p.organizationId, p.poolId, mode],
          )
        ).rows[0];
        if (!code) return stop('conflict');
        codeId = code.id;
        await q(tx, "UPDATE partners.coupon_codes SET state='reserved' WHERE org_id=$1 AND id=$2", [
          p.organizationId,
          codeId,
        ]);
      }
      const row = (
        await q(
          tx,
          `INSERT INTO partners.coupon_reservations(org_id,send_id,owner_subject_id,offer_id,offer_version,pool_id,pool_mode,code_id,slot,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${assignmentColumns}`,
          [
            p.organizationId,
            p.sendId,
            p.subjectId,
            p.offerId,
            p.version,
            p.poolId,
            mode,
            codeId,
            p.slot,
            p.policyVersion,
          ],
        )
      ).rows[0]!;
      const a = mapped(couponAssignmentFromRow(row));
      for (const f of frequencies)
        await q(
          tx,
          'INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,window_start,window_end,window_kind,calendar_time_zone,policy_version,reserved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(send_id,scope_key) DO NOTHING',
          [
            p.subjectId,
            f.scope,
            p.sendId,
            f.start,
            f.end,
            f.kind,
            f.timeZone,
            p.policyVersion,
            f.reservedAt,
          ],
        );
      for (const c of p.caps) {
        await q(
          tx,
          'UPDATE partners.offer_cap_windows SET consumed_units=consumed_units+$3::bigint WHERE org_id=$1 AND id=$2',
          [p.organizationId, c.id, c.units],
        );
        await q(
          tx,
          'INSERT INTO partners.cap_reservations(org_id,cap_id,reservation_id,offer_id,offer_version,units) VALUES($1,$2,$3,$4,$5,$6)',
          [p.organizationId, c.id, a.id, p.offerId, p.version, c.units],
        );
      }
      const decision = (
        await q(
          tx,
          "INSERT INTO partners.offer_decisions(org_id,send_id,owner_subject_id,offer_id,offer_version,policy_version,outcome,reason_codes,expires_at) VALUES($1,$2,$3,$4,$5,$6,'selected',$7,clock_timestamp()+interval '30 days') ON CONFLICT(org_id,send_id,offer_id,offer_version,policy_version) DO NOTHING RETURNING id",
          [
            p.organizationId,
            p.sendId,
            p.subjectId,
            p.offerId,
            p.version,
            p.policyVersion,
            boundedJson(p.reasons, 8192),
          ],
        )
      ).rows[0];
      if (!decision) {
        const old = (
          await q(
            tx,
            'SELECT outcome,reason_codes FROM partners.offer_decisions WHERE org_id=$1 AND send_id=$2 AND offer_id=$3 AND offer_version=$4 AND policy_version=$5',
            [p.organizationId, p.sendId, p.offerId, p.version, p.policyVersion],
          )
        ).rows[0];
        if (
          old?.outcome !== 'selected' ||
          boundedJson(old.reason_codes, 8192) !== boundedJson(p.reasons, 8192)
        )
          return stop('conflict');
      }
      await q(
        tx,
        'INSERT INTO partners.allocation_receipts(org_id,request_key,request_sha256,reservation_id) VALUES($1,$2,$3,$4)',
        [p.organizationId, p.requestKey, p.sha256, a.id],
      );
      return a;
    },
    async recordOutcome(tx, org, id, state) {
      if (!['issued', 'uncertain', 'quarantined'].includes(state)) return reject();
      const initial = (await read(tx, org, id)) ?? stop('not_found'),
        a = await root(tx, initial);
      if (a.state === state) return a;
      if (
        !['reserved', 'issued', 'uncertain', 'quarantined'].includes(a.state) ||
        (a.state === 'issued' && state === 'issued')
      )
        return stop('conflict');
      await q(tx, 'UPDATE partners.coupon_reservations SET state=$3 WHERE org_id=$1 AND id=$2', [
        org,
        id,
        state,
      ]);
      if (a.codeId)
        await q(tx, 'UPDATE partners.coupon_codes SET state=$3 WHERE org_id=$1 AND id=$2', [
          org,
          a.codeId,
          state === 'issued' ? 'issued' : 'quarantined',
        ]);
      const usage = state === 'quarantined' ? 'uncertain' : state;
      await q(
        tx,
        "UPDATE partners.frequency_reservations SET state=CASE WHEN state='issued' THEN 'issued' ELSE $3 END WHERE send_id=$1 AND scope_key=ANY($2::text[]) AND state<>'released'",
        [a.sendId, ['overall_marketing', 'offer:' + a.offerId], usage],
      );
      await q(
        tx,
        'UPDATE partners.cap_reservations SET state=$3 WHERE org_id=$1 AND reservation_id=$2',
        [org, id, usage],
      );
      return (await read(tx, org, id))!;
    },
    async release(tx, org, id, reason, evidence) {
      if (
        !['cancelled_before_dispatch', 'definitively_not_sent', 'expired_unstarted'].includes(
          reason,
        )
      )
        return reject();
      identifier('audit_event', evidence);
      const initial = (await read(tx, org, id)) ?? stop('not_found'),
        a = await root(tx, initial);
      if (a.state === 'released') return a;
      if (
        a.state === 'issued' ||
        a.state === 'redeemed' ||
        ((a.state === 'uncertain' || a.state === 'quarantined') &&
          reason !== 'definitively_not_sent')
      )
        return stop('conflict');
      await q(
        tx,
        "UPDATE partners.coupon_reservations SET state='released',released_at=clock_timestamp(),release_reason=$3,release_evidence_id=$4 WHERE org_id=$1 AND id=$2",
        [org, id, reason, evidence],
      );
      const caps = (
        await q(
          tx,
          "SELECT cap_id,units::text FROM partners.cap_reservations WHERE org_id=$1 AND reservation_id=$2 AND state<>'released' ORDER BY cap_id",
          [org, id],
        )
      ).rows;
      for (const c of caps)
        await q(
          tx,
          'UPDATE partners.offer_cap_windows SET consumed_units=consumed_units-$3::bigint WHERE org_id=$1 AND id=$2',
          [org, c.cap_id, c.units],
        );
      await q(
        tx,
        "UPDATE partners.cap_reservations SET state='released' WHERE org_id=$1 AND reservation_id=$2 AND state<>'released'",
        [org, id],
      );
      const other =
        (
          await q(
            tx,
            "SELECT 1 FROM partners.coupon_reservations WHERE send_id=$1 AND state<>'released' LIMIT 1",
            [a.sendId],
          )
        ).rows.length > 0;
      await q(
        tx,
        "UPDATE partners.frequency_reservations SET state='released',released_at=clock_timestamp(),release_evidence_id=$3 WHERE send_id=$1 AND scope_key=ANY($2::text[]) AND state IN ('reserved','uncertain')",
        [
          a.sendId,
          other ? ['offer:' + a.offerId] : ['offer:' + a.offerId, 'overall_marketing'],
          evidence,
        ],
      );
      if (a.codeId)
        await q(
          tx,
          "UPDATE partners.coupon_codes SET state=CASE WHEN expires_at>clock_timestamp() THEN 'available' ELSE 'expired' END WHERE org_id=$1 AND id=$2",
          [org, a.codeId],
        );
      return (await read(tx, org, id))!;
    },
    async appendRedemption(tx, input) {
      const i = Object.freeze({ ...input });
      identifier('organization', i.organizationId);
      identifier('coupon_assignment', i.assignmentId);
      text(i.eventKey, 200);
      if (
        !['reported', 'correction', 'reversal'].includes(i.kind) ||
        !instant(i.occurredAt).ok ||
        !Number.isSafeInteger(i.quantity) ||
        i.quantity === 0 ||
        Math.abs(i.quantity) > 4
      )
        return reject();
      if (i.previousId !== null) identifier('redemption_event', i.previousId);
      const initial = (await read(tx, i.organizationId, i.assignmentId)) ?? stop('not_found'),
        a = await root(tx, initial);
      if (a.mode === 'shared' || a.state === 'released') return stop('conflict');
      const r = (
        await q(
          tx,
          'SELECT id,reservation_id,kind,quantity_delta,reverses_event_id,occurred_at FROM partners.redemption_events WHERE org_id=$1 AND external_event_key=$2',
          [i.organizationId, i.eventKey],
        )
      ).rows[0];
      if (r) {
        if (
          r.reservation_id !== a.id ||
          r.kind !== i.kind ||
          r.quantity_delta !== i.quantity ||
          r.reverses_event_id !== i.previousId ||
          stamp(r.occurred_at) !== i.occurredAt
        )
          return stop('conflict');
        return identifier('redemption_event', r.id);
      }
      const row = (
        await q(
          tx,
          'INSERT INTO partners.redemption_events(org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,reverses_event_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [
            i.organizationId,
            a.id,
            a.offerId,
            a.version,
            i.eventKey,
            i.kind,
            i.quantity,
            i.previousId,
            i.occurredAt,
          ],
        )
      ).rows[0]!;
      return identifier('redemption_event', row.id);
    },
  };
  return guarded(s, repo);
}
