import type { StaffRepository, StaffQueue } from '../../../application/src/ports/commercial.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { stamp, text, one } from './private-values.ts';
import { operationsAudit } from './operations-audit.ts';
const views: Record<StaffQueue, string> = {
  mail: 'admin.staff_mail_queue',
  callbacks: 'admin.staff_callback_queue',
  imports: 'admin.staff_import_queue',
  privacy: 'admin.staff_privacy_queue',
  seo: 'admin.staff_seo_queue',
};
export function createStaffRepository(s: WriteScope): StaffRepository {
  const q = s.query,
    audit = operationsAudit(s);
  return guarded(s, {
    authorize: audit.authorize,
    async queue(tx, kind, after, limit) {
      if (!Object.hasOwn(views, kind) || !Number.isInteger(limit) || limit < 1 || limit > 100)
        return stop('invalid_input');
      const rows = (
        await q(
          tx,
          `SELECT id,state,due_at FROM ${views[kind]} WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,
          [after, limit],
        )
      ).rows;
      return rows.map((r) => ({
        id: text(r.id),
        state: text(r.state),
        dueAt: r.due_at === null ? null : stamp(r.due_at),
      }));
    },
    async claim(tx, c) {
      const inserted = await q(
        tx,
        "INSERT INTO admin.recovery_commands(id,actor_id,kind,input_digest,state) VALUES($1,$2,$3,$4,'executing') ON CONFLICT DO NOTHING RETURNING id",
        [c.id, c.actor, c.kind, c.digest],
      );
      const r = one(
        (
          await q(
            tx,
            'SELECT actor_id,kind,input_digest,state FROM admin.recovery_commands WHERE id=$1',
            [c.id],
          )
        ).rows,
      );
      if (r.actor_id !== c.actor || r.kind !== c.kind || r.input_digest !== c.digest)
        return stop('conflict');
      if (inserted.rows.length)
        await audit.record(tx, c.actor, 'recovery.' + c.kind, c.digest, 'approved');
      return { created: inserted.rows.length === 1, state: text(r.state) };
    },
    async finish(tx, c, state) {
      const updated = await q(
        tx,
        "UPDATE admin.recovery_commands SET state=$2,finished_at=clock_timestamp() WHERE id=$1 AND actor_id=$3 AND input_digest=$4 AND state='executing' RETURNING id",
        [c.id, state, c.actor, c.digest],
      );
      if (!updated.rows.length) return stop('conflict');
      await audit.record(
        tx,
        c.actor,
        'recovery.' + c.kind,
        c.digest,
        state === 'succeeded' ? 'succeeded' : 'failed',
      );
    },
  } satisfies StaffRepository);
}
