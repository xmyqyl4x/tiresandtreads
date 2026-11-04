import type {
  QueueView,
  ReportQueueView,
  SourceHealthView,
  StrategicRegisterView,
  SeoFindingsView,
  OperationsView,
  RevenueView,
  CommercialConfigurationView,
} from '../../../../packages/contracts/src/staff-console.ts';
const Missing = ({ children }: { children: React.ReactNode }) => (
  <p className="notice">{children}</p>
);
export function QueueTable({ value }: { value: QueueView | ReportQueueView }) {
  return value.items.length ? (
    <div className="staff-scroll">
      <table>
        <caption>Masked queue · at most 25 rows per page</caption>
        <thead>
          <tr>
            <th>Reference</th>
            <th>State</th>
            <th>Due or updated</th>
          </tr>
        </thead>
        <tbody>
          {value.items.map((r) => (
            <tr key={r.id}>
              <td>
                <code>{r.id}</code>
              </td>
              <td>{r.state}</td>
              <td>{'dueAt' in r ? (r.dueAt ?? 'Unavailable') : r.updatedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Missing>No items in this page. This does not certify that processing is healthy.</Missing>
  );
}
export function SourceView({ value }: { value: SourceHealthView }) {
  return (
    <>
      <p>
        Actual domain coverage: <strong>unconfirmed</strong>. Licensed adapters and specialist
        review remain pending.
      </p>
      <p>Observed {value.asOf}. Polling schedule and dataset expiry are separate measurements.</p>
      {value.bundle ? (
        <>
          <p>
            Current bundle {value.bundle.id} · component completeness: {value.bundle.completeness}
          </p>
          <ul>
            {value.bundle.components.map((c) => (
              <li key={c.key}>
                {c.key}: {c.freshness} · fetched {c.fetchedAt} · expiry {c.expiresAt ?? 'unknown'} ·
                display {c.rights.display ? 'permitted' : 'not permitted'}, cache{' '}
                {c.rights.cache ? 'permitted' : 'not permitted'}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Missing>No published bundle is available.</Missing>
      )}
      <ul>
        {value.sources.map((s) => (
          <li key={s.key}>
            <strong>{s.kind}</strong>: {s.state}. Last success {s.lastSucceededAt ?? 'unavailable'};
            next poll {s.nextDueAt ?? 'not scheduled'}.
          </li>
        ))}
      </ul>
      {!value.sources.length && <Missing>No connector metadata available.</Missing>}
    </>
  );
}
export function StrategyView({ value }: { value: StrategicRegisterView }) {
  return (
    <>
      <p>
        Strategic page register · owner assignments remain unconfirmed. Local previews remain
        noindex.
      </p>
      <ul>
        {value.items.map((r) => (
          <li key={r.id}>
            <a href={r.path}>{r.path}</a> · {r.status} · canonical {r.canonical} · review due{' '}
            {r.reviewDue}
          </li>
        ))}
      </ul>
      {!value.items.length && <Missing>No registered pages.</Missing>}
    </>
  );
}
export function FindingsView({ value }: { value: SeoFindingsView }) {
  return (
    <>
      <p>Recorded findings only. Crawler and Search Console integration are unavailable locally.</p>
      <ul>
        {value.items.map((r) => (
          <li key={r.id}>
            {r.severity}: {r.rule} · {r.state} · page {r.pageId} · {r.detectedAt}
          </li>
        ))}
      </ul>
      {!value.items.length && (
        <Missing>No recorded findings. This is not a successful crawl.</Missing>
      )}
    </>
  );
}
export function OperationsViewPanel({ value }: { value: OperationsView }) {
  return (
    <>
      <p>{value.coverage}. Aggregate values never represent all visitors.</p>
      <dl>
        <dt>Events</dt>
        <dd>
          {value.events
            ? `${value.events.value}${value.events.pending ? ' · rebuild pending' : ''}`
            : 'Unavailable'}
        </dd>
        <dt>Daily distinct sessions</dt>
        <dd>
          {value.dailyDistinctSessions
            ? `${value.dailyDistinctSessions.value}${value.dailyDistinctSessions.pending ? ' · rebuild pending' : ''}`
            : 'Unavailable'}
        </dd>
        <dt>Sampled</dt>
        <dd>{value.health.sampledAt}</dd>
        <dt>Queued / uncertain sends</dt>
        <dd>
          {value.health.sendsQueued} / {value.health.sendsUncertain}
        </dd>
        <dt>Pending analytics / outbox</dt>
        <dd>
          {value.health.analyticsPending} / {value.health.outboxPending}
        </dd>
        <dt>Quota rows / capacity</dt>
        <dd>
          {value.health.quotaRows} / {value.health.quotaCapacity}
        </dd>
      </dl>
      {value.health.capped && (
        <Missing>
          One or more health counts reached the bounded sampling cap; totals may be larger.
        </Missing>
      )}
    </>
  );
}
export function RevenueViewPanel({ value }: { value: RevenueView }) {
  const metric = value.metric;
  return (
    <>
      <p>
        Status: <strong>{value.status.replaceAll('_', ' ')}</strong> · {value.currency} ·{' '}
        {value.day} · {value.dimension}
      </p>
      {metric ? (
        <dl>
          <dt>Revenue in currency minor units</dt>
          <dd>
            {metric.revenueMinor} · {metric.revenueStatus}
          </dd>
          <dt>Impressions</dt>
          <dd>{metric.impressions}</dd>
          <dt>Fill / viewability / consent coverage (basis points)</dt>
          <dd>
            {value.fillBasisPoints ?? 'Unavailable'} /{' '}
            {value.viewabilityBasisPoints ?? 'Unavailable'} /{' '}
            {value.consentCoverageBasisPoints ?? 'Unavailable'}
          </dd>
          <dt>RPM in minor units / mean latency in ms</dt>
          <dd>
            {value.rpmMinor ?? 'Unavailable'} / {value.meanLatencyMs ?? 'Unavailable'}
          </dd>
          <dt>Fetched / source generation</dt>
          <dd>
            {metric.fetchedAt} / {metric.sourceGeneration}
          </dd>
        </dl>
      ) : (
        <Missing>No provider report available. Missing values are not zero.</Missing>
      )}
      <p>
        {value.measurement}. Estimated and finalized values are not summed. No currency conversion
        or profit claim.
      </p>
    </>
  );
}
export function ConfigurationSummary({ value }: { value: CommercialConfigurationView }) {
  return (
    <>
      <p>
        Current policy version: {value.version} · network readiness:{' '}
        {value.networkReady ? 'recorded' : 'not ready'} · external activation: held.
      </p>
      {!value.policy && <Missing>No commercial policy has been published.</Missing>}
    </>
  );
}
