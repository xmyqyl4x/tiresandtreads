import type { PartnerReportingRepository } from '../../../application/src/ports/partner-repositories.ts';
import { instant, integer as int64 } from '../../../domain/src/values/core.ts';
import { createPartnerTenantRepository } from './partner-tenant.ts';
import { partnerMetricFromRow } from './partner-mappers.ts';
import { partnerContext, mapped, identifier } from './partner-support.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { cursor, nextCursor, pageLimit, reject, digest } from './bounds.ts';
import { stamp, text } from './private-values.ts';
function count(value: unknown) {
  const r = int64(value, 0n);
  return r.ok ? r.value : stop('integrity');
}
function day(value: unknown) {
  if (typeof value !== 'string' || !instant(value + 'T00:00:00.000Z').ok) return reject();
  return value;
}
export function createPartnerReportingRepository(s: WriteScope): PartnerReportingRepository {
  const q = s.query,
    tenant = createPartnerTenantRepository(s);
  const repo: PartnerReportingRepository = {
    async pilot(tx, scope) {
      const organization = await tenant.organization(tx, scope);
      if (!organization) return null;
      const r = (
        await q(
          tx,
          `SELECT
    (SELECT count(*)::text FROM partners.locations WHERE org_id=$1 AND status='approved') AS locations,
    (SELECT count(*)::text FROM partners.offers WHERE org_id=$1 AND status='active') AS offers,
    (SELECT count(DISTINCT kind)::text FROM partners.agreements WHERE org_id=$1 AND status='accepted' AND accepted_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())) AS agreements`,
          [organization.id],
        )
      ).rows[0]!;
      return Object.freeze({
        organization,
        approvedLocations: count(r.locations),
        activeOffers: count(r.offers),
        acceptedAgreements: count(r.agreements),
      });
    },
    async metrics(tx, scope, input) {
      const org = await partnerContext(s, tx, scope),
        from = day(input.from),
        through = day(input.through),
        limit = pageLimit(input.limit);
      if (
        from > through ||
        Date.parse(through) - Date.parse(from) > 366 * 86400000 ||
        !['included', 'clicks', 'codes_issued', 'reported_redemptions', 'complaints'].includes(
          input.metric,
        )
      )
        return reject();
      const binding = digest({
        kind: 'partner_metrics',
        org,
        actor: scope.actor,
        from,
        through,
        metric: input.metric,
      });
      let afterDay: string | null = null,
        afterMarket: string | null = null,
        generation: string | null = null;
      if (input.after !== null) {
        if (
          typeof input.after !== 'string' ||
          input.after.length > 1024 ||
          !/^[A-Za-z0-9_-]+$/.test(input.after)
        )
          return reject();
        let parts: unknown;
        try {
          parts = JSON.parse(Buffer.from(input.after, 'base64url').toString('utf8'));
        } catch {
          return reject();
        }
        if (
          !Array.isArray(parts) ||
          parts.length !== 5 ||
          parts[0] !== 1 ||
          parts[1] !== binding ||
          typeof parts[2] !== 'string' ||
          !int64(parts[2], 1n).ok
        )
          return reject();
        generation = parts[2];
        afterDay = day(parts[3]);
        afterMarket = text(parts[4], 20);
      }
      // Header and cells share one SQL statement snapshot. Cursor pins the current generation.
      const rows = (
        await q(
          tx,
          `SELECT h.revision::text AS generation,h.state,m.day::text,m.metric,m.market,m.total_count::text
        FROM partners.insight_heads h LEFT JOIN LATERAL (
          SELECT day,metric,market,total_count FROM partners.partner_daily_metrics
          WHERE org_id=$1 AND day BETWEEN $2::date AND $3::date AND metric=$4
          AND ($5::date IS NULL OR (day,market)>($5::date,$6::text)) ORDER BY day,market LIMIT $7
        ) m ON true WHERE h.org_id=$1`,
          [org, from, through, input.metric, afterDay, afterMarket, limit + 1],
        )
      ).rows;
      const header = rows[0];
      if (
        generation !== null &&
        (!header || header.generation !== generation || header.state !== 'ready')
      )
        return stop('conflict');
      if (!header || header.state !== 'ready') return { items: [], next: null };
      if (!int64(header.generation, 1n).ok) return stop('integrity');
      const cells = rows.filter((row) => row.day !== null),
        items = cells.slice(0, limit).map((row) => mapped(partnerMetricFromRow(row)));
      const last = items.at(-1);
      return Object.freeze({
        items: Object.freeze(items),
        next:
          cells.length > limit && last
            ? Buffer.from(
                JSON.stringify([1, binding, header.generation, last.day, last.market]),
              ).toString('base64url')
            : null,
      });
    },
    async disputes(tx, scope, page) {
      const org = await partnerContext(s, tx, scope),
        limit = pageLimit(page.limit),
        key = { kind: 'partner_disputes', org, actor: scope.actor },
        after = cursor(key, page.after);
      const rows = (
        await q(
          tx,
          'SELECT id,reason_code,state,created_at,closed_at FROM partners.disputes WHERE org_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
          [org, after, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map((r) =>
        Object.freeze({
          id: identifier('partner_dispute', r.id),
          reason: text(r.reason_code, 40),
          state: text(r.state, 40),
          createdAt: stamp(r.created_at),
          closedAt: r.closed_at === null ? null : stamp(r.closed_at),
        }),
      );
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(key, items.at(-1)!.id) : null,
      });
    },
  };
  return guarded(s, repo);
}
