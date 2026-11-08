import type { PartnerReviewRepository } from '../../../application/src/ports/partner-review.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, word, integer, at, rev } from './partner-service-values.ts';
const nullable = (v: unknown) => (v === null ? null : word(v, 200));
export function createPartnerReviewRepository(s: WriteScope): PartnerReviewRepository {
  const q = s.query;
  return guarded<PartnerReviewRepository>(s, {
    async queue(tx, kind, after, limit) {
      integer(limit, 1, 26);
      const rows = (
        await q(
          tx,
          kind === 'businesses'
            ? "SELECT o.id AS org,o.id AS resource,NULL::integer AS version,o.legal_name AS title,p.state,p.revision::text FROM partners.organizations o JOIN partners.onboarding_profiles p ON p.org_id=o.id WHERE p.state='submitted' AND ($1::uuid IS NULL OR o.id>$1) ORDER BY o.id LIMIT $2"
            : "SELECT v.org_id AS org,v.offer_id AS resource,v.version,v.title,v.status AS state,NULL::text AS revision FROM partners.offer_versions v WHERE v.status='pending_review' AND ($1::uuid IS NULL OR (v.org_id,v.offer_id,v.version)>($1::uuid,$2::uuid,$3::integer)) ORDER BY v.org_id,v.offer_id,v.version LIMIT $4",
          kind === 'businesses'
            ? [after?.org ?? null, limit]
            : [after?.org ?? null, after?.offer ?? null, after?.version ?? null, limit],
        )
      ).rows;
      return rows.map((r) => ({
        org: uid('organization', r.org),
        resource: uid(kind === 'businesses' ? 'organization' : 'partner_offer', r.resource),
        version: r.version === null ? null : integer(r.version, 1, 2147483647),
        title: word(r.title, 200),
        state: word(r.state, 40),
        revision: r.revision === null ? null : rev(r.revision),
      }));
    },
    async context(tx, org) {
      const a = (
        await q(
          tx,
          "SELECT b.asset_id,b.purpose,b.state,a.expires_at FROM partners.organization_assets b JOIN app.object_assets a ON a.id=b.asset_id WHERE b.org_id=$1 AND b.purpose IN('agreement','verification') ORDER BY b.asset_id LIMIT 51",
          [uid('organization', org)],
        )
      ).rows;
      const g = (
        await q(
          tx,
          'SELECT kind,version,status,expires_at FROM partners.current_agreements WHERE org_id=$1 ORDER BY kind,version LIMIT 51',
          [org],
        )
      ).rows;
      const l = (
        await q(
          tx,
          'SELECT id,location_key,region_key,status FROM partners.locations WHERE org_id=$1 ORDER BY id LIMIT 51',
          [org],
        )
      ).rows;
      return {
        assets: a.slice(0, 50).map((r) => {
          if (r.purpose !== 'agreement' && r.purpose !== 'verification') return stop('integrity');
          return {
            id: uid('asset', r.asset_id),
            purpose: r.purpose,
            state: word(r.state, 40),
            expiresAt: at(r.expires_at),
          };
        }),
        agreements: g.slice(0, 50).map((r) => ({
          kind: word(r.kind, 40),
          version: word(r.version, 100),
          status: word(r.status, 40),
          expiresAt: at(r.expires_at),
        })),
        locations: l.slice(0, 50).map((r) => ({
          id: uid('partner_location', r.id),
          key: word(r.location_key, 200),
          region: word(r.region_key, 100),
          status: word(r.status, 40),
        })),
        truncated: a.length > 50 || g.length > 50 || l.length > 50,
      };
    },
    async targets(tx, org, offer, version) {
      const rows = (
        await q(
          tx,
          'SELECT strategy,value_text AS value,sku_id,model_id,brand_entity_id AS brand_id,location_id,rim_inches::text AS rim,radius_km::text AS radius FROM partners.offer_targets WHERE org_id=$1 AND offer_id=$2 AND offer_version=$3 ORDER BY id LIMIT 33',
          [uid('organization', org), uid('partner_offer', offer), integer(version, 1, 2147483647)],
        )
      ).rows;
      if (rows.length > 32) return stop('unavailable');
      return rows.map((r) => ({
        strategy: word(r.strategy, 40),
        value: nullable(r.value),
        sku: nullable(r.sku_id),
        model: nullable(r.model_id),
        brand: nullable(r.brand_id),
        location: nullable(r.location_id),
        rim: nullable(r.rim),
        radius: nullable(r.radius),
      }));
    },
  });
}
