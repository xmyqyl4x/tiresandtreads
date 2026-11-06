import type { AIBudgetRepository } from '../../../application/src/ports/analysis-repositories.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { lockAttempt } from './analysis-requests.ts';
import { aiBudgetFromRow } from './analysis-mappers.ts';
import { uid, big, choice, stored } from './analysis-values.ts';
import { reject } from './bounds.ts';
export function createAIBudgetRepository(s: WriteScope): AIBudgetRepository {
  async function holds(tx: Tx, attempt: string) {
    return (
      await s.query(
        tx,
        'SELECT * FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY budget_id',
        [attempt],
      )
    ).rows.map((r) => stored(aiBudgetFromRow(r)));
  }
  return guarded<AIBudgetRepository>(s, {
    async reserve(tx, attemptId, windows) {
      const attempt = uid('ai_attempt', attemptId);
      if (!Array.isArray(windows) || windows.length < 1 || windows.length > 3) return reject();
      const wanted = windows
        .map((w) => ({ id: uid('ai_budget', w.id), amount: big(w.amountMinor, 1n).toString() }))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (new Set(wanted.map((w) => w.id)).size !== wanted.length) return reject();
      const a = await lockAttempt(s, tx, attempt),
        existing = await holds(tx, attempt);
      if (existing.length) {
        if (
          existing.length !== wanted.length ||
          existing.some(
            (h, n) =>
              h.budgetId !== wanted[n]!.id || h.amountMinor.toString() !== wanted[n]!.amount,
          )
        )
          return stop('conflict');
        return existing;
      }
      if (a.state !== 'created') return stop('conflict');
      await s.query(tx, 'SELECT app.ai_repository_budget_locks($1::uuid[])', [
        wanted.map((w) => w.id),
      ]);
      for (const w of wanted)
        await s.query(
          tx,
          'INSERT INTO app.ai_budget_reservations(budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,$4,$5)',
          [w.id, attempt, a.policy_version_id, a.currency_code, w.amount],
        );
      return holds(tx, attempt);
    },
    async reconcile(tx, attemptId, input) {
      const attempt = uid('ai_attempt', attemptId),
        state = choice(input.state, ['uncertain', 'settled', 'released']),
        cost = input.costMinor === null ? null : big(input.costMinor).toString(),
        reason =
          input.reason === null
            ? null
            : choice(input.reason, ['not_dispatched', 'confirmed_not_charged']),
        evidence = input.evidenceId === null ? null : uid('audit_event', input.evidenceId);
      if (
        (state === 'settled') !== (cost !== null) ||
        (state === 'released') !== (reason !== null) ||
        (state === 'released' && evidence === null)
      )
        return reject();
      await lockAttempt(s, tx, attempt);
      const rows = await holds(tx, attempt);
      if (!rows.length) return stop('not_found');
      await s.query(tx, 'SELECT app.ai_repository_budget_locks($1::uuid[])', [
        rows.map((h) => h.budgetId),
      ]);
      for (const h of rows) {
        if (h.state === state) {
          if (state === 'settled' && h.settledMinor?.toString() !== cost) return stop('conflict');
          const metadata =
            (
              await s.query(
                tx,
                'SELECT release_reason,evidence_id FROM app.ai_budget_reservations WHERE id=$1',
                [h.id],
              )
            ).rows[0] ?? stop('integrity');
          if (metadata.release_reason !== reason || metadata.evidence_id !== evidence)
            return stop('conflict');
          continue;
        }
        await s.query(
          tx,
          "UPDATE app.ai_budget_reservations SET state=$2,settled_minor=$3,release_reason=$4,evidence_id=$5,reconciled_at=CASE WHEN $2 IN ('released','settled') THEN clock_timestamp() ELSE NULL END WHERE id=$1",
          [h.id, state, cost, reason, evidence],
        );
      }
      return holds(tx, attempt);
    },
  });
}
