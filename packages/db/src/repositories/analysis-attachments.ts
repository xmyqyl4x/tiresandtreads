import type { AIAttachmentRepository } from '../../../application/src/ports/analysis-repositories.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { analysisProjectionFromRow } from './analysis-mappers.ts';
import {
  uid,
  num,
  big,
  choice,
  revisionValue,
  at,
  stored,
  requestStates,
} from './analysis-values.ts';
import { reject } from './bounds.ts';
export function createAIAttachmentRepository(s: WriteScope): AIAttachmentRepository {
  return guarded<AIAttachmentRepository>(s, {
    async append(tx, input) {
      const i = {
        report: uid('report', input.reportId),
        version: num(input.version, 1),
        expected: big(input.expectedRevision),
        artifact: uid('ai_artifact', input.artifactId),
        scope: uid('ai_scope', input.scopeId),
        owner: uid('subject', input.ownerId),
        kind: choice(input.kind, ['owner', 'shared']),
        authorization: uid('ai_scope', input.authorizationScopeId),
        permission: big(input.permissionRevision, 1n).toString(),
        subject: big(input.subjectRevision, 1n).toString(),
      };
      // Declare both scopes before taking either guard; shared artifact reuse cannot replace owner authority.
      await s.query(tx, 'SELECT app.ai_repository_attachment_root($1,$2,$3)', [
        i.owner,
        i.authorization,
        i.scope,
      ]);
      await s.query(tx, 'SELECT app.ai_repository_report($1,$2)', [i.owner, i.report]);
      const old = (
        await s.query(
          tx,
          'SELECT coalesce(max(revision),0)::text AS revision FROM app.report_analysis_attachments WHERE report_id=$1 AND report_version=$2',
          [i.report, i.version],
        )
      ).rows[0]!;
      if (big(old.revision) !== i.expected) return stop('conflict');
      const next = i.expected + 1n;
      await s.query(
        tx,
        'INSERT INTO app.report_analysis_attachments(report_id,report_version,revision,artifact_id,scope_id,owner_subject_id,selection_kind,authorization_scope_id,authorization_permission_revision,authorization_subject_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          i.report,
          i.version,
          next.toString(),
          i.artifact,
          i.scope,
          i.owner,
          i.kind,
          i.authorization,
          i.permission,
          i.subject,
        ],
      );
      return revisionValue(next);
    },
    async freeze(tx, input) {
      const i = {
        send: uid('send', input.sendId),
        owner: uid('subject', input.ownerId),
        report: uid('report', input.reportId),
        version: num(input.version, 1),
        revision:
          input.attachmentRevision === null ? null : big(input.attachmentRevision, 1n).toString(),
        reason:
          input.fallback === null
            ? null
            : choice(input.fallback, ['not_requested', 'unavailable', 'declined', 'expired']),
      };
      if ((i.revision === null) === (i.reason === null)) return reject();
      await s.query(tx, 'SELECT app.ai_repository_send($1,$2,$3,$4,$5)', [
        i.owner,
        i.send,
        i.report,
        i.version,
        i.revision,
      ]);
      const old = (
        await s.query(tx, 'SELECT * FROM email.analysis_selections WHERE send_id=$1', [i.send])
      ).rows[0];
      if (old) {
        if (
          old.owner_subject_id !== i.owner ||
          old.report_id !== i.report ||
          old.report_version !== i.version ||
          old.attachment_revision !== i.revision ||
          old.fallback_reason !== i.reason
        )
          return stop('conflict');
        return;
      }
      await s.query(
        tx,
        'INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,attachment_revision,fallback_reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          i.send,
          i.owner,
          i.report,
          i.version,
          i.revision === null ? 'none' : 'artifact',
          i.revision,
          i.reason,
        ],
      );
    },
    async report(tx, ownerId, reportId, version) {
      await s.query(tx, "SELECT set_config('tt.p2_ai_subject',$1,true)", [uid('subject', ownerId)]);
      const r = (
        await s.query(
          tx,
          'SELECT * FROM app.ai_report_analysis WHERE report_id=$1 AND report_version=$2 ORDER BY revision DESC LIMIT 1',
          [uid('report', reportId), num(version, 1)],
        )
      ).rows[0];
      return r ? stored(analysisProjectionFromRow(r)) : null;
    },
    async status(tx, ownerId, requestId) {
      await s.query(tx, "SELECT set_config('tt.p2_ai_subject',$1,true)", [uid('subject', ownerId)]);
      const r = (
        await s.query(
          tx,
          'SELECT id,state,created_at,expires_at FROM app.ai_analysis_requests WHERE id=$1',
          [uid('ai_request', requestId)],
        )
      ).rows[0];
      return r
        ? Object.freeze({
            id: uid('ai_request', r.id),
            state: choice(r.state, requestStates),
            createdAt: at(r.created_at),
            expiresAt: at(r.expires_at),
          })
        : null;
    },
  });
}
