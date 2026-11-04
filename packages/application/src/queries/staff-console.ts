import { ok, fail, id, instant, type Id } from '../../../domain/src/values/core.ts';
import { commercialPolicy } from '../../../domain/src/commercial-policy.ts';
import { publicPath } from '../../../domain/src/public-policy.ts';
import { pageRequest, type PageRequest, type Page } from '../ports/pagination.ts';
import type { StaffPermission } from '../ports/commercial.ts';
import type {
  StaffConsoleReads,
  StaffConsoleAuthority,
  SourceHealthRow,
} from '../ports/staff-console.ts';
import { demand, serviceFailure, ServiceFault } from '../services/service-work.ts';
export function createStaffConsoleQueries(d: {
  readonly authority: StaffConsoleAuthority;
  readonly reads: StaffConsoleReads;
  readonly now: () => string;
}) {
  async function secured<T>(
    actor: Id<'staff'>,
    permission: StaffPermission,
    read: () => Promise<T>,
  ) {
    try {
      demand(id('staff', actor).ok);
      await d.authority.require(actor, permission);
      const value = structuredClone(await read());
      await d.authority.require(actor, permission);
      return ok(value);
    } catch (e) {
      return fail(serviceFailure(e));
    }
  }
  function request(raw: { limit: number; after: string | null }) {
    return pageRequest(raw.limit, raw.after);
  }
  function bounded<T>(rows: Page<T>, page: PageRequest) {
    demand(rows.items.length <= page.limit, 'integrity');
    return rows;
  }
  function sourceState(row: SourceHealthRow, asOf: string) {
    if (!row.enabled) return 'disabled' as const;
    if (row.hasError || ['failed', 'quarantined', 'rejected'].includes(row.lastRunState ?? ''))
      return 'attention' as const;
    if (!row.lastSucceededAt || !row.nextDueAt) return 'not_ready' as const;
    return row.nextDueAt <= asOf ? ('due' as const) : ('scheduled' as const);
  }
  return {
    findings(actor: Id<'staff'>, raw = { limit: 25, after: null as string | null }) {
      const parsed = request(raw);
      return secured(actor, 'seo.publish', async () => {
        demand(parsed.ok);
        const p = bounded(await d.reads.findings(parsed.value), parsed.value);
        return {
          items: p.items.map((r) => ({
            id: r.id,
            pageId: r.pageId,
            rule: r.rule,
            severity: r.severity,
            state: r.state,
            detectedAt: r.detectedAt,
          })),
          next: p.next,
        };
      });
    },
    reports(actor: Id<'staff'>, raw = { limit: 25, after: null as string | null }) {
      const parsed = request(raw);
      return secured(actor, 'privacy.review', async () => {
        demand(parsed.ok);
        const p = bounded(await d.reads.reports(parsed.value), parsed.value);
        return {
          items: p.items.map((r) => ({ id: r.id, state: r.state, updatedAt: r.updatedAt })),
          next: p.next,
        };
      });
    },
    strategy(actor: Id<'staff'>, raw = { limit: 25, after: null as string | null }) {
      const parsed = request(raw);
      return secured(actor, 'seo.publish', async () => {
        demand(parsed.ok);
        const p = bounded(await d.reads.strategy(parsed.value), parsed.value);
        return {
          items: p.items.map((r) => ({
            id: r.id,
            path: publicPath(r.path),
            canonical: publicPath(r.canonical),
            status: r.status,
            reviewDue: r.reviewDue,
          })),
          next: p.next,
        };
      });
    },
    sources(actor: Id<'staff'>, raw = { limit: 25, after: null as string | null }) {
      const parsed = request(raw);
      return secured(actor, 'data.review', async () => {
        demand(parsed.ok);
        demand(parsed.value.after === null || id('source_connector', parsed.value.after).ok);
        const [rawRows, bundle] = await Promise.all([
          d.reads.sources(parsed.value),
          d.reads.bundle(),
        ]);
        const rows = bounded(rawRows, parsed.value),
          stamp = instant(d.now());
        demand(stamp.ok);
        const asOf = stamp.value;
        return {
          asOf,
          actualCoverage: 'unconfirmed' as const,
          next: rows.next,
          bundle: bundle
            ? {
                id: bundle.bundleId,
                market: bundle.market,
                completeness: bundle.coverage,
                components: bundle.components.map((c) => ({
                  key: c.key,
                  datasetId: c.source.datasetId,
                  kind: c.source.kind,
                  fetchedAt: c.source.fetchedAt,
                  expiresAt: c.source.expiresAt.state === 'known' ? c.source.expiresAt.value : null,
                  freshness:
                    c.source.fetchedAt > asOf || c.source.expiresAt.state === 'unknown'
                      ? ('unknown' as const)
                      : c.source.expiresAt.value <= asOf
                        ? ('stale' as const)
                        : ('fresh' as const),
                  rights: {
                    display: c.source.rights.display,
                    api: c.source.rights.api,
                    cache: c.source.rights.cache,
                    derived: c.source.rights.derived,
                    snapshot: c.source.rights.snapshot,
                  },
                })),
              }
            : null,
          sources: rows.items.map((r) => ({
            key: r.key,
            kind: r.kind,
            enabled: r.enabled,
            state: sourceState(r, asOf),
            lastRunState: r.lastRunState,
            lastAttemptAt: r.lastAttemptAt,
            lastSucceededAt: r.lastSucceededAt,
            nextDueAt: r.nextDueAt,
          })),
        };
      });
    },
    configuration(actor: Id<'staff'>) {
      return secured(actor, 'commercial.manage', async () => {
        const current = await d.reads.configuration();
        if (!current) return { version: 0, policy: null, networkReady: false };
        demand(
          Number.isInteger(current.version) && current.version > 0 && current.version <= 2147483647,
          'integrity',
        );
        let policy;
        try {
          policy = commercialPolicy(current.policy);
        } catch {
          throw new ServiceFault('integrity');
        }
        return { version: current.version, policy, networkReady: current.networkReady };
      });
    },
  };
}
