import type { AnalysisPresentationRepository } from '../../../application/src/ports/analysis-presentation.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { uid, num, at, revisionValue } from './analysis-values.ts';
export function createAnalysisPresentationRepository(
  s: WriteScope,
): AnalysisPresentationRepository {
  return guarded<AnalysisPresentationRepository>(s, {
    async latest(tx, owner, report, version) {
      const r = (
        await s.query(
          tx,
          `SELECT w.request_id FROM app.ai_report_work w JOIN app.ai_analysis_requests r ON r.id=w.request_id WHERE w.owner_subject_id=$1 AND w.report_id=$2 AND w.report_version=$3 ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,
          [uid('subject', owner), uid('report', report), num(version, 1)],
        )
      ).rows[0];
      return r ? uid('ai_request', r.request_id) : null;
    },
    async selection(tx, owner, report, version) {
      const subject = uid('subject', owner);
      await s.query(tx, "SELECT set_config('tt.p2_ai_subject',$1,true)", [subject]);
      const r = (
        await s.query(
          tx,
          `SELECT v.revision,x.attached_at FROM app.ai_report_analysis v JOIN app.report_analysis_attachments x ON x.report_id=v.report_id AND x.report_version=v.report_version AND x.revision=v.revision WHERE x.owner_subject_id=$1 AND v.report_id=$2 AND v.report_version=$3 ORDER BY v.revision DESC LIMIT 1`,
          [subject, uid('report', report), num(version, 1)],
        )
      ).rows[0];
      return r
        ? Object.freeze({
            revision: revisionValue(r.revision).toString(),
            attachedAt: at(r.attached_at),
          })
        : null;
    },
  });
}
