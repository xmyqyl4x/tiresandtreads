import type { StaffPermission } from '../../../application/src/ports/commercial.ts';
import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { stop, type WriteScope } from './mutations.ts';
export function operationsAudit(s: WriteScope) {
  return {
    async authorize(tx: Tx, actor: Id<'staff'>, permission: StaffPermission) {
      if (
        !(
          await s.query(tx, 'SELECT admin.authorize_operations($1,$2) AS allowed', [
            actor,
            permission,
          ])
        ).rows[0]?.allowed
      )
        stop('forbidden');
    },
    async record(tx: Tx, actor: Id<'staff'>, action: string, digest: string, result = 'succeeded') {
      const event = (
        await s.query(
          tx,
          "INSERT INTO admin.audit_events(action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'operations',$2,clock_timestamp(),$3,'[]') RETURNING id",
          [action, result, digest],
        )
      ).rows[0]!;
      await s.query(
        tx,
        'INSERT INTO admin.audit_identity_links(event_id,actor_staff_id) VALUES($1,$2)',
        [event.id, actor],
      );
    },
  };
}
