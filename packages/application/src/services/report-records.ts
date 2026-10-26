import type { JsonObject } from '../ports/catalog-records.ts';
import type { Version } from '../ports/private-records.ts';
export {
  ServiceFault as ReportFault,
  serviceWork as reportWork,
  serviceFailure,
  demand,
} from './service-work.ts';
import { object, json, canonical } from './service-records.ts';
import { demand } from './service-work.ts';
export { object, exact, canonical, json } from './service-records.ts';
function pick(value: unknown, fields: string[]) {
  const x = object(value);
  return Object.fromEntries(fields.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]));
}
function versions(value: unknown) {
  return pick(value, [
    'engine',
    'schema',
    'policy',
    'scoring',
    'bundleId',
    'datasets',
    'ruleVersionId',
  ]);
}
function money(value: unknown) {
  return value === null || value === undefined ? null : pick(value, ['low', 'high', 'currency']);
}
function price(value: unknown) {
  if (value === null || value === undefined) return null;
  const x = object(value);
  return {
    ...pick(x, [
      'mathVersion',
      'id',
      'asOf',
      'observedAt',
      'validUntil',
      'currency',
      'quantity',
      'productKnown',
      'freshness',
      'includeAlignment',
    ]),
    merchandise: money(x.merchandise),
    installed: money(x.installed),
    historical: true,
  };
}
export function publicComparison(value: unknown): JsonObject {
  const c = object(value);
  demand(Array.isArray(c.items) && c.items.length <= 4, 'integrity');
  return json({
    revision: String(c.revision),
    items: c.items.map((v) => {
      const i = object(v),
        s = object(i.snapshot),
        verdict = s.verdict ? object(s.verdict) : null;
      return {
        slot: i.slot,
        kind: i.kind,
        snapshot: {
          ...pick(s, ['productKnown', 'fit', 'climate', 'scoreBp']),
          price: price(s.price),
          verdict: verdict
            ? {
                ...pick(verdict, ['fit', 'climate', 'relation', 'score', 'evidenceMissing']),
                delta: verdict.delta
                  ? pick(verdict.delta, ['lowMinor', 'highMinor', 'currency'])
                  : null,
              }
            : null,
        },
      };
    }),
  });
}
export function reportDiff(
  a: Pick<Version, 'input' | 'output'>,
  b: Pick<Version, 'input' | 'output'>,
) {
  const ar = object(a.output.result),
    br = object(b.output.result),
    av = object(ar.versions),
    bv = object(br.versions);
  demand(Array.isArray(ar.picks) && Array.isArray(br.picks), 'integrity');
  const before = ar.picks as string[],
    after = br.picks as string[];
  const rulesChanged =
    av.policy !== bv.policy || av.scoring !== bv.scoring || av.engine !== bv.engine;
  return Object.freeze({
    answersChanged: canonical(a.input) !== canonical(b.input),
    dataChanged:
      canonical(av.datasets ?? []) !== canonical(bv.datasets ?? []) || av.bundleId !== bv.bundleId,
    rulesChanged,
    scoresComparable: !rulesChanged,
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
    reranked: after.filter((id) => before.includes(id) && before.indexOf(id) !== after.indexOf(id)),
  });
}
// Deliberately select fields; never clone a private snapshot and delete a list of secrets.
export function publicReport(output: JsonObject): JsonObject {
  const r = object(output.result);
  const evidence =
    output.evidence && typeof output.evidence === 'object' ? object(output.evidence) : null;
  const options =
    evidence && Array.isArray(evidence.plans)
      ? evidence.plans.map((p) => {
          const plan = object(p),
            fields = [
              'id',
              'modelId',
              'sizeCode',
              'rimInches',
              'construction',
              'loadIndex',
              'speedRank',
              'loadRange',
              'xl',
              'runFlat',
              'season',
              'threePmsf',
            ];
          return { id: plan.id, front: pick(plan.front, fields), rear: pick(plan.rear, fields) };
        })
      : [];
  demand(Array.isArray(r.decisions) && r.decisions.length <= 1000, 'integrity');
  return json({
    purpose: 'technical_evaluation',
    issuanceAuthorized: false,
    result: {
      asOf: r.asOf,
      versions: versions(r.versions),
      picks: r.picks,
      decisions: r.decisions.map((v) => {
        const d = object(v);
        return { id: d.id, status: d.status, reasons: d.reasons, scoreBp: d.scoreBp };
      }),
    },
    prices: Array.isArray(output.prices) ? output.prices.map(price) : [],
    options,
    products: Array.isArray(output.products)
      ? output.products.map((p) => pick(p, ['id', 'modelId', 'brand', 'model', 'sizeCode']))
      : [],
    historical: true,
  });
}
