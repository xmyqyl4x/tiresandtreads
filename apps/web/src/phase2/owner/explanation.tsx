import type { analysisAttachmentView } from '../../../../../packages/contracts/src/phase2-analysis.ts';
import type { OwnerReportView } from '../../../../../packages/contracts/src/report-views.ts';
import { reason } from '../../../../../packages/contracts/src/report-display.ts';
type Attachment = Extract<
  ReturnType<typeof analysisAttachmentView.parse>,
  { state: 'available' }
>['attachment'];
const questions: Record<string, string> = {
  verify_fitment: 'Ask your installer to verify vehicle, wheel and tire fitment.',
  measure_tread: 'Have tread measured and all tires physically inspected.',
  verify_dot: 'Verify the full DOT identification and date markings.',
  confirm_total: 'Confirm the complete installed total and included services.',
};
const limitationCopy: Record<string, string> = {
  deterministic_authority: 'Recorded report facts remain authoritative.',
  physical_inspection_required: 'A qualified physical inspection is required.',
  no_recall_clearance: 'This explanation does not establish recall clearance.',
  source_limits: 'Source coverage and freshness limit this explanation.',
};
export function AssistanceExplanation({
  attachment,
  selection,
  report,
}: {
  attachment: Attachment;
  selection: { revision: string; attachedAt: string } | null;
  report: OwnerReportView;
}) {
  const output = attachment.output;
  return (
    <article className="staff-card" aria-label="Separate assistance explanation">
      <h3>
        {output.kind === 'reviewed_generic_explanation'
          ? 'Reviewed general explanation'
          : 'AI-assisted explanation'}
      </h3>
      <p>
        This is separate from your recorded ranking, prices, fitment and recall facts. It does not
        establish safety.
      </p>
      <dl className="p2-facts">
        <dt>Frozen attachment revision</dt>
        <dd>{attachment.revision}</dd>
        <dt>Generated</dt>
        <dd>
          <time dateTime={attachment.generatedAt}>{attachment.generatedAt}</time>
        </dd>
        <dt>Valid until</dt>
        <dd>
          <time dateTime={attachment.validUntil}>{attachment.validUntil}</time>
        </dd>
        {selection && selection.revision === attachment.revision ? (
          <>
            <dt>Attached or reused for this report</dt>
            <dd>
              <time dateTime={selection.attachedAt}>{selection.attachedAt}</time>
            </dd>
          </>
        ) : null}
        <dt>Report source snapshot</dt>
        <dd>{report.output.result.asOf}</dd>
      </dl>
      {output.kind === 'ai_assisted_selection' ? (
        <>
          <p>{output.summary}</p>
          {output.claims.map((c) => (
            <section key={c.rank}>
              <h4>Recorded option {c.rank}</h4>
              <p>
                Recorded reasons: {c.reasonCodes.map(reason).join(' ') || 'No additional reasons'}.
                Refer to the deterministic report for the actual status, score and price.
              </p>
              <p>
                Citations:{' '}
                {c.citations.map((citation, i) => (
                  <code key={i}>{citation} </code>
                ))}
              </p>
            </section>
          ))}
        </>
      ) : (
        output.claims.map((c) => (
          <section key={c.adviceId}>
            <p>{c.text}</p>
            <p>
              Reviewed advice <code>{c.adviceId}</code> · source <code>{c.sourceId}</code>
            </p>
          </section>
        ))
      )}
      <ul>
        {output.questions.map((q) => (
          <li key={q}>{questions[q] ?? 'Verify the recorded facts with a qualified installer.'}</li>
        ))}
      </ul>
      <p>
        Limitations:{' '}
        {output.limitations
          .map((k) => limitationCopy[k] ?? 'Current source verification is required.')
          .join(' ') || 'Current source verification and physical inspection required.'}
      </p>
      {report.output.sources?.map((s) => (
        <p key={s.datasetId}>
          Source <code>{s.datasetId}</code> · fetched {s.fetchedAt} · valid until {s.validUntil}
        </p>
      ))}
    </article>
  );
}
