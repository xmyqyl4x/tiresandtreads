import type {
  PartnerOfferRepository,
  OfferDraft,
} from '../../../application/src/ports/partner-repositories.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { partnerContext, identifier, mapped } from './partner-support.ts';
import { partnerOfferFromRow } from './partner-mappers.ts';
import { boundedJson, pageLimit, reject } from './bounds.ts';
import { text, integer, one } from './private-values.ts';
const columns =
  'org_id,offer_id,version,supersedes_version,title,description,terms,discount_type,amount_minor,currency_code,percent_basis_points,service_code,minimum_tires,minimum_purchase_minor,minimum_purchase_currency,redemption_method,redemption_domain,redemption_url,logo_asset_id,logo_rights_warranted,valid_from,valid_until,status,created_by,reviewed_by';
const selectedColumns = columns + ",to_jsonb(offer_versions)->>'partner_author' AS partner_author";
function draftRow(i: OfferDraft) {
  const d = i.discount;
  if (!d || typeof d !== 'object') return reject();
  const monetary = 'money' in d ? d.money : null;
  const r = {
    org_id: i.organizationId,
    offer_id: i.offerId,
    version: i.version,
    supersedes_version: i.supersedesVersion,
    title: i.title,
    description: i.description,
    terms: i.terms,
    discount_type: d.kind,
    amount_minor: monetary?.minor.toString() ?? null,
    currency_code: monetary?.currency ?? null,
    percent_basis_points: 'basisPoints' in d ? d.basisPoints : null,
    service_code: 'service' in d ? d.service : null,
    minimum_tires: i.minimumTires,
    minimum_purchase_minor: i.minimumPurchase?.minor.toString() ?? null,
    minimum_purchase_currency: i.minimumPurchase?.currency ?? null,
    redemption_method: i.redemptionMethod,
    redemption_domain: i.redemptionDomain,
    redemption_url: i.redemptionUrl,
    logo_asset_id: i.logoAssetId,
    logo_rights_warranted: i.logoRightsWarranted,
    valid_from: i.validFrom,
    valid_until: i.validUntil,
    status: 'draft',
    created_by: i.createdBy,
    reviewed_by: null,
  };
  const authored = i.partnerAuthor === undefined ? r : { ...r, partner_author: i.partnerAuthor };
  const checked = partnerOfferFromRow(authored);
  if (!checked.ok) return reject();
  authored.terms = checked.value.terms;
  return authored;
}
export function createPartnerOfferRepository(s: WriteScope): PartnerOfferRepository {
  const q = s.query;
  async function lock(tx: Tx, org: unknown, offer: unknown) {
    await q(tx, 'SELECT partners.lock_offer_write($1,$2)', [
      identifier('organization', org),
      identifier('partner_offer', offer),
    ]);
  }
  const repo: PartnerOfferRepository = {
    async version(tx, scope, offer, version) {
      const org = await partnerContext(s, tx, scope);
      identifier('partner_offer', offer);
      integer(version);
      const r = (
        await q(
          tx,
          `SELECT ${selectedColumns} FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2 AND version=$3`,
          [org, offer, version],
        )
      ).rows[0];
      return r ? mapped(partnerOfferFromRow(r)) : null;
    },
    async versions(tx, scope, offer, before, limit) {
      const org = await partnerContext(s, tx, scope);
      identifier('partner_offer', offer);
      pageLimit(limit);
      if (before !== null) integer(before);
      return (
        await q(
          tx,
          `SELECT ${selectedColumns} FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2 AND ($3::int IS NULL OR version<$3) ORDER BY version DESC LIMIT $4`,
          [org, offer, before, limit],
        )
      ).rows.map((r) => mapped(partnerOfferFromRow(r)));
    },
    async appendDraft(tx, input) {
      const r = draftRow(input);
      await lock(tx, r.org_id, r.offer_id);
      await q(
        tx,
        'INSERT INTO partners.offers(id,org_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',
        [r.offer_id, r.org_id],
      );
      const head = (
        await q(
          tx,
          'SELECT version FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE',
          [r.org_id, r.offer_id],
        )
      ).rows[0];
      if (
        r.version !== Number(head?.version ?? 0) + 1 ||
        r.supersedes_version !== (head?.version ?? null)
      )
        return stop('conflict');
      const keys = [...columns.split(','), ...('partner_author' in r ? ['partner_author'] : [])],
        values = keys.map((k) =>
          k === 'terms' ? boundedJson(r.terms, 16384) : r[k as keyof typeof r],
        );
      const result = one(
        (
          await q(
            tx,
            `INSERT INTO partners.offer_versions(${keys.join(',')}) VALUES(${keys.map((_, n) => '$' + (n + 1)).join(',')}) RETURNING ${selectedColumns}`,
            values,
          )
        ).rows,
      );
      return mapped(partnerOfferFromRow(result));
    },
    async addTargets(tx, org, offer, version, targets) {
      integer(version);
      if (!Array.isArray(targets) || targets.length < 1 || targets.length > 32) return reject();
      const rows = targets.map((t) => {
        identifier('offer_target', t.id);
        text(t.market, 20);
        text(t.strategy, 40);
        if (t.rimInches !== null && !/^\d{1,2}(\.\d)?$/.test(t.rimInches)) return reject();
        if (t.radiusKm !== null && !/^\d{1,4}(\.\d{1,2})?$/.test(t.radiusKm)) return reject();
        return [
          t.id,
          org,
          offer,
          version,
          t.market,
          t.strategy,
          t.skuId,
          t.modelId,
          t.brandId,
          t.locationId,
          t.value,
          t.rimInches,
          t.radiusKm,
          boundedJson(t.rule, 4096),
        ];
      });
      await lock(tx, org, offer);
      for (const row of rows)
        await q(
          tx,
          'INSERT INTO partners.offer_targets(id,org_id,offer_id,offer_version,market,strategy,sku_id,model_id,brand_entity_id,location_id,value_text,rim_inches,radius_km,rule) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          row,
        );
    },
    async recordReview(tx, org, offer, version, reviewer) {
      await lock(tx, org, offer);
      integer(version);
      identifier('staff', reviewer);
      const r = await q(
        tx,
        "UPDATE partners.offer_versions SET status='reviewed',reviewed_by=$4,reviewed_at=clock_timestamp() WHERE org_id=$1 AND offer_id=$2 AND version=$3 AND status IN ('draft','pending_review')",
        [org, offer, version, reviewer],
      );
      if (r.rowCount !== 1) stop('conflict');
    },
    async selectPublished(tx, org, offer, version, expected) {
      await lock(tx, org, offer);
      integer(version);
      if (expected !== null) integer(expected);
      const head = (
        await q(tx, 'SELECT current_version FROM partners.offers WHERE org_id=$1 AND id=$2', [
          org,
          offer,
        ])
      ).rows[0];
      if (!head || head.current_version !== expected) stop('conflict');
      const changed = await q(
        tx,
        "UPDATE partners.offer_versions SET status='published' WHERE org_id=$1 AND offer_id=$2 AND version=$3 AND status='reviewed'",
        [org, offer, version],
      );
      if (changed.rowCount !== 1) stop('conflict');
      await q(
        tx,
        "UPDATE partners.offers SET current_version=$3,status='active' WHERE org_id=$1 AND id=$2",
        [org, offer, version],
      );
    },
  };
  return guarded(s, repo);
}
