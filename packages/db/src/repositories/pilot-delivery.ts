import type {
  PilotRepository,
  PilotContext,
  PilotLease,
} from '../../../application/src/ports/pilot-delivery.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { createPartnerAllocationRepository } from './partner-allocations.ts';
import { couponAssignmentFromRow } from './partner-mappers.ts';
import { mapped, identifier } from './partner-support.ts';
import { text, obj, keyJson, hex } from './private-values.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { pilotCandidates } from './pilot-candidates.ts';
import { matchPilotOffers } from '../../../domain/src/offer-matching.ts';
export function createPilotRepository(s: WriteScope): PilotRepository {
  const q = s.query,
    allocation = createPartnerAllocationRepository(s);
  const args = (l: PilotLease) => [l.sendId, l.token, l.generation];
  async function fence(tx: Tx, l: PilotLease) {
    await q(tx, 'SELECT partners.pilot_root($1)', [l.sendId]);
    if (
      !(
        await q(
          tx,
          "SELECT 1 FROM partners.pilot_work WHERE send_id=$1 AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp() AND state IN('queued','reserved','dispatching')",
          args(l),
        )
      ).rowCount
    )
      return stop('conflict');
  }
  async function evidence(tx: Tx, l: PilotLease, reason: string) {
    return identifier(
      'audit_event',
      (await q(tx, 'SELECT partners.pilot_evidence($1,$2,$3,$4) id', [...args(l), reason])).rows[0]!
        .id,
    );
  }
  async function assignments(tx: Tx, l: PilotLease) {
    return (
      await q(
        tx,
        "SELECT * FROM partners.coupon_reservations WHERE send_id=$1 AND state<>'released' ORDER BY slot",
        [l.sendId],
      )
    ).rows.map((r) => mapped(couponAssignmentFromRow(r)));
  }
  async function release(
    tx: Tx,
    l: PilotLease,
    keep: readonly string[],
    reason:
      | 'cancelled_before_dispatch'
      | 'definitively_not_sent'
      | 'expired_unstarted' = 'expired_unstarted',
  ) {
    const rows = (await assignments(tx, l))
      .filter((a) => !keep.includes(a.id))
      .sort(
        (a, b) =>
          a.organizationId.localeCompare(b.organizationId) || a.offerId.localeCompare(b.offerId),
      );
    if (rows.length) {
      const proof = await evidence(tx, l, reason);
      for (const a of rows) await allocation.release(tx, a.organizationId, a.id, reason, proof);
    }
    if (!keep.length)
      await q(
        tx,
        "UPDATE partners.pilot_usage SET state='released' WHERE send_id=$1 AND state='reserved'",
        [l.sendId],
      );
  }
  const repo: PilotRepository = {
    async authorize(tx, keys, send) {
      await q(tx, 'SELECT partners.pilot_owner_authorize($1,$2::jsonb)', [
        identifier('send', send),
        keyJson(keys),
      ]);
    },
    async capture(tx, keys, send, request, digest, policy, location, locationDigest) {
      await q(tx, 'SELECT partners.pilot_capture($1,$2::jsonb,$3,$4,$5,$6::jsonb,$7,$8)', [
        identifier('send', send),
        keyJson(keys),
        request.itemKey,
        request.adult,
        request.quantity,
        JSON.stringify({
          includeOffers: request.includeOffers,
          box: location,
          digest: locationDigest,
        }),
        digest,
        policy.version,
      ]);
    },
    async acquire(tx, sendId) {
      identifier('send', sendId);
      await q(tx, 'SELECT partners.pilot_root($1)', [sendId]);
      const row = (
        await q(
          tx,
          `UPDATE partners.pilot_work w SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
 WHERE send_id=$1 AND state IN('queued','reserved','dispatching') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND EXISTS(SELECT 1 FROM partners.pilot_due($1)) RETURNING state,lease_token,lease_generation::text`,
          [sendId],
        )
      ).rows[0];
      return row
        ? {
            sendId,
            token: identifier('lease', row.lease_token),
            generation: text(row.lease_generation),
            state: text(row.state),
          }
        : null;
    },
    async context(tx, l, policy) {
      await fence(tx, l);
      const raw = (
        await q(tx, 'SELECT partners.pilot_context($1,$2,$3,$4,$5,$6) context', [
          ...args(l),
          policy.offersNotice,
          policy.reportNotice,
          policy.consentPolicy,
        ])
      ).rows[0]!.context;
      const r = obj(raw),
        a = obj(r.audience),
        contact = obj(r.contact);
      if (
        !Array.isArray(a.products) ||
        a.products.length > 2 ||
        typeof r.reportAllowed !== 'boolean' ||
        typeof r.offersAllowed !== 'boolean'
      )
        return stop('integrity');
      return {
        ...r,
        sendId: identifier('send', r.sendId),
        ownerId: identifier('subject', r.ownerId),
        recipientId: identifier('subject', r.recipientId),
        contactId: identifier('contact', r.contactId),
        provider: text(r.provider),
        policyVersion: text(r.policyVersion),
        providerKey: text(r.providerKey),
        permissionRevision: text(r.permissionRevision),
        reportAllowed: r.reportAllowed,
        offersAllowed: r.offersAllowed,
        geo: obj(r.geo),
        contact: {
          keyVersion: text(contact.keyVersion),
          hex: hex(text(contact.hex, 16384), 32, 8192).toString('hex'),
        },
        audience: a,
        document: r.document === null ? null : obj(r.document),
      } as unknown as PilotContext;
    },
    async candidates(tx, l, p) {
      return pilotCandidates(s, tx, await repo.context(tx, l, p), p);
    },
    async reserve(tx, l, c, offers, decisions, generated, p) {
      await fence(tx, l);
      const live = await repo.context(tx, l, p);
      if (!live.offersAllowed && offers.length) return stop('forbidden');
      if ((await assignments(tx, l)).length) return stop('conflict');
      if (offers.length) {
        await q(tx, 'SELECT partners.pilot_admit_recipient($1,$2,$3,$4)', [
          l.sendId,
          c.recipientId,
          p.timeZone,
          offers.map((o) => o.offer.offerId),
        ]);
      }
      // Acquire shared seller/cap resources in a stable order; retain score order as slot order.
      for (const o of [...offers].sort(
        (a, b) =>
          a.offer.organizationId.localeCompare(b.offer.organizationId) ||
          a.offer.offerId.localeCompare(b.offer.offerId),
      )) {
        if (o.mode === 'generated') {
          const code = generated.get(o.poolId);
          if (!code) return stop('integrity');
          await q(
            tx,
            "INSERT INTO partners.coupon_codes(org_id,pool_id,pool_mode,code_hmac,encrypted_code,key_version,state,expires_at) VALUES($1,$2,'generated',decode($3,'hex'),decode($4,'hex'),$5,'available',$6)",
            [
              o.offer.organizationId,
              o.poolId,
              code.hash,
              code.cipherHex,
              code.keyVersion,
              o.offer.validUntil,
            ],
          );
        }
        await allocation.reserve(tx, {
          requestKey: `pilot:${l.sendId}:${l.generation}:${o.offer.offerId}`,
          organizationId: o.offer.organizationId,
          sendId: l.sendId,
          subjectId: c.ownerId,
          offerId: o.offer.offerId,
          version: o.offer.version,
          poolId: o.poolId,
          slot: offers.indexOf(o) + 1,
          policyVersion: p.version,
          frequencies: [
            { scope: 'overall_marketing', kind: 'calendar_month', timeZone: p.timeZone, limit: 4 },
            {
              scope: 'offer:' + o.offer.offerId,
              kind: 'rolling_30_days',
              timeZone: null,
              limit: 1,
            },
          ],
          caps: o.caps.map((cap) => ({ id: cap.id, units: cap.units })),
          reasons: decisions.find((d) => d.offerId === o.offer.offerId)!.reasons,
        });
      }
      for (const d of decisions)
        await q(
          tx,
          'INSERT INTO partners.pilot_considerations(send_id,generation,org_id,offer_id,offer_version,score,eligible,selected,reasons,factors) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)',
          [
            l.sendId,
            l.generation,
            d.organizationId,
            d.offerId,
            d.version,
            d.score,
            d.eligible,
            d.selected,
            JSON.stringify(d.reasons),
            JSON.stringify({
              specificity: d.specificity,
              savingBp: d.savingBp,
              proximityBp: d.proximityBp,
              qualityBp: 5000,
              weights: [40, 25, 15, 10],
              divisor: 90,
            }),
          ],
        );
      await q(
        tx,
        "UPDATE partners.pilot_work SET state='reserved',updated_at=clock_timestamp() WHERE send_id=$1",
        [l.sendId],
      );
    },
    async held(tx, l, p) {
      await fence(tx, l);
      const offers = await repo.candidates(tx, l, p),
        held = [];
      const owned = await assignments(tx, l),
        caps = (
          await q(
            tx,
            "SELECT r.reservation_id,r.cap_id,r.units::text,r.state FROM partners.cap_reservations r JOIN partners.coupon_reservations a ON a.org_id=r.org_id AND a.id=r.reservation_id WHERE a.send_id=$1 AND a.state='reserved' ORDER BY r.reservation_id,r.cap_id LIMIT 10",
            [l.sendId],
          )
        ).rows;
      if (caps.length > 9) return stop('integrity');
      for (const a of owned) {
        const o = offers.find(
          (o) =>
            o.offer.offerId === a.offerId && o.offer.version === a.version && o.poolId === a.poolId,
        );
        const reserved = caps.filter((r) => r.reservation_id === a.id);
        if (
          !o ||
          a.state !== 'reserved' ||
          reserved.length !== o.caps.length ||
          o.caps.some(
            (c) =>
              !reserved.some(
                (r) =>
                  r.cap_id === c.id && r.units === c.units.toString() && r.state === 'reserved',
              ),
          )
        )
          continue;
        const r = (
          await q(
            tx,
            a.mode === 'shared'
              ? 'SELECT shared_code_hmac AS code_hmac,encrypted_shared_code AS encrypted_code,key_version FROM partners.coupon_pools WHERE org_id=$1 AND id=$2'
              : "SELECT code_hmac,encrypted_code,key_version FROM partners.coupon_codes WHERE org_id=$1 AND id=$2 AND state='reserved' AND expires_at>clock_timestamp()",
            [a.organizationId, a.mode === 'shared' ? a.poolId : a.codeId],
          )
        ).rows[0];
        if (r)
          held.push({
            assignment: a,
            offer: o,
            seal: {
              hash: (r.code_hmac as Buffer).toString('hex'),
              cipherHex: (r.encrypted_code as Buffer).toString('hex'),
              keyVersion: text(r.key_version),
            },
          });
      }
      return held;
    },
    async trim(tx, l, keep) {
      await fence(tx, l);
      await release(tx, l, keep);
    },
    async reservePayload(tx, l, asset) {
      await fence(tx, l);
      await q(
        tx,
        'INSERT INTO partners.pilot_payload_refs(send_id,asset_id,generation) VALUES($1,$2,$3)',
        [l.sendId, identifier('asset', asset), l.generation],
      );
    },
    async claim(
      tx,
      l,
      keep,
      revision,
      reportIncluded,
      payload,
      digest,
      asset,
      objectHash,
      p,
      location,
      locationDigest,
    ) {
      await fence(tx, l);
      const c = await repo.context(tx, l, p),
        rows = await repo.held(tx, l, p);
      if (
        c.permissionRevision !== revision ||
        (!c.reportAllowed && !keep.length) ||
        (!c.offersAllowed && keep.length) ||
        rows.length !== keep.length ||
        rows.some((r) => !keep.includes(r.assignment.id) || !r.offer.available)
      )
        return false;
      for (const r of [...rows].sort(
        (a, b) =>
          a.assignment.organizationId.localeCompare(b.assignment.organizationId) ||
          a.assignment.offerId.localeCompare(b.assignment.offerId),
      ))
        await q(tx, 'SELECT partners.lock_allocation_offer($1,$2,$3,$4)', [
          r.assignment.organizationId,
          r.assignment.offerId,
          r.assignment.version,
          r.assignment.poolId,
        ]);
      // Re-read after all potentially waiting locks, before the irreversible provider handoff marker.
      const final = await repo.context(tx, l, p),
        current = await repo.held(tx, l, p);
      if (
        final.geo.digest !== locationDigest ||
        final.permissionRevision !== revision ||
        final.reportAllowed !== reportIncluded ||
        (!final.reportAllowed && !keep.length) ||
        (!final.offersAllowed && keep.length) ||
        current.length !== keep.length ||
        matchPilotOffers(
          { ...final.audience, ...location },
          current.map((r) => r.offer),
        ).some((d) => !d.eligible)
      )
        return false;
      await q(
        tx,
        "UPDATE partners.pilot_work SET payload=decode($2,'hex'),payload_key_version=$3,payload_hash=$4,payload_asset_id=$5,payload_object_hash=$6 WHERE send_id=$1",
        [l.sendId, payload.hex, payload.keyVersion, digest, asset, objectHash],
      );
      const attempt = (
        await q(tx, "SELECT partners.pilot_send_state($1,$2,$3,'dispatching') id", args(l))
      ).rows[0]!.id;
      // The last SQL clock check can refuse expiry after our final application-side read.
      if (attempt === null) return false;
      await q(
        tx,
        "UPDATE partners.pilot_work SET state='dispatching',payload=decode($2,'hex'),payload_key_version=$3,payload_hash=$4,provider_started_at=clock_timestamp(),attempt_id=$5,updated_at=clock_timestamp() WHERE send_id=$1",
        [l.sendId, payload.hex, payload.keyVersion, digest, attempt],
      );
      return true;
    },
    async finish(tx, l, outcome, messageId) {
      await fence(tx, l);
      if (outcome === 'definitive_rejection') await release(tx, l, [], 'definitively_not_sent');
      else
        for (const a of (await assignments(tx, l)).sort(
          (a, b) =>
            a.organizationId.localeCompare(b.organizationId) || a.offerId.localeCompare(b.offerId),
        ))
          await allocation.recordOutcome(
            tx,
            a.organizationId,
            a.id,
            outcome === 'accepted' ? 'issued' : 'uncertain',
          );
      await q(
        tx,
        "UPDATE partners.pilot_usage SET state=$2 WHERE send_id=$1 AND state<>'released'",
        [
          l.sendId,
          outcome === 'accepted' ? 'issued' : outcome === 'uncertain' ? 'uncertain' : 'released',
        ],
      );
      const state = outcome === 'definitive_rejection' ? 'failed' : outcome;
      await q(tx, 'SELECT partners.pilot_send_state($1,$2,$3,$4,$5)', [
        ...args(l),
        state,
        messageId,
      ]);
      await q(
        tx,
        'UPDATE partners.pilot_work SET state=$2,lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp() WHERE send_id=$1',
        [l.sendId, state],
      );
    },
    async stop(tx, l) {
      await fence(tx, l);
      await release(tx, l, []);
      await q(tx, "SELECT partners.pilot_send_state($1,$2,$3,'suppressed')", args(l));
      await q(
        tx,
        "UPDATE partners.pilot_work SET state='suppressed',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE send_id=$1",
        [l.sendId],
      );
    },
    async retry(tx, l) {
      await fence(tx, l);
      await q(
        tx,
        'UPDATE partners.pilot_work SET lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE send_id=$1 AND provider_started_at IS NULL',
        [l.sendId],
      );
    },
    async cancel(tx, keys, send) {
      await q(tx, 'SELECT partners.pilot_cancel_authorize($1,$2::jsonb)', [
        identifier('send', send),
        keyJson(keys),
      ]);
      const row = (
        await q(
          tx,
          "UPDATE partners.pilot_work SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '120 seconds' WHERE send_id=$1 AND state IN('queued','reserved') AND provider_started_at IS NULL RETURNING lease_token,lease_generation::text",
          [send],
        )
      ).rows[0];
      if (!row) return stop('conflict');
      const l = {
        sendId: send,
        token: identifier('lease', row.lease_token),
        generation: text(row.lease_generation),
        state: 'reserved',
      };
      await release(tx, l, [], 'cancelled_before_dispatch');
      await q(tx, "SELECT partners.pilot_send_state($1,$2,$3,'cancelled')", args(l));
      await q(
        tx,
        "UPDATE partners.pilot_work SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE send_id=$1",
        [send],
      );
    },
  };
  return guarded(s, repo);
}
