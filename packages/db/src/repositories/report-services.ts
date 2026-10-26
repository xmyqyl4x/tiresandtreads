import type {
  ReportAccessRepository,
  ReportPolicyRepository,
  ReportRecallRepository,
} from '../../../application/src/ports/report-services.ts';
import { createCapabilityRepository } from './capabilities.ts';
import { reportVersionFromRow } from './reports.ts';
import { reportGuard, integer, obj, stamp, rid, text, envelope } from './private-values.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { createSourceRepository } from './sources.ts';
import { instant } from '../../../domain/src/values/core.ts';
export function createReportRecallRepository(scope: WriteScope): ReportRecallRepository {
  const sources = createSourceRepository(scope);
  return guarded(scope, {
    async checkedAt(tx, dataset) {
      if (!(await sources.recallReady(tx, dataset))) return null;
      const rows = (
        await scope.query(
          tx,
          "SELECT h.last_success_at FROM app.feed_health h WHERE h.source_receipt->>'datasetId'=$1 ORDER BY h.last_success_at DESC LIMIT 2",
          [dataset],
        )
      ).rows;
      return rows.length === 1 && rows[0]!.last_success_at !== null
        ? stamp(rows[0]!.last_success_at)
        : null;
    },
  });
}
export function createReportPolicyRepository(scope: WriteScope): ReportPolicyRepository {
  return guarded(scope, {
    async published(tx, region) {
      const rows = (
        await scope.query(
          tx,
          "SELECT id,version,document,reviewed_by,reviewed_at,statement_timestamp() AS checked_at FROM app.report_policies WHERE document->>'regionKey'=$1 ORDER BY id LIMIT 2",
          [region],
        )
      ).rows;
      // Multiple current policies require an explicit publication decision, never a guessed winner.
      if (rows.length !== 1) return null;
      const r = rows[0]!;
      const document = obj(r.document),
        due = instant(document.reviewDueAt);
      if (!due.ok || due.value <= stamp(r.checked_at)) return null;
      return {
        id: rid('rule', r.id),
        version: text(r.version),
        document,
        reviewedBy: rid('staff', r.reviewed_by),
        reviewedAt: stamp(r.reviewed_at),
      };
    },
  });
}
export function createReportAccessRepository(scope: WriteScope): ReportAccessRepository {
  const caps = createCapabilityRepository(scope);
  return guarded(scope, {
    async quoteNotes(tx, owner, reportId, quoteId) {
      await reportGuard(scope, tx, owner, reportId);
      const r = (
        await scope.query(
          tx,
          'SELECT p.encrypted_notes,p.key_version FROM privacy.quote_private_data p JOIN app.shop_quotes q ON q.id=p.quote_id WHERE q.report_id=$1 AND q.id=$2 AND q.expires_at>clock_timestamp() AND p.expires_at>clock_timestamp()',
          [reportId, quoteId],
        )
      ).rows[0];
      if (!r) return null;
      if (!Buffer.isBuffer(r.encrypted_notes)) return stop('integrity');
      return { hex: r.encrypted_notes.toString('hex'), keyVersion: text(r.key_version, 100) };
    },
    async shared(tx, keys) {
      const share = await caps.resolveShare(tx, keys);
      if (!share) return null;
      const row = (
        await scope.query(
          tx,
          'SELECT report_id,version,base_version,bundle_id,rule_version_id,engine_version,schema_version,input_snapshot,output_snapshot FROM app.report_versions WHERE report_id=$1 AND version=$2',
          [share.reportId, share.version],
        )
      ).rows[0];
      if (!row) return stop('integrity');
      let comparison = null;
      if (share.comparisonRevision !== null) {
        const rows = (
          await scope.query(
            tx,
            'SELECT c.scenario,i.slot,i.kind,i.source_key,i.snapshot FROM app.comparisons c JOIN app.comparison_items i ON(i.report_id,i.report_version,i.comparison_revision)=(c.report_id,c.report_version,c.revision) WHERE c.report_id=$1 AND c.report_version=$2 AND c.revision=$3 ORDER BY i.slot',
            [share.reportId, share.version, share.comparisonRevision.toString()],
          )
        ).rows;
        if (rows.length < 1 || rows.length > 4) return stop('integrity');
        comparison = {
          revision: share.comparisonRevision,
          scenario: obj(rows[0]!.scenario),
          items: rows.map((r) => {
            if (!['catalog', 'quote'].includes(String(r.kind)) || integer(r.slot) > 4)
              return stop('integrity');
            return {
              slot: integer(r.slot) as 1 | 2 | 3 | 4,
              kind: r.kind as 'catalog' | 'quote',
              sourceKey: text(r.source_key),
              snapshot: obj(r.snapshot),
            };
          }),
        };
      }
      const latest = await caps.resolveShare(tx, keys);
      if (!latest || latest.version !== share.version || latest.capabilityId !== share.capabilityId)
        return null;
      return { version: reportVersionFromRow(row), comparison };
    },
    async quotePrivate(tx, owner, id, value, expiresAt) {
      const r = (await scope.query(tx, 'SELECT report_id FROM app.shop_quotes WHERE id=$1', [id]))
        .rows[0];
      if (!r) return stop('not_found');
      await reportGuard(scope, tx, owner, String(r.report_id));
      await scope.query(
        tx,
        'INSERT INTO privacy.quote_private_data(quote_id,encrypted_notes,key_version,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(quote_id) DO UPDATE SET encrypted_notes=excluded.encrypted_notes,key_version=excluded.key_version,expires_at=excluded.expires_at,updated_at=clock_timestamp(),revision=quote_private_data.revision+1',
        [id, envelope(value), text(value.keyVersion, 100), expiresAt],
      );
    },
  });
}
