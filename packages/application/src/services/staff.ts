import { ok, fail, id, type Id } from '../../../domain/src/values/core.ts';
import type {
  StaffRepository,
  StaffQueue,
  StaffPermission,
  RecoveryKind,
  CommercialIdentity,
  StaffRecovery,
} from '../ports/commercial.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import { demand, serviceWork, serviceFailure } from './service-work.ts';
const permissions: Record<StaffQueue, StaffPermission> = {
  mail: 'mail.recover',
  callbacks: 'mail.recover',
  imports: 'data.review',
  privacy: 'privacy.review',
  seo: 'seo.publish',
};
const recoveries: Record<RecoveryKind, StaffPermission> = {
  mail_reconcile: 'mail.recover',
  callback_replay: 'mail.recover',
  privacy_retry: 'privacy.review',
};
export function createStaffServices(d: {
  readonly uow: UnitOfWork;
  readonly repo: StaffRepository;
  readonly identity: CommercialIdentity;
  readonly recovery: StaffRecovery;
}) {
  const run = <T>(fn: (tx: Tx) => Promise<T>) => serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  return {
    queue(actor: Id<'staff'>, kind: StaffQueue, after: string | null = null, limit = 25) {
      return run(async (tx) => {
        demand(
          Object.hasOwn(permissions, kind) &&
            id('staff', actor).ok &&
            Number.isInteger(limit) &&
            limit >= 1 &&
            limit <= 100 &&
            (after === null || id('cursor', after).ok),
        );
        await d.repo.authorize(tx, actor, permissions[kind]);
        const rows = await d.repo.queue(tx, kind, after, limit);
        return { items: rows, next: rows.length === limit ? rows.at(-1)!.id : null };
      });
    },
    async recover(
      actor: Id<'staff'>,
      commandId: string,
      kind: RecoveryKind,
      target: string,
      evidence: string,
    ) {
      try {
        demand(
          id('staff', actor).ok &&
            id('command', commandId).ok &&
            id('target', target).ok &&
            Object.hasOwn(recoveries, kind) &&
            /^[a-f0-9]{64}$/.test(evidence),
        );
        const command = {
          id: commandId,
          actor,
          kind,
          digest: d.identity.checksum({ kind, target, evidence }),
        };
        const claimed = await run(async (tx) => {
          await d.repo.authorize(tx, actor, recoveries[kind]);
          return d.repo.claim(tx, command);
        });
        if (!claimed.ok || !claimed.value.created) return claimed;
        // Durable approval precedes external I/O. The same command never runs twice, including after a crash.
        const authorized = await run((tx) => d.repo.authorize(tx, actor, recoveries[kind]));
        let state: 'succeeded' | 'failed' | 'unknown' = 'failed';
        if (authorized.ok) {
          try {
            const result = await d.recovery.execute(kind, actor, target, evidence);
            state = result.ok
              ? 'succeeded'
              : result.error.code === 'commit_unknown'
                ? 'unknown'
                : 'failed';
          } catch {
            state = 'unknown';
          }
        }
        const saved = await run((tx) => d.repo.finish(tx, command, state));
        return saved.ok ? ok({ created: true, state }) : saved;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  };
}
