import type { OperationsRepository } from '../../../application/src/ports/operations.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { cursor, nextCursor, pageLimit, reject } from './bounds.ts';
import { rid, stamp, text } from './private-values.ts';
function day(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    reject();
  return value;
}
export function createOperationsRepository(scope: WriteScope): OperationsRepository {
  const q = scope.query;
  return guarded(scope, {
    async pages(tx, page) {
      const size = pageLimit(page.limit),
        after = cursor('seo-pages', page.after);
      const r = await q(
        tx,
        'SELECT * FROM admin.seo_projection WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
        [after, size + 1],
      );
      const items = r.rows.slice(0, size).map((x) => ({
        id: rid('seo_page', x.id),
        path: String(x.public_path),
        canonical: String(x.canonical_path),
        status: String(x.index_status),
        reviewDue: stamp(x.review_due_at),
      }));
      return {
        items,
        next: r.rows.length > size ? nextCursor('seo-pages', items.at(-1)!.id) : null,
      };
    },
    async staff(tx, id) {
      const x = (await q(tx, 'SELECT status,roles FROM admin.staff_projection WHERE id=$1', [id]))
        .rows[0];
      return x ? { active: x.status === 'active', roles: x.roles as string[] } : null;
    },
    async configuration(tx, key) {
      const x = (
        await q(
          tx,
          'SELECT version,status FROM admin.configuration_projection WHERE key=$1 ORDER BY version DESC LIMIT 1',
          [text(key, 100)],
        )
      ).rows[0];
      return x ? { version: Number(x.version), status: String(x.status) } : null;
    },
    async affiliate(tx, key, market) {
      const x = (
        await q(
          tx,
          'SELECT destination,checked_at FROM admin.affiliate_projection WHERE link_key=$1 AND market=$2',
          [text(key, 100), text(market, 3)],
        )
      ).rows[0];
      return x ? { destination: String(x.destination), checkedAt: stamp(x.checked_at) } : null;
    },
    async slots(tx, route) {
      if (!['education', 'glossary', 'tire_model', 'tire_size'].includes(route)) reject();
      return (
        await q(
          tx,
          'SELECT slot_key,active FROM admin.ad_slot_projection WHERE route_class=$1 ORDER BY slot_key LIMIT 100',
          [route],
        )
      ).rows.map((x) => ({ key: String(x.slot_key), active: x.active === true }));
    },
    async search(tx, page, date, source) {
      if (!['search_console', 'bing_webmaster'].includes(source)) reject();
      const x = (
        await q(
          tx,
          'SELECT clicks,impressions,position_sum FROM admin.search_projection WHERE page_id=$1 AND day=$2 AND source=$3',
          [page, day(date), source],
        )
      ).rows[0];
      return x
        ? {
            clicks: BigInt(String(x.clicks)),
            impressions: BigInt(String(x.impressions)),
            positionSum: x.position_sum === null ? null : String(x.position_sum),
          }
        : null;
    },
    async ads(tx, account, date, dimension, currency, status) {
      if (
        !/^(all|(?:page|slot):[0-9a-f-]{36})$/.test(dimension) ||
        !['estimated', 'finalized'].includes(status)
      )
        reject();
      const x = (
        await q(
          tx,
          'SELECT impressions,eligible_requests,revenue_minor,source_revision FROM admin.current_ad_daily_metrics WHERE account_id=$1 AND day=$2 AND dimension_key=$3 AND currency=$4 AND revenue_status=$5',
          [account, day(date), dimension, text(currency, 3), status],
        )
      ).rows[0];
      return x
        ? {
            impressions: BigInt(String(x.impressions)),
            eligibleRequests:
              x.eligible_requests === null ? null : BigInt(String(x.eligible_requests)),
            revenueMinor: BigInt(String(x.revenue_minor)),
            sourceRevision: String(x.source_revision),
          }
        : null;
    },
    async metric(tx, date, metric, market, dimension) {
      if (
        !['events', 'sessions'].includes(metric) ||
        !['all', 'web', 'app', 'mcp'].includes(dimension)
      )
        reject();
      const x = (
        await q(
          tx,
          'SELECT value,generation,requested_revision,completed_revision,computed_at FROM analytics.visible_daily_metrics WHERE day=$1 AND metric_code=$2 AND market=$3 AND dimension_key=$4',
          [day(date), metric, text(market, 3), dimension],
        )
      ).rows[0];
      return x
        ? {
            value: BigInt(String(x.value)),
            generation: BigInt(String(x.generation)),
            pending: BigInt(String(x.requested_revision)) > BigInt(String(x.completed_revision)),
            computedAt: stamp(x.computed_at),
          }
        : null;
    },
  } satisfies OperationsRepository);
}
