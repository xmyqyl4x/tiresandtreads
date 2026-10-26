import { createHash } from 'node:crypto';
import { ok, type Id, type Result } from '../../domain/src/values/core.ts';
import type { ApplicationFailure } from '../../application/src/ports/transactions.ts';
import type { AffiliateChecker } from '../../application/src/ports/commercial.ts';
import type { createTransactions } from '../../db/src/transactions.ts';
import { createStaffRepository } from '../../db/src/repositories/staff-services.ts';
import { createCommercialRepository } from '../../db/src/repositories/commercial-services.ts';
import { createStaffServices } from '../../application/src/services/staff.ts';
import { createCommercialServices } from '../../application/src/services/commercial.ts';
import { canonical } from '../../application/src/services/service-records.ts';
import { boundedIO } from './bounded-io.ts';
type Scope = ReturnType<typeof createTransactions>;
type Outcome = Promise<Result<unknown, ApplicationFailure>>;
export async function createCommercialRuntime(o: {
  readonly scopes: Readonly<{ staff: Scope; commercial: Scope; public: Scope }>;
  readonly mail: Readonly<{ reconcile(target: string): Outcome; replay(target: string): Outcome }>;
  readonly privacy: Readonly<{
    retry(actor: Id<'staff'>, target: Id<'privacy_request'>, evidence: string): Outcome;
  }>;
  readonly checker?: AffiliateChecker;
  readonly externalActivationApproved?: boolean;
  readonly now: () => string;
}) {
  for (const [name, role] of [
    ['staff', 'tt_staff_service_runtime'],
    ['commercial', 'tt_commercial_runtime'],
    ['public', 'tt_public_runtime'],
  ] as const) {
    const s = o.scopes[name],
      r = await s.unitOfWork.run(async (tx) =>
        ok((await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
      );
    if (!r.ok || r.value !== role) throw Error('Invalid commercial runtime role');
  }
  if (
    o.externalActivationApproved !== undefined &&
    typeof o.externalActivationApproved !== 'boolean'
  )
    throw Error('Invalid commercial activation');
  const identity = {
    checksum: (value: unknown) =>
      createHash('sha256').update(canonical(value, 1048576)).digest('hex'),
  };
  return {
    staff: createStaffServices({
      uow: o.scopes.staff.unitOfWork,
      repo: createStaffRepository(o.scopes.staff),
      identity,
      recovery: {
        execute: (kind, actor, target, evidence) =>
          boundedIO(
            () =>
              kind === 'mail_reconcile'
                ? o.mail.reconcile(target)
                : kind === 'callback_replay'
                  ? o.mail.replay(target)
                  : o.privacy.retry(actor, target as Id<'privacy_request'>, evidence),
            10000,
          ),
      },
    }),
    commercial: createCommercialServices({
      writeUow: o.scopes.commercial.unitOfWork,
      publicUow: o.scopes.public.unitOfWork,
      write: createCommercialRepository(o.scopes.commercial),
      read: createCommercialRepository(o.scopes.public),
      identity,
      checker: {
        check: (destination) =>
          boundedIO(
            (signal) =>
              o.checker ? o.checker.check(destination, signal) : Promise.resolve('unavailable'),
            5000,
          ),
      },
      externalActivationApproved: o.externalActivationApproved ?? false,
      now: o.now,
    }),
  };
}
