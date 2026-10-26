import { ok, type Id } from '../../../domain/src/values/core.ts';
import type { ServiceHealthRepository } from '../ports/service-maintenance.ts';
import type { OperationsRepository } from '../ports/operations.ts';
import type { UnitOfWork } from '../ports/transactions.ts';
import { demand, serviceWork } from './service-work.ts';
export function createServiceHealth(d: {
  readonly uow: UnitOfWork;
  readonly health: ServiceHealthRepository;
  readonly operations: OperationsRepository;
}) {
  return {
    review(
      actor: Id<'staff'>,
      limits: Readonly<{ backlog: number; lagSeconds: number; capacityBasisPoints: number }>,
    ) {
      return serviceWork(d.uow, async (tx) => {
        demand(
          Number.isInteger(limits.backlog) &&
            limits.backlog >= 1 &&
            limits.backlog <= 1000 &&
            Number.isInteger(limits.lagSeconds) &&
            limits.lagSeconds >= 1 &&
            limits.lagSeconds <= 86400 &&
            Number.isInteger(limits.capacityBasisPoints) &&
            limits.capacityBasisPoints >= 1 &&
            limits.capacityBasisPoints <= 10000,
        );
        const staff = await d.operations.staff(tx, actor);
        demand(staff?.active && staff.roles.includes('operations_read'), 'forbidden');
        const rows = await d.health.snapshot(tx);
        const current = await d.operations.staff(tx, actor);
        demand(current?.active && current.roles.includes('operations_read'), 'forbidden');
        return ok(
          rows.map((r) => {
            const ageSeconds =
              r.oldestAt === null
                ? null
                : Math.max(
                    0,
                    Math.floor((Date.parse(r.sampledAt) - Date.parse(r.oldestAt)) / 1000),
                  );
            const capacityBasisPoints =
              r.capacity === null ? null : Math.floor((r.queued * 10000) / r.capacity);
            return {
              ...r,
              capped: r.capacity === null && r.queued === 1001,
              ageSeconds,
              alerts: [
                ...(r.capacity === null && r.queued >= limits.backlog ? ['backlog' as const] : []),
                ...(ageSeconds !== null && ageSeconds >= limits.lagSeconds ? ['lag' as const] : []),
                ...(capacityBasisPoints !== null &&
                capacityBasisPoints >= limits.capacityBasisPoints
                  ? ['capacity' as const]
                  : []),
                ...(['privacy_overdue', 'recovery_unknown', 'uncertain_mail'].includes(r.code) &&
                r.queued > 0
                  ? ['review_required' as const]
                  : []),
              ],
              capacityBasisPoints,
            };
          }),
        );
      });
    },
  };
}
