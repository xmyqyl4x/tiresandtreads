import type { z } from '../../../../../packages/contracts/src/phase2-wire.ts';
import { Fragment } from 'react';
import type { operationsDashboard } from '../../../../../packages/contracts/src/phase2-operations-client.ts';
function Facts({ values }: { values: readonly (readonly [string, string | number | boolean])[] }) {
  return (
    <dl className="p2-facts">
      {values.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{String(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
type Dashboard = z.output<typeof operationsDashboard>;
export function MetricCounts({ title, values }: { title: string; values: Record<string, number> }) {
  return (
    <section>
      <h4>{title}</h4>
      {Object.keys(values).length ? (
        <Facts values={Object.entries(values)} />
      ) : (
        <p>No records in this bounded sample.</p>
      )}
    </section>
  );
}
export function OperationsMetrics({ value }: { value: Dashboard }) {
  const a = value.data.ai,
    p = value.data.photo;
  return (
    <div className="p2-grid">
      <section className="staff-card">
        <h3>Recorded AI work and costs</h3>
        {a ? (
          <>
            <p>
              UTC window {value.from} to {value.until}. Each lane samples at most {a.sampleLimit}{' '}
              records. Requests and attempts use this window; reuse entries and guards are current
              stored gauges. Pre-admission refusals are not included.
            </p>
            <Facts
              values={[
                ['Requests sampled', a.requestsSampled],
                ['Request sample truncated', a.requestsTruncated],
                ['Attempts sampled', a.attemptsSampled],
                ['Attempt sample truncated', a.attemptsTruncated],
                ['Reconciled USD cost (minor units)', a.usdReconciledMinor],
                ['Estimated USD cost (minor units)', a.usdEstimatedMinor],
                ['Attempts with unknown cost', a.unknownCostAttempts],
                ['Attempts in other currencies (not converted)', a.otherCurrencyAttempts],
                ['Stored reuse entries sampled', a.reuseSampled],
                ['Reuse sample truncated', a.reuseTruncated],
                ['Stored ready entries past validity', a.expiredStoredReady],
                ['Guards sampled', a.guardsSampled],
                ['Guard sample truncated', a.guardsTruncated],
                ['Guards with a recorded invalidation', a.invalidatedGuards],
              ]}
            />
            <p>
              Stored ready entries are not a cache-hit rate or proof of current readability.
              Estimated and unknown charges are not treated as zero or reconciled spend.
            </p>
            <MetricCounts title="Persisted request states" values={a.requestStates} />
            <MetricCounts title="Attempt states" values={a.attemptStates} />
            <MetricCounts title="Recorded attempt error codes" values={a.rejectionCodes} />
            <MetricCounts title="Stored reuse states" values={a.reuseStates} />
            <MetricCounts title="Current guard states" values={a.guardStates} />
          </>
        ) : (
          <p>AI observation permission is unavailable.</p>
        )}
      </section>
      <section className="staff-card">
        <h3>Photo correction and erasure health</h3>
        {p ? (
          <>
            <Facts
              values={[
                ['Stored confirmation records in UTC window', p.confirmationsSampled],
                ['Confirmation sample truncated', p.confirmationsTruncated],
                ['Outstanding erasure jobs sampled', p.purgesSampled],
                ['Erasure sample truncated', p.purgesTruncated],
                ['Oldest sampled outstanding update', p.oldestPendingUpdatedAt ?? 'none'],
              ]}
            />
            <p>
              Confirmation records describe user choices, not model accuracy. Erasure health covers
              AI/photo rights work, including blocked jobs; it does not prove physical deletion or
              off-host custody.
            </p>
            <MetricCounts title="Recorded confirmation origins" values={p.confirmationOrigins} />
            <MetricCounts title="Outstanding erasure phases" values={p.purgePhases} />
          </>
        ) : (
          <p>Photo observation permission is unavailable.</p>
        )}
      </section>
    </div>
  );
}
