import { quotedDifference } from '../comparison/model.ts';
import type { ComparisonView } from '@tt/contracts/comparison-views';
import { range, when } from '../results/presentation.ts';
export function ComparisonBody({
  value,
  asOf,
}: {
  value: ComparisonView;
  asOf?: string | undefined;
}) {
  return (
    <section className="report-section">
      <h2>Saved comparison · revision {value.revision}</h2>
      <p>
        As of {asOf ? when(asOf) : 'the stored report'}. Current source checks do not update these
        stored price snapshots. All totals below come from the service.
      </p>
      <div className="result-grid">
        {value.items.map((item) => (
          <article className="card" key={item.slot}>
            <h3>
              Slot {item.slot} · {item.kind === 'quote' ? 'Shop quote' : 'Catalog option'}
            </h3>
            <p>
              {item.snapshot.productKnown
                ? 'Product recognized in the evaluated evidence.'
                : 'Unverified product; no fitment or suitability approval.'}
            </p>
            <dl>
              <dt>Fitment</dt>
              <dd>{item.snapshot.fit}</dd>
              <dt>Climate</dt>
              <dd>{item.snapshot.climate}</dd>
              <dt>{item.kind === 'quote' ? 'Recorded quote base' : 'Tires-only estimate'}</dt>
              <dd>{range(item.snapshot.price?.merchandise)}</dd>
              <dt>Installed estimate</dt>
              <dd>{range(item.snapshot.price?.installed)}</dd>
              <dt>Price basis / fees</dt>
              <dd>
                {item.snapshot.price?.installed
                  ? 'See the recorded price and quantity; do not assume another quote uses the same basis.'
                  : 'Installed basis or required fee evidence is missing.'}
              </dd>
              <dt>Quote minus observed installed range</dt>
              <dd>{quotedDifference(item.snapshot.verdict?.delta ?? null)}</dd>
              <dt>Preference score</dt>
              <dd>
                {item.snapshot.scoreBp === null
                  ? 'Unavailable'
                  : (item.snapshot.scoreBp / 100).toFixed(1) + ' / 100'}
              </dd>
            </dl>
            {item.kind === 'quote' ? (
              <p className="hint">
                The quote base may already include installation or tax; it is not a tires-only
                breakdown. No fees are subtracted here. Review the entered quantity and basis.
              </p>
            ) : null}
            {item.snapshot.verdict ? (
              <p>
                Service verdict: {item.snapshot.verdict.relation.replaceAll('_', ' ')}.{' '}
                {item.snapshot.verdict.evidenceMissing
                  ? 'Required comparison evidence is missing.'
                  : ''}
              </p>
            ) : null}
          </article>
        ))}
      </div>
      <p className="hint">
        Lifetime cost, savings and replacement forecasts are unavailable for this comparison: no
        ownership scenario has been calculated. No price is a safety rating or live purchase offer.
      </p>
    </section>
  );
}
