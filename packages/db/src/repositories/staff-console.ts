import type {
  ReportTriage,
  SourceHealthRow,
} from '../../../application/src/ports/staff-console.ts';
import type { PageRequest } from '../../../application/src/ports/pagination.ts';
import type { TransactionContext } from '../../../application/src/ports/transactions.ts';
import { id } from '../../../domain/src/values/core.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { cursor, nextCursor, pageLimit } from './bounds.ts';
import { rid, stamp, text } from './private-values.ts';
export function createReportTriageRepository(scope: WriteScope) {
  return guarded(scope, {
    async page(tx: TransactionContext, page: PageRequest) {
      const size = pageLimit(page.limit),
        after = cursor('staff-report-triage', page.after);
      const rows = (
        await scope.query(
          tx,
          'SELECT id,status,updated_at FROM app.reports WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
          [after, size + 1],
        )
      ).rows;
      const items: ReportTriage[] = rows.slice(0, size).map((row) => {
        const state = text(row.status);
        if (!['draft', 'active', 'pending_deletion'].includes(state)) return stop('integrity');
        return {
          id: rid('report', row.id),
          state: state === 'draft' ? 'draft' : state === 'active' ? 'active' : 'pending_deletion',
          updatedAt: stamp(row.updated_at),
        };
      });
      return {
        items,
        next: rows.length > size ? nextCursor('staff-report-triage', items.at(-1)!.id) : null,
      };
    },
  });
}
export function createSeoFindingsRepository(scope: WriteScope) {
  return guarded(scope, {
    async page(tx: TransactionContext, page: PageRequest) {
      const size = pageLimit(page.limit),
        after = cursor('staff-seo-findings', page.after);
      const rows = (
        await scope.query(
          tx,
          'SELECT id,page_id,rule_code,severity,status,created_at FROM admin.seo_findings WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
          [after, size + 1],
        )
      ).rows;
      const items = rows.slice(0, size).map((r) => ({
        id: rid('seo_finding', r.id),
        pageId: rid('seo_page', r.page_id),
        rule: text(r.rule_code, 100),
        severity: text(r.severity, 10),
        state: text(r.status, 10),
        detectedAt: stamp(r.created_at),
      }));
      return {
        items,
        next: rows.length > size ? nextCursor('staff-seo-findings', items.at(-1)!.id) : null,
      };
    },
  });
}
export function createSourceHealthRepository(scope: WriteScope) {
  return guarded(scope, {
    async page(tx: TransactionContext, page: PageRequest) {
      const size = pageLimit(page.limit);
      if (page.after !== null && !id('source_connector', page.after).ok)
        return stop('invalid_input');
      // Fixed metadata projection: no origin/path, configuration JSON, provider response or contact joins.
      const rows = (
        await scope.query(
          tx,
          `SELECT c.id,c.kind,c.status,h.error_code IS NOT NULL AS has_error,
    h.last_attempt_at,h.last_success_at,h.next_check_at,r.status AS run_state
    FROM app.source_connectors c LEFT JOIN app.feed_health h ON h.provider_id=c.provider_id AND h.kind=c.kind
    LEFT JOIN app.import_runs r ON r.id=h.last_run_id AND r.provider_id=c.provider_id
    WHERE ($1::uuid IS NULL OR c.id>$1) ORDER BY c.id LIMIT $2`,
          [page.after, size + 1],
        )
      ).rows;
      const time = (value: unknown) => (value === null ? null : stamp(value));
      const items: SourceHealthRow[] = rows.slice(0, size).map((row) => ({
        key: text(row.id),
        kind: text(row.kind),
        enabled: row.status === 'active',
        hasError: row.has_error === true,
        lastRunState: row.run_state === null ? null : text(row.run_state),
        lastAttemptAt: time(row.last_attempt_at),
        lastSucceededAt: time(row.last_success_at),
        nextDueAt: time(row.next_check_at),
      }));
      return { items, next: rows.length > size ? items.at(-1)!.key : null };
    },
  });
}
