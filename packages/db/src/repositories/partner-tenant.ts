import type { PartnerTenantRepository } from '../../../application/src/ports/partner-repositories.ts';
import type { WriteScope } from './mutations.ts';
import { guarded } from './mutations.ts';
import { partnerContext, mapped, identifier } from './partner-support.ts';
import { partnerOrganizationFromRow } from './partner-mappers.ts';
import { cursor, nextCursor, pageLimit } from './bounds.ts';
import { rev, text } from './private-values.ts';
import { stop } from './mutations.ts';
export function createPartnerTenantRepository(s: WriteScope): PartnerTenantRepository {
  return guarded(s, {
    async organization(tx, scope) {
      const org = await partnerContext(s, tx, scope),
        r = (
          await s.query(
            tx,
            'SELECT id,legal_name,market,status,verification_status,revision::text FROM partners.organizations WHERE id=$1',
            [org],
          )
        ).rows[0];
      return r ? mapped(partnerOrganizationFromRow(r)) : null;
    },
    async membership(tx, scope) {
      const org = await partnerContext(s, tx, scope),
        r = (
          await s.query(
            tx,
            "SELECT role,revision::text FROM partners.memberships WHERE org_id=$1 AND provider_subject=$2 AND status='active'",
            [org, scope.actor],
          )
        ).rows[0];
      if (!r) return null;
      if (!['owner', 'manager', 'analyst'].includes(String(r.role))) return stop('integrity');
      return Object.freeze({
        role: r.role as 'owner' | 'manager' | 'analyst',
        revision: rev(r.revision),
      });
    },
    async locations(tx, scope, page) {
      const org = await partnerContext(s, tx, scope),
        limit = pageLimit(page.limit),
        key = { kind: 'partner_locations', org, actor: scope.actor },
        after = cursor(key, page.after);
      const rows = (
        await s.query(
          tx,
          'SELECT id,market,region_key,status FROM partners.locations WHERE org_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
          [org, after, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map((r) =>
        Object.freeze({
          id: identifier('partner_location', r.id),
          market: text(r.market, 20),
          region: r.region_key === null ? null : text(r.region_key, 200),
          status: text(r.status, 40),
        }),
      );
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(key, items.at(-1)!.id) : null,
      });
    },
  });
}
