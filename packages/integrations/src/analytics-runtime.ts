import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  CollectionCrypto,
  QuotaCrypto,
} from '../../application/src/ports/analytics-services.ts';
import type { Id } from '../../domain/src/values/core.ts';
import { ok } from '../../domain/src/values/core.ts';
import { createAnalyticsRepository } from '../../db/src/repositories/analytics.ts';
import {
  createAnalyticsAuthority,
  createAnalyticsMaintenance,
  createHealthRepository,
} from '../../db/src/repositories/analytics-maintenance.ts';
import { createOperationsRepository } from '../../db/src/repositories/operations.ts';
import { createLimiterRepository } from '../../db/src/repositories/limiter.ts';
import {
  createAnalyticsServices,
  createAdmissionServices,
  createOperationsServices,
} from '../../application/src/services/analytics.ts';
type Scope = ReturnType<typeof createTransactions>;
export async function createAnalyticsRuntime(o: {
  readonly scopes: Readonly<{
    report: Scope;
    collector: Scope;
    aggregate: Scope;
    limiter: Scope;
    operations: Scope;
  }>;
  readonly crypto: CollectionCrypto;
  readonly quotaCrypto: QuotaCrypto;
  readonly enabled: boolean;
  readonly policy: string;
  readonly noticeId: Id<'notice'>;
  readonly now: () => string;
}) {
  for (const [name, role] of [
    ['report', 'tt_private_runtime'],
    ['collector', 'tt_analytics_runtime'],
    ['aggregate', 'tt_analytics_runtime'],
    ['limiter', 'tt_limiter_runtime'],
    ['operations', 'tt_operations_runtime'],
  ] as const) {
    const s = o.scopes[name],
      r = await s.unitOfWork.run(async (tx) =>
        ok((await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
      );
    if (!r.ok || r.value !== role) throw Error('Invalid analytics runtime role');
  }
  const coverage = await o.scopes.limiter.unitOfWork.run(async (tx) =>
    ok(
      (
        await o.scopes.limiter.query(
          tx,
          'SELECT 1 FROM app.rate_limit_buckets WHERE expires_at>clock_timestamp() AND NOT(key_version=ANY($1::text[])) LIMIT 1',
          [o.quotaCrypto.versions],
        )
      ).rows.length === 0,
    ),
  );
  if (!coverage.ok || !coverage.value) throw Error('Invalid quota rotation coverage');
  const s = o.scopes,
    admission = createAdmissionServices({
      uow: s.limiter.unitOfWork,
      limiter: createLimiterRepository(s.limiter, o.quotaCrypto.versions),
      crypto: o.quotaCrypto,
    });
  return {
    admission,
    analytics: createAnalyticsServices({
      authorityUow: s.report.unitOfWork,
      analyticsUow: s.collector.unitOfWork,
      rebuildUow: s.aggregate.unitOfWork,
      authority: createAnalyticsAuthority(s.report),
      events: createAnalyticsRepository(s.collector),
      rebuild: createAnalyticsRepository(s.aggregate),
      maintenance: createAnalyticsMaintenance(s.aggregate),
      admission,
      crypto: o.crypto,
      enabled: o.enabled,
      policy: o.policy,
      noticeId: o.noticeId,
      now: o.now,
    }),
    operations: createOperationsServices({
      uow: s.operations.unitOfWork,
      operations: createOperationsRepository(s.operations),
      health: createHealthRepository(s.operations),
    }),
  };
}
