import { partnerContext } from './partner-support.ts';
import { pilotTargetsFromRows } from './pilot-candidates.ts';
import type { PartnerModerationRepository } from '../../../application/src/ports/partner-services.ts';
import { createPartnerOfferRepository } from './partner-offers.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, word, integer } from './partner-service-values.ts';
export function createPartnerModerationRepository(s: WriteScope): PartnerModerationRepository {
  const repo = createPartnerOfferRepository(s),
    q = s.query;
  return guarded<PartnerModerationRepository>(s, {
    async draft(tx, scope, id, version, body, targets) {
      const created = await repo.appendDraft(tx, {
        ...body,
        organizationId: scope.organizationId,
        offerId: id,
        version,
        supersedesVersion: version === 1 ? null : version - 1,
        createdBy: null,
        partnerAuthor: scope.actor,
      });
      await repo.addTargets(tx, scope.organizationId, id, version, targets);
      return created;
    },
    version: repo.version,
    async simulationTargets(tx, scope, id, version) {
      const org = await partnerContext(s, tx, scope);
      const rows = (
        await q(
          tx,
          `SELECT t.*,t.rim_inches::text,t.radius_km::text,l.status AS location_status,l.approved_address,l.market AS location_market FROM partners.offer_targets t LEFT JOIN partners.locations l ON l.org_id=t.org_id AND l.id=t.location_id WHERE t.org_id=$1 AND t.offer_id=$2 AND t.offer_version=$3 ORDER BY t.id LIMIT 101`,
          [org, uid('partner_offer', id), integer(version, 1, 2147483647)],
        )
      ).rows;
      if (rows.length > 100) return stop('unavailable');
      return pilotTargetsFromRows(rows);
    },
    async submit(tx, org, offer, version, actor) {
      await q(tx, 'SELECT partners.lock_offer_write($1,$2)', [
        uid('organization', org),
        uid('partner_offer', offer),
      ]);
      const r = await q(
        tx,
        "UPDATE partners.offer_versions SET status='pending_review' WHERE org_id=$1 AND offer_id=$2 AND version=$3 AND partner_author=$4 AND status='draft' AND valid_until>clock_timestamp() AND EXISTS(SELECT 1 FROM partners.offer_targets t WHERE t.org_id=$1 AND t.offer_id=$2 AND t.offer_version=$3)",
        [org, offer, integer(version, 1, 2147483647), word(actor)],
      );
      if (r.rowCount !== 1) return stop('conflict');
    },
    async review(tx, org, offer, version, actor, approved, reason) {
      await q(tx, 'SELECT partners.lock_offer_write($1,$2)', [org, offer]);
      const current =
        (
          await q(
            tx,
            'SELECT partner_author,created_by,status,redemption_domain,logo_asset_id,valid_until FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2 AND version=$3 FOR UPDATE',
            [
              uid('organization', org),
              uid('partner_offer', offer),
              integer(version, 1, 2147483647),
            ],
          )
        ).rows[0] ?? stop('not_found');
      if (
        current.status !== 'pending_review' ||
        current.partner_author === actor.subject ||
        current.created_by === actor.staffId ||
        !actor.staffId
      )
        return stop('forbidden');
      if (approved) {
        const valid = (
          await q(
            tx,
            "SELECT 1 FROM partners.organizations o JOIN partners.onboarding_profiles p ON p.org_id=o.id WHERE o.id=$1 AND o.status='active' AND o.verification_status='verified' AND p.state='approved' AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM partners.organization_domains d WHERE d.org_id=o.id AND d.domain=$2 AND d.status='verified' AND d.expires_at>clock_timestamp())) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM partners.organization_assets b JOIN app.object_assets a ON a.id=b.asset_id WHERE b.org_id=o.id AND b.asset_id=$3 AND b.purpose='logo' AND b.state='ready' AND a.state='ready' AND a.expires_at>clock_timestamp()))",
            [org, current.redemption_domain, current.logo_asset_id],
          )
        ).rowCount;
        if (!valid || new Date(current.valid_until as string | Date).getTime() <= Date.now())
          return stop('forbidden');
        await repo.recordReview(tx, org, offer, version, actor.staffId);
      } else {
        const r = await q(
          tx,
          "UPDATE partners.offer_versions SET status='draft' WHERE org_id=$1 AND offer_id=$2 AND version=$3 AND status='pending_review'",
          [org, offer, version],
        );
        if (r.rowCount !== 1) return stop('conflict');
      }
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(reason)) return stop('invalid_input');
    },
    publish: repo.selectPublished,
    async pause(tx, org, offer) {
      await q(tx, 'SELECT partners.lock_offer_write($1,$2)', [
        uid('organization', org),
        uid('partner_offer', offer),
      ]);
      const r = await q(
        tx,
        "UPDATE partners.offers SET status='paused' WHERE org_id=$1 AND id=$2 AND status='active'",
        [org, offer],
      );
      if (r.rowCount !== 1) return stop('conflict');
    },
    async eligible(tx, org, offer, version) {
      return (
        (
          await q(
            tx,
            'SELECT 1 FROM partners.eligible_offer_versions WHERE org_id=$1 AND offer_id=$2 AND version=$3',
            [
              uid('organization', org),
              uid('partner_offer', offer),
              integer(version, 1, 2147483647),
            ],
          )
        ).rowCount === 1
      );
    },
  });
}
