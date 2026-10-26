import { ok, fail, id, instant, type Id } from '../../../domain/src/values/core.ts';
import {
  commercialPolicy,
  adReport,
  commercialDay,
  affiliateDestination,
  adRoute,
  placement,
  type CommercialPolicy,
  type AdSignals,
  type AdReport,
} from '../../../domain/src/commercial-policy.ts';
import type {
  CommercialRepository,
  CommercialIdentity,
  AffiliateChecker,
  AffiliateInput,
  StaffPermission,
} from '../ports/commercial.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import { demand, serviceWork, serviceFailure, ServiceFault } from './service-work.ts';
function valid<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new ServiceFault('invalid_input');
  }
}
function nonnegative(v: string) {
  demand(
    typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n,
  );
}
export function createCommercialServices(d: {
  readonly writeUow: UnitOfWork;
  readonly publicUow: UnitOfWork;
  readonly write: CommercialRepository;
  readonly read: CommercialRepository;
  readonly identity: CommercialIdentity;
  readonly checker: AffiliateChecker;
  readonly externalActivationApproved: boolean;
  readonly now: () => string;
}) {
  const run = <T>(uow: UnitOfWork, fn: (tx: Tx) => Promise<T>) =>
    serviceWork(uow, async (tx) => ok(await fn(tx)));
  async function authorize(
    tx: Tx,
    actor: Id<'staff'>,
    permission: StaffPermission,
    reviewer?: Id<'staff'>,
  ) {
    demand(id('staff', actor).ok);
    await d.write.authorize(tx, actor, permission);
    if (reviewer) {
      demand(reviewer !== actor && id('staff', reviewer).ok, 'forbidden');
      await d.write.authorize(tx, reviewer, permission);
    }
  }
  function current(p: CommercialPolicy) {
    const at = d.now();
    demand(instant(at).ok);
    return p.issuedAt <= at && p.expiresAt > at;
  }
  return {
    preview(actor: Id<'staff'>, raw: unknown) {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'commercial.manage');
        const p = valid(() => commercialPolicy(raw));
        demand(current(p));
        return {
          policy: p,
          checksum: d.identity.checksum(p),
          version: (await d.write.policy(tx))?.version ?? 0,
        };
      });
    },
    publish(actor: Id<'staff'>, reviewer: Id<'staff'>, expectedVersion: number, raw: unknown) {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'commercial.manage', reviewer);
        demand(
          Number.isInteger(expectedVersion) && expectedVersion >= 0 && expectedVersion < 2147483647,
        );
        const p = valid(() => commercialPolicy(raw));
        demand(current(p));
        return {
          version: await d.write.configure(
            tx,
            actor,
            reviewer,
            expectedVersion,
            p,
            d.identity.checksum(p),
          ),
        };
      });
    },
    placements(path: string, market: string, signals: AdSignals) {
      return run(d.publicUow, async (tx) => {
        demand(typeof path === 'string' && path.length <= 500 && market === 'US');
        if (!adRoute(path) || !(await d.read.page(tx, path, market))) return [];
        const p = await d.read.policy(tx);
        if (!p || !current(p.policy)) return [];
        // Until blocklist synchronization is evidenced, any manual block prevents external serving.
        const blocks = await d.read.blockedBrands(tx, market);
        return valid(() =>
          placement(
            p.policy,
            path,
            signals,
            d.externalActivationApproved && blocks.length === 0,
            p.networkReady,
          ),
        );
      });
    },
    adsTxt() {
      return run(d.publicUow, async (tx) => {
        const p = await d.read.policy(tx);
        return p && current(p.policy) && p.networkReady
          ? {
              status: 'ready' as const,
              body: p.policy.adsTxt.join('\n') + (p.policy.adsTxt.length ? '\n' : ''),
              version: p.version,
            }
          : { status: 'not_connected' as const, body: '', version: null };
      });
    },
    blockBrand(actor: Id<'staff'>, brand: string, market: string, reason: string) {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'commercial.manage');
        demand(
          typeof brand === 'string' &&
            /^[a-z0-9_-]{1,100}$/.test(brand) &&
            market === 'US' &&
            typeof reason === 'string' &&
            reason.trim().length >= 1 &&
            reason.length <= 500,
        );
        await d.write.blockBrand(
          tx,
          actor,
          brand,
          market,
          reason,
          d.identity.checksum({ brand, market, reason }),
        );
        return { blocked: true };
      });
    },
    setAffiliate(
      actor: Id<'staff'>,
      reviewer: Id<'staff'>,
      input: AffiliateInput,
      expectedRevision = '0',
    ) {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'affiliate.manage', reviewer);
        nonnegative(expectedRevision);
        demand(
          input &&
            Object.keys(input).sort().join(',') === 'destination,key,market,retailerId' &&
            typeof input.key === 'string' &&
            /^[a-z0-9_-]{1,100}$/.test(input.key) &&
            input.market === 'US' &&
            id('retailer', input.retailerId).ok &&
            typeof input.destination === 'string',
        );
        return {
          revision: await d.write.setAffiliate(
            tx,
            actor,
            reviewer,
            input,
            expectedRevision,
            d.identity.checksum(input),
          ),
        };
      });
    },
    async checkAffiliate(actor: Id<'staff'>, key: string) {
      try {
        const c = await run(d.writeUow, async (tx) => {
          await authorize(tx, actor, 'affiliate.manage');
          demand(typeof key === 'string' && /^[a-z0-9_-]{1,100}$/.test(key));
          return d.write.affiliateCheck(tx, key);
        });
        if (!c.ok) return c;
        const result = await d.checker.check(c.value.destination);
        demand(['valid', 'invalid', 'unavailable'].includes(result));
        return await run(d.writeUow, async (tx) => {
          await authorize(tx, actor, 'affiliate.manage');
          await d.write.checked(
            tx,
            actor,
            c.value,
            result,
            d.identity.checksum({ ...c.value, result }),
          );
          return { status: result };
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    resolveAffiliate(key: string, market: string) {
      return run(d.publicUow, async (tx) => {
        demand(typeof key === 'string' && /^[a-z0-9_-]{1,100}$/.test(key) && market === 'US');
        const a = await d.read.affiliate(tx, key, market);
        return a
          ? {
              destination: valid(() => affiliateDestination(a.destination, a.origin)),
              checkedAt: a.checkedAt,
              disclosure: 'We may earn a commission from this link.',
              rel: 'sponsored noopener noreferrer',
              referrerPolicy: 'no-referrer' as const,
            }
          : null;
      });
    },
    importReport(actor: Id<'staff'>, raw: unknown) {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'revenue.import');
        const r = valid(() => adReport(raw));
        const at = d.now();
        demand(instant(at).ok && r.fetchedAt <= at);
        const normalized: AdReport = {
          ...r,
          rows: [...r.rows].sort((a, b) => {
            const left = [a.day, a.dimension, a.currency].join(':'),
              right = [b.day, b.dimension, b.currency].join(':');
            return left < right ? -1 : left > right ? 1 : 0;
          }),
        };
        return d.write.importReport(
          tx,
          actor,
          normalized,
          d.identity.checksum({ ...normalized, fetchedAt: null }),
        );
      });
    },
    approveReport(
      actor: Id<'staff'>,
      reviewer: Id<'staff'>,
      importId: string,
      expectedGeneration: string,
    ) {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'revenue.import', reviewer);
        demand(id('ad_import', importId).ok);
        nonnegative(expectedGeneration);
        await d.write.approveReport(
          tx,
          actor,
          reviewer,
          importId,
          expectedGeneration,
          d.identity.checksum({ importId, expectedGeneration }),
        );
        return { status: 'approved' as const };
      });
    },
    revenue(actor: Id<'staff'>, account: string, day: string, dimension = 'all', currency = 'USD') {
      return run(d.writeUow, async (tx) => {
        await authorize(tx, actor, 'revenue.read');
        demand(
          id('ad_account', account).ok &&
            /^[A-Z]{3}$/.test(currency) &&
            (dimension === 'all' ||
              (/^(page|slot):[a-f0-9-]{36}$/.test(dimension) &&
                id('dimension', dimension.slice(5)).ok)),
        );
        valid(() => commercialDay(day));
        const r = await d.write.revenue(tx, account, day, dimension, currency),
          m = r.metric;
        const ratio = (n: string | null, den: string | null, factor: bigint) =>
          n !== null && den !== null && BigInt(den) > 0n
            ? ((BigInt(n) * factor) / BigInt(den)).toString()
            : null;
        return {
          status: !r.connected
            ? ('not_connected' as const)
            : !m
              ? ('not_reported' as const)
              : ('reported' as const),
          account,
          day,
          dimension,
          currency,
          metric: m,
          fillBasisPoints: m ? ratio(m.impressions, m.eligibleRequests, 10000n) : null,
          rpmMinor: m ? ratio(m.revenueMinor, m.impressions, 1000n) : null,
          viewabilityBasisPoints: m ? ratio(m.viewableImpressions, m.impressions, 10000n) : null,
          consentCoverageBasisPoints: m ? ratio(m.consentRequests, m.totalRequests, 10000n) : null,
          meanLatencyMs: m ? ratio(m.latencyTotalMs, m.latencySamples, 1n) : null,
          measurement: 'provider aggregates; missing measurements remain unavailable' as const,
        };
      });
    },
  };
}
