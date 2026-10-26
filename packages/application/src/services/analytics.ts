import { ok, fail, instant, type Id } from '../../../domain/src/values/core.ts';
import { decodeAnalyticsBatch } from '../../../domain/src/analytics-policy.ts';
import type { AnalyticsRepository, AnalyticsEvent } from '../ports/analytics.ts';
import type {
  AnalyticsAuthority,
  AnalyticsMaintenance,
  CollectionCrypto,
  QuotaCrypto,
  HealthRepository,
} from '../ports/analytics-services.ts';
import type { LimiterRepository } from '../ports/limiter.ts';
import type { OperationsRepository } from '../ports/operations.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import { failure } from '../ports/transactions.ts';
import { demand, serviceWork, serviceFailure } from './service-work.ts';
export function createAdmissionServices(d: {
  readonly uow: UnitOfWork;
  readonly limiter: LimiterRepository;
  readonly crypto: QuotaCrypto;
}) {
  return {
    async admit(
      operation: 'report_delivery' | 'analytics',
      input: Readonly<{ ip: string; email?: string }>,
    ) {
      const result = await serviceWork(d.uow, async (tx) => {
        demand(operation === 'report_delivery' || operation === 'analytics');
        let ip: readonly KeyDigest[], email: readonly KeyDigest[];
        try {
          ip = d.crypto.keys('ip', input.ip);
          email = operation === 'report_delivery' ? d.crypto.keys('email', input.email!) : [];
        } catch {
          demand(false);
        }
        return ok(
          await d.limiter.consume(
            tx,
            operation === 'report_delivery'
              ? [
                  { policy: 'report_email', version: '1', keys: email! },
                  { policy: 'report_ip', version: '1', keys: ip! },
                ]
              : [{ policy: 'analytics_ip', version: '1', keys: ip! }],
          ),
        );
      });
      return !result.ok && result.error.code === 'forbidden'
        ? fail(failure('unavailable'))
        : result;
    },
    cleanup(limit = 250) {
      return serviceWork(d.uow, async (tx) => ok(await d.limiter.cleanup(tx, limit)));
    },
  };
}
export function createAnalyticsServices(d: {
  readonly authorityUow: UnitOfWork;
  readonly analyticsUow: UnitOfWork;
  readonly rebuildUow: UnitOfWork;
  readonly authority: AnalyticsAuthority;
  readonly events: AnalyticsRepository;
  readonly rebuild: AnalyticsRepository;
  readonly maintenance: AnalyticsMaintenance;
  readonly crypto: CollectionCrypto;
  readonly admission: ReturnType<typeof createAdmissionServices>;
  readonly enabled: boolean;
  readonly policy: string;
  readonly noticeId: Id<'notice'>;
  readonly now: () => string;
}) {
  function clock() {
    const r = instant(d.now());
    demand(r.ok);
    return r.value;
  }
  const work = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.analyticsUow, async (tx) => ok(await fn(tx)));
  return {
    async issue(
      keys: readonly KeyDigest[],
      signals: Readonly<{ gpc: boolean; cmpAvailable: boolean }>,
      channel: AnalyticsEvent['channel'] = 'web',
    ) {
      try {
        demand(
          typeof signals.gpc === 'boolean' &&
            typeof signals.cmpAvailable === 'boolean' &&
            ['web', 'app', 'mcp'].includes(channel),
        );
        if (!d.enabled || signals.gpc || !signals.cmpAvailable)
          return ok({ status: 'refused' as const });
        return await serviceWork<{ status: 'refused' } | { status: 'issued'; token: string }>(
          d.authorityUow,
          async (tx) => {
            const grant = await d.authority.grant(tx, keys, d.policy, d.noticeId);
            return ok(
              grant
                ? { status: 'issued' as const, token: d.crypto.issue(grant, channel, clock()) }
                : { status: 'refused' as const },
            );
          },
        );
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async collect(
      token: string,
      raw: string,
      signals: Readonly<{
        ip: string;
        gpc: boolean;
        cmpAvailable: boolean;
        bot: AnalyticsEvent['bot'];
      }>,
    ) {
      try {
        demand(
          typeof signals.gpc === 'boolean' &&
            typeof signals.cmpAvailable === 'boolean' &&
            ['unknown', 'internal', 'suspected_bot', 'not_flagged'].includes(signals.bot),
        );
        if (!d.enabled || signals.gpc || !signals.cmpAvailable)
          return ok({ status: 'refused' as const });
        const at = clock(),
          c = d.crypto.parse(token, at);
        if (!c || c.policy !== d.policy || c.scope !== 'site')
          return ok({ status: 'refused' as const });
        let batch: ReturnType<typeof decodeAnalyticsBatch>;
        try {
          batch = decodeAnalyticsBatch(raw, at);
        } catch {
          demand(false);
        }
        const admitted = await d.admission.admit('analytics', { ip: signals.ip });
        if (!admitted.ok) return admitted;
        if (!admitted.value.allowed)
          return ok({
            status: 'limited' as const,
            retryAfterSeconds: admitted.value.retryAfterSeconds,
          });
        const context = {
          subjectId: c.subjectId,
          permission: c.permission,
          scope: c.scope,
          policy: c.policy,
        };
        const result = await work((tx) =>
          d.events.receive(
            tx,
            context,
            batch!.map((e) => ({
              ...e,
              sessionId: c.sessionId,
              market: c.market,
              locale: c.locale,
              channel: c.channel,
              bot: signals.bot,
            })),
          ),
        );
        if (!result.ok && result.error.code === 'forbidden')
          return ok({ status: 'refused' as const });
        return result.ok
          ? ok({ status: 'accepted' as const, inserted: result.value.inserted })
          : result;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async rebuildOne() {
      const build = await serviceWork(d.rebuildUow, async (tx) =>
        ok(await d.rebuild.capture(tx, 60)),
      );
      if (!build.ok || !build.value) return build;
      const candidate = build.value;
      const published = await serviceWork(d.rebuildUow, async (tx) => {
        await d.rebuild.publish(tx, candidate);
        return ok({ day: candidate.day, generation: candidate.generation.toString() });
      });
      if (!published.ok)
        await serviceWork(d.rebuildUow, async (tx) => {
          await d.rebuild.retry(tx, candidate);
          return ok(null);
        });
      return published;
    },
    maintenance(limit = 250) {
      return serviceWork(d.rebuildUow, async (tx) => {
        demand(Number.isInteger(limit) && limit >= 1 && limit <= 1000);
        return ok({
          withdrawn: await d.maintenance.purgeWithdrawn(tx, limit),
          expired: await d.rebuild.cleanup(tx, limit),
          invalidatedDays: await d.maintenance.expireGenerations(tx, 25),
        });
      });
    },
  };
}
export function createOperationsServices(d: {
  readonly uow: UnitOfWork;
  readonly operations: OperationsRepository;
  readonly health: HealthRepository;
}) {
  return {
    dashboard(actor: Id<'staff'>, day: string, dimension: 'all' | 'web' | 'app' | 'mcp' = 'all') {
      return serviceWork(d.uow, async (tx) => {
        const staff = await d.operations.staff(tx, actor);
        demand(staff?.active && staff.roles.includes('operations_read'), 'forbidden');
        const health = await d.health.snapshot(tx),
          events = await d.operations.metric(tx, day, 'events', 'US', dimension),
          sessions = await d.operations.metric(tx, day, 'sessions', 'US', dimension);
        const current = await d.operations.staff(tx, actor);
        demand(current?.active && current.roles.includes('operations_read'), 'forbidden');
        const dto = (m: typeof events) =>
          m
            ? {
                value: m.value.toString(),
                generation: m.generation.toString(),
                pending: m.pending,
                computedAt: m.computedAt,
              }
            : null;
        return ok({
          day,
          dimension,
          market: 'US',
          events: dto(events),
          dailyDistinctSessions: dto(sessions),
          coverage: 'consented traffic only' as const,
          currency: null,
          health,
        });
      });
    },
  };
}
