import type { ReportOutputView, SafetyView } from '@tt/contracts/report-views';
import { confidence, range, reason, when } from '../results/presentation.ts';
export function ReportBody({
  output,
  safety,
  version,
}: {
  output: ReportOutputView;
  safety: SafetyView;
  version: number;
}) {
  const result = output.result;
  const excluded = result.decisions.filter((d) => !result.picks.includes(d.id));
  return (
    <div className="report-body">
      <section className="callout warning" aria-label="Current safety review">
        <h2>Current safety review</h2>
        <p>
          {safety.status === 'current' && !safety.unresolved
            ? 'The current check completed within its stated scope.'
            : 'The current safety information is unavailable or needs review.'}
        </p>
        <p>
          Checked {when(safety.checkedAt)}. Stored rankings and prices are historical. This
          technical preview does not issue tire advice or a safety clearance.
        </p>
        {safety.matched.length ? (
          <p>Recall references requiring review: {safety.matched.join(', ')}</p>
        ) : null}
      </section>
      <div className="section-heading">
        <h2>Stored results · version {version}</h2>
        <p>
          Assessment as of {when(result.asOf)}. Preference scores describe the recorded comparison
          evidence, not safety.
        </p>
      </div>
      {!result.picks.length ? (
        <section className="callout warning">
          <h3>No supported picks in this report</h3>
          <p>
            The service did not return eligible picks. Missing or blocked information has not been
            promoted into a recommendation.
          </p>
        </section>
      ) : (
        <div className="result-grid">
          {result.picks.map((id, index) => {
            const option = output.options.find((p) => p.id === id),
              decision = result.decisions.find((d) => d.id === id),
              price = output.prices.find((p) => p.planId === id),
              product = output.products.find(
                (p) => p.id === option?.front.id || p.modelId === option?.front.modelId,
              );
            return (
              <article className="card result-card" key={id}>
                <p className="eyebrow">OPTION {index + 1}</p>
                <h3>
                  {product?.brand || product?.model
                    ? [product.brand, product.model].filter(Boolean).join(' ')
                    : 'Stored option ' + (index + 1)}
                </h3>
                <p>
                  Front: {option?.front.sizeCode ?? 'Unavailable'} · Rear:{' '}
                  {option?.rear.sizeCode ?? 'Unavailable'}
                </p>
                <dl>
                  <dt>Preference score</dt>
                  <dd>
                    {decision?.scoreBp === null || decision?.scoreBp === undefined
                      ? 'Unavailable'
                      : (decision.scoreBp / 100).toFixed(1) + ' / 100'}
                  </dd>
                  <dt>Evidence confidence</dt>
                  <dd>{confidence(decision?.confidence)}</dd>
                  <dt>Evidence comparison</dt>
                  <dd>
                    {decision?.suitability === 'comparable'
                      ? 'Comparable'
                      : decision?.suitability === 'evidence_limited'
                        ? 'Evidence limited'
                        : 'Unavailable'}
                  </dd>
                  <dt>Budget basis</dt>
                  <dd>
                    {decision?.budget === 'within'
                      ? 'Within stated budget'
                      : decision?.budget === 'above'
                        ? 'Above stated budget'
                        : decision?.budget === 'not_requested'
                          ? 'Not requested'
                          : 'Unverified'}
                  </dd>
                  <dt>Installed estimate · {price?.quantity ?? 'unknown quantity'} tires</dt>
                  <dd>{range(price?.installed)}</dd>
                  <dt>Tires-only estimate</dt>
                  <dd>{range(price?.merchandise)}</dd>
                </dl>
                {price ? (
                  <p className="hint">
                    {price.freshness} stored price, observed {when(price.observedAt)}.{' '}
                    {price.validUntil
                      ? 'Recorded validity ends ' + when(price.validUntil) + '.'
                      : 'Validity unavailable.'}{' '}
                    No current-price claim.
                  </p>
                ) : (
                  <p className="hint">
                    Price and included fees are unavailable; no total is invented.
                  </p>
                )}
                <ul>
                  {decision?.reasons.map((code) => (
                    <li key={code}>{reason(code)}</li>
                  ))}
                </ul>
                <p className="hint">
                  Option reference: <code>{id}</code>
                </p>
              </article>
            );
          })}
        </div>
      )}
      <section className="report-section">
        <h2>Exclusions and missing evidence</h2>
        {excluded.length ? (
          <ul>
            {excluded.slice(0, 20).map((d) => (
              <li key={d.id}>
                <strong>{d.status === 'blocked' ? 'Blocked' : 'Unverified'} option</strong>:{' '}
                {d.reasons.map(reason).join(' ')} <code>{d.id}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No additional option decisions were returned. This does not establish complete market
            coverage.
          </p>
        )}
      </section>
      {excluded.length > 20 ? (
        <p>{excluded.length - 20} additional option decisions are omitted from this summary.</p>
      ) : null}
      <section className="report-section">
        <h2>Maintenance and questions</h2>
        <p>
          Maintenance was not assessed: no physical tire-condition inspection is included in this
          report.
        </p>
        <p>Questions to resolve from the recorded evidence:</p>
        {output.followUp?.questions.length ? (
          <ul>
            {output.followUp.questions.map((code) => (
              <li key={code}>Ask about: {reason(code)}</li>
            ))}
          </ul>
        ) : (
          <p>
            Follow-up questions are unavailable. Review any missing vehicle, source, cost or safety
            information with a qualified professional.
          </p>
        )}
      </section>
      <details className="report-section">
        <summary>Sources and calculation versions</summary>
        <dl>
          <dt>Bundle reference</dt>
          <dd>
            <code>{result.versions.bundleId}</code>
          </dd>
          <dt>Engine / schema</dt>
          <dd>
            {result.versions.engine} / {result.versions.schema}
          </dd>
          <dt>Policy / scoring</dt>
          <dd>
            {result.versions.policy} / {result.versions.scoring}
          </dd>
        </dl>
        {output.sources?.length ? (
          <ul>
            {output.sources.map((s) => (
              <li key={s.datasetId}>
                {s.kind}: <code>{s.datasetId}</code>; fetched {when(s.fetchedAt)}, recorded validity
                ends {when(s.validUntil)}.
              </li>
            ))}
          </ul>
        ) : (
          <p>Detailed source metadata is unavailable.</p>
        )}
        <p className="hint">
          Dataset references: {result.versions.datasets.join(', ') || 'Unavailable'}. Recorded
          validity is not a new approval or recall clearance.
        </p>
      </details>
    </div>
  );
}
