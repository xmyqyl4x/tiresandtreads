import type { CommercialRepository } from '../../../application/src/ports/commercial.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import {
  commercialPolicy,
  affiliateDestination,
  type AdMetric,
} from '../../../domain/src/commercial-policy.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { one, text, stamp, obj } from './private-values.ts';
import { operationsAudit } from './operations-audit.ts';
export function createCommercialRepository(s: WriteScope): CommercialRepository {
  const q = s.query,
    audit = operationsAudit(s);
  async function account(tx: Tx, id: string) {
    return one(
      (await q(tx, 'SELECT id,status FROM admin.ad_network_accounts WHERE id=$1 FOR UPDATE', [id]))
        .rows,
    );
  }
  async function generation(tx: Tx, id: string) {
    return text(
      (
        await q(
          tx,
          "SELECT COALESCE(max(source_generation),0)::text AS generation FROM admin.ad_report_imports WHERE account_id=$1 AND state='approved'",
          [id],
        )
      ).rows[0]!.generation,
    );
  }
  const repo: CommercialRepository = {
    authorize: audit.authorize,
    async policy(tx) {
      const r = (await q(tx, 'SELECT * FROM admin.commercial_policy')).rows[0];
      return r
        ? {
            version: Number(r.version),
            policy: commercialPolicy(obj(r.value, 65536)),
            networkReady: r.network_ready === true,
          }
        : null;
    },
    async configure(tx, actor, reviewer, expected, p, digest) {
      await q(tx, 'SELECT pg_advisory_xact_lock(2601,1)');
      const previous = (
        await q(
          tx,
          "SELECT COALESCE(max(version),0) AS version FROM admin.configuration_versions WHERE key='commercial_policy' AND status='published'",
        )
      ).rows[0]!;
      if (Number(previous.version) !== expected) return stop('conflict');
      if (p.accountId && (await account(tx, p.accountId)).status !== 'verified')
        return stop('forbidden');
      const version = expected + 1;
      const c = one(
        (
          await q(
            tx,
            "INSERT INTO admin.configuration_versions(key,version,value,status,published_at,reviewed_by) VALUES('commercial_policy',$1,$2,'published',clock_timestamp(),$3) RETURNING id",
            [version, JSON.stringify(p), reviewer],
          )
        ).rows,
      );
      await q(
        tx,
        "UPDATE admin.ad_slots SET status='disabled',revision=revision+1,updated_at=clock_timestamp() WHERE status<>'disabled'",
      );
      for (const slot of p.slots)
        await q(
          tx,
          "INSERT INTO admin.ad_slots(slot_key,route_class,configuration_id,status) VALUES($1,$2,$3,'active') ON CONFLICT(slot_key) DO UPDATE SET route_class=EXCLUDED.route_class,configuration_id=EXCLUDED.configuration_id,status='active',revision=ad_slots.revision+1,updated_at=clock_timestamp()",
          [slot.key, slot.route, c.id],
        );
      await audit.record(tx, actor, 'commercial.configure', digest);
      await audit.record(tx, reviewer, 'commercial.review', digest, 'approved');
      return version;
    },
    async page(tx, path, market) {
      return (
        (
          await q(tx, 'SELECT 1 FROM app.public_pages WHERE public_path=$1 AND market=$2 LIMIT 1', [
            path,
            market,
          ])
        ).rows.length > 0
      );
    },
    async blockedBrands(tx, market) {
      return (
        await q(
          tx,
          'SELECT brand_key FROM admin.commercial_brands WHERE market=$1 ORDER BY brand_key LIMIT 1001',
          [market],
        )
      ).rows.map((r) => text(r.brand_key));
    },
    async blockBrand(tx, actor, brand, market, reason, digest) {
      await q(
        tx,
        'INSERT INTO admin.ad_brand_blocks(brand_key,market,reason) VALUES($1,$2,$3) ON CONFLICT(brand_key,market) DO UPDATE SET reason=EXCLUDED.reason,revision=ad_brand_blocks.revision+1,updated_at=clock_timestamp()',
        [brand, market, reason],
      );
      await audit.record(tx, actor, 'commercial.brand_block', digest);
    },
    async affiliate(tx, key, market) {
      const r = (
        await q(
          tx,
          'SELECT destination,approved_origin,checked_at FROM admin.commercial_affiliates WHERE link_key=$1 AND market=$2',
          [key, market],
        )
      ).rows[0];
      return r
        ? {
            destination: text(r.destination, 2048),
            origin: text(r.approved_origin, 300),
            checkedAt: stamp(r.checked_at),
          }
        : null;
    },
    async setAffiliate(tx, actor, reviewer, i, expected, digest) {
      await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,2602))', [i.key]);
      const retailer = one(
        (
          await q(
            tx,
            "SELECT r.approved_origin FROM app.retailers r WHERE r.id=$1 AND r.market=$2 AND r.status='active' AND EXISTS(SELECT 1 FROM admin.affiliate_applications a JOIN app.object_assets t ON t.id=a.approved_terms_asset_id WHERE a.retailer_id=r.id AND a.status='approved' AND t.state='ready')",
            [i.retailerId, i.market],
          )
        ).rows,
      );
      try {
        affiliateDestination(i.destination, text(retailer.approved_origin, 300));
      } catch {
        return stop('invalid_input');
      }
      const previous = (
        await q(tx, 'SELECT revision FROM admin.affiliate_links WHERE link_key=$1 FOR UPDATE', [
          i.key,
        ])
      ).rows[0];
      if (String(previous?.revision ?? 0) !== expected) return stop('conflict');
      const r = one(
        (
          await q(
            tx,
            "INSERT INTO admin.affiliate_links(retailer_id,link_key,destination,market,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(link_key) DO UPDATE SET retailer_id=EXCLUDED.retailer_id,destination=EXCLUDED.destination,market=EXCLUDED.market,status='active',revision=affiliate_links.revision+1,updated_at=clock_timestamp() RETURNING revision",
            [i.retailerId, i.key, i.destination, i.market],
          )
        ).rows,
      );
      await audit.record(tx, actor, 'affiliate.configure', digest);
      await audit.record(tx, reviewer, 'affiliate.review', digest, 'approved');
      return String(r.revision);
    },
    async affiliateCheck(tx, key) {
      const r = (
        await q(
          tx,
          "SELECT l.id,l.destination,l.revision,r.approved_origin FROM admin.affiliate_links l JOIN app.retailers r ON r.id=l.retailer_id WHERE l.link_key=$1 AND l.status='active' AND r.status='active'",
          [key],
        )
      ).rows[0];
      if (!r) return stop('not_found');
      affiliateDestination(text(r.destination, 2048), text(r.approved_origin, 300));
      return {
        id: text(r.id),
        destination: text(r.destination, 2048),
        revision: String(r.revision),
      };
    },
    async checked(tx, actor, c, result, digest) {
      const r = one(
        (
          await q(
            tx,
            'SELECT destination,revision FROM admin.affiliate_links WHERE id=$1 FOR UPDATE',
            [c.id],
          )
        ).rows,
      );
      if (r.destination !== c.destination || String(r.revision) !== c.revision)
        return stop('conflict');
      const check = one(
        (
          await q(
            tx,
            "INSERT INTO admin.affiliate_link_checks(link_id,checked_at,result,expires_at) VALUES($1,clock_timestamp(),$2,clock_timestamp()+interval '24 hours') RETURNING id",
            [c.id, result],
          )
        ).rows,
      );
      await q(
        tx,
        "INSERT INTO admin.affiliate_check_bindings(check_id,link_revision,destination_hash) VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'))",
        [check.id, c.revision, c.destination],
      );
      await audit.record(tx, actor, 'affiliate.check', digest);
    },
    async importReport(tx, actor, r, checksum) {
      const a = await account(tx, r.accountId);
      if (a.status !== 'verified') return stop('forbidden');
      const previous = (
        await q(
          tx,
          'SELECT id,checksum,source_generation,state FROM admin.ad_report_imports WHERE account_id=$1 AND period_start=$2 AND period_end=$3 AND source_revision=$4',
          [r.accountId, r.start, r.end, r.sourceRevision],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.checksum !== checksum ||
          String(previous.source_generation) !== r.sourceGeneration
        )
          return stop('conflict');
        return { id: text(previous.id), state: text(previous.state) };
      }
      if (BigInt(r.sourceGeneration) <= BigInt(await generation(tx, r.accountId)))
        return stop('conflict');
      const head = one(
        (
          await q(
            tx,
            "INSERT INTO admin.ad_report_imports(account_id,period_start,period_end,source_revision,source_generation,checksum,state,fetched_at) VALUES($1,$2,$3,$4,$5,$6,'staging',$7) RETURNING id",
            [
              r.accountId,
              r.start,
              r.end,
              r.sourceRevision,
              r.sourceGeneration,
              checksum,
              r.fetchedAt,
            ],
          )
        ).rows,
      );
      for (const row of r.rows) {
        const page = row.dimension.startsWith('page:') ? row.dimension.slice(5) : null,
          slot = row.dimension.startsWith('slot:') ? row.dimension.slice(5) : null;
        if (
          page &&
          !(await q(tx, 'SELECT 1 FROM app.public_pages WHERE id=$1', [page])).rows.length
        )
          return stop('forbidden');
        if (
          slot &&
          !(await q(tx, "SELECT 1 FROM admin.ad_slots WHERE id=$1 AND status='active'", [slot]))
            .rows.length
        )
          return stop('forbidden');
        const m = one(
          (
            await q(
              tx,
              'INSERT INTO admin.ad_daily_metrics(import_id,day,dimension_key,page_id,slot_id,currency,impressions,eligible_requests,revenue_minor,revenue_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
              [
                head.id,
                row.day,
                row.dimension,
                page,
                slot,
                row.currency,
                row.impressions,
                row.eligibleRequests,
                row.revenueMinor,
                row.revenueStatus,
              ],
            )
          ).rows,
        );
        await q(
          tx,
          'INSERT INTO admin.ad_metric_observations(metric_id,viewable_impressions,consent_requests,total_requests,latency_samples,latency_total_ms) VALUES($1,$2,$3,$4,$5,$6)',
          [
            m.id,
            row.viewableImpressions,
            row.consentRequests,
            row.totalRequests,
            row.latencySamples,
            row.latencyTotalMs,
          ],
        );
      }
      await q(tx, "UPDATE admin.ad_report_imports SET state='validated' WHERE id=$1", [head.id]);
      await audit.record(tx, actor, 'revenue.import', checksum);
      return { id: text(head.id), state: 'validated' };
    },
    async approveReport(tx, actor, reviewer, id, expected, digest) {
      const ref = one(
        (await q(tx, 'SELECT account_id FROM admin.ad_report_imports WHERE id=$1', [id])).rows,
      );
      const a = await account(tx, text(ref.account_id));
      if (a.status !== 'verified') return stop('forbidden');
      const r = one(
        (
          await q(
            tx,
            'SELECT state,source_generation FROM admin.ad_report_imports WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows,
      );
      if (r.state === 'approved') return;
      if (
        r.state !== 'validated' ||
        (await generation(tx, text(ref.account_id))) !== expected ||
        BigInt(String(r.source_generation)) <= BigInt(expected)
      )
        return stop('conflict');
      await q(tx, "UPDATE admin.ad_report_imports SET state='approved' WHERE id=$1", [id]);
      await audit.record(tx, actor, 'revenue.publish', digest);
      await audit.record(tx, reviewer, 'revenue.review', digest, 'approved');
    },
    async revenue(tx, account, day, dimension, currency) {
      const a = (await q(tx, 'SELECT status FROM admin.ad_network_accounts WHERE id=$1', [account]))
        .rows[0];
      const r = (
        await q(
          tx,
          'SELECT * FROM admin.commercial_revenue WHERE account_id=$1 AND day=$2 AND dimension_key=$3 AND currency=$4',
          [account, day, dimension, currency],
        )
      ).rows[0];
      const n = (k: string) => (r![k] === null ? null : String(r![k]));
      return {
        connected: a?.status === 'verified',
        metric: r
          ? {
              day,
              dimension,
              currency,
              impressions: String(r.impressions),
              eligibleRequests: n('eligible_requests'),
              revenueMinor: String(r.revenue_minor),
              revenueStatus: r.revenue_status as AdMetric['revenueStatus'],
              viewableImpressions: n('viewable_impressions'),
              consentRequests: n('consent_requests'),
              totalRequests: n('total_requests'),
              latencySamples: n('latency_samples'),
              latencyTotalMs: n('latency_total_ms'),
              sourceRevision: text(r.source_revision),
              sourceGeneration: String(r.source_generation),
              fetchedAt: stamp(r.fetched_at),
            }
          : null,
      };
    },
  };
  return guarded(s, repo);
}
