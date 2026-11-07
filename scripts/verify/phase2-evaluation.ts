import {
  buildAnalysisPacket,
  validateAnalysisSelection,
  analysisValidator,
} from '../../packages/domain/src/analysis-policy.ts';
import {
  photoReadingSet,
  photoFieldValue,
  photoFields,
} from '../../packages/domain/src/photo-policy.ts';
import { instant } from '../../packages/domain/src/values/core.ts';
// Offline synthetic rehearsal only. No provider calls, image reads, credentials, acceptance
// inputs or authority-bearing output. Actual benchmark admission requires separate review.
export interface SyntheticEvaluationCase {
  id: string;
  family: 'explanation' | 'photo';
  split: 'development' | 'heldout';
  group: string;
  inputSha256: string;
  cohort: string;
  expected: 'accepted' | 'rejected' | 'unavailable';
  evidence: unknown;
  labels: Record<string, string | null>;
  output: unknown;
}
export interface SyntheticEvaluationBatch {
  schema: 1;
  synthetic: true;
  now: string;
  cases: SyntheticEvaluationCase[];
}
function demand(v: unknown): asserts v {
  if (!v) throw Error('Invalid synthetic evaluation batch');
}
function record(v: unknown): Record<string, unknown> {
  demand(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype,
  );
  return v as Record<string, unknown>;
}
function exact(v: unknown, keys: string) {
  const r = record(v);
  demand(Object.keys(r).sort().join(',') === keys);
  return r;
}
export function wilsonInterval(
  correct: number,
  total: number,
): Readonly<{ lower: number; upper: number }> | null {
  demand(
    Number.isSafeInteger(correct) &&
      Number.isSafeInteger(total) &&
      correct >= 0 &&
      total >= correct &&
      total <= 100000,
  );
  if (total === 0) return null;
  const z = 1.959963984540054,
    z2 = z * z,
    p = correct / total,
    denominator = 1 + z2 / total,
    centre = (p + z2 / (2 * total)) / denominator,
    half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return Object.freeze({
    lower: Math.max(0, centre - half),
    upper: correct === total ? 1 : Math.min(1, centre + half),
  });
}
export function evaluateSyntheticBatch(raw: unknown) {
  const serialized = JSON.stringify(raw);
  demand(typeof serialized === 'string' && new TextEncoder().encode(serialized).length <= 1048576);
  const batch = exact(raw, 'cases,now,schema,synthetic');
  demand(
    batch.schema === 1 &&
      batch.synthetic === true &&
      instant(batch.now).ok &&
      Array.isArray(batch.cases) &&
      batch.cases.length >= 1 &&
      batch.cases.length <= 1000,
  );
  const now = batch.now as string;
  const ids = new Set<string>(),
    inputs = new Set<string>(),
    groups = new Map<string, string>();
  const stats = () => ({
    measured: 0,
    unmeasured: 0,
    accepted: 0,
    rejected: 0,
    unavailable: 0,
    mismatches: 0,
  });
  const all = stats(),
    cohorts = new Map<string, ReturnType<typeof stats>>(),
    fields = photoFields.map((field) => ({
      field,
      labeled: 0,
      emitted: 0,
      correct: 0,
      abstained: 0,
      expectedAbstentions: 0,
      missedValues: 0,
      incorrect: 0,
    }));
  for (const item of batch.cases) {
    const c = exact(
      item,
      'cohort,evidence,expected,family,group,id,inputSha256,labels,output,split',
    );
    demand(typeof c.id === 'string' && /^[A-Z][A-Z0-9_-]{1,39}$/.test(c.id) && !ids.has(c.id));
    ids.add(c.id);
    demand(
      typeof c.inputSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(c.inputSha256) &&
        !inputs.has(c.inputSha256),
    );
    inputs.add(c.inputSha256);
    demand(
      typeof c.group === 'string' &&
        /^[a-f0-9]{64}$/.test(c.group) &&
        typeof c.split === 'string' &&
        ['development', 'heldout'].includes(c.split) &&
        (!groups.has(c.group) || groups.get(c.group) === c.split),
    );
    groups.set(c.group, String(c.split));
    demand(
      typeof c.cohort === 'string' &&
        typeof c.family === 'string' &&
        ['explanation', 'photo'].includes(c.family) &&
        typeof c.expected === 'string' &&
        ['accepted', 'rejected', 'unavailable'].includes(c.expected) &&
        [
          'supported',
          'missing_evidence',
          'injection',
          'invalid_schema',
          'clear',
          'blurred',
          'partial_dot',
          'conflicting_text',
        ].includes(c.cohort),
    );
    demand(c.output !== undefined);
    const label = record(c.labels);
    if (c.family === 'photo') {
      demand(
        c.evidence === null &&
          Object.keys(label).sort().join(',') === [...photoFields].sort().join(','),
      );
      for (const f of photoFields) {
        const v = label[f];
        const normalized = v === null ? null : photoFieldValue(f, v, now);
        demand(v === null || (typeof v === 'string' && normalized?.ok && normalized.value === v));
      }
    } else demand(Object.keys(label).length === 0);
    const key = c.family + ':' + c.cohort;
    let cohort = cohorts.get(key);
    if (!cohort) {
      cohort = stats();
      cohorts.set(key, cohort);
    }
    const add = (name: keyof ReturnType<typeof stats>) => {
      all[name]++;
      cohort[name]++;
    };
    if (c.output === null) {
      add('unmeasured');
      continue;
    }
    add('measured');
    let outcome: 'accepted' | 'rejected' | 'unavailable' = 'rejected',
      wrong = false;
    const refusal =
      typeof c.output === 'object' &&
      c.output !== null &&
      !Array.isArray(c.output) &&
      Object.keys(c.output).join(',') === 'refused' &&
      (c.output as Record<string, unknown>).refused === true;
    if (refusal) outcome = 'unavailable';
    else if (c.family === 'explanation') {
      const packet = buildAnalysisPacket(c.evidence, now);
      outcome =
        packet.ok && validateAnalysisSelection(packet.value, c.output).ok ? 'accepted' : 'rejected';
    } else {
      const readings = photoReadingSet(c.output, now);
      if (readings.ok) {
        outcome = 'accepted';
        for (const f of fields) {
          const predicted = readings.value.fields.find((r) => r.field === f.field)?.value ?? null,
            expected = label[f.field];
          f.labeled++;
          if (predicted === null) {
            f.abstained++;
            if (expected === null) f.expectedAbstentions++;
            else {
              f.missedValues++;
              wrong = true;
            }
          } else {
            f.emitted++;
            if (predicted === expected) f.correct++;
            else {
              f.incorrect++;
              wrong = true;
            }
          }
        }
      }
    }
    add(outcome);
    if (outcome !== c.expected || wrong) add('mismatches');
  }
  return Object.freeze({
    schema: 1,
    scope: 'synthetic-validator-rehearsal' as const,
    validator: analysisValidator,
    cases: batch.cases.length,
    measured: all.measured,
    unmeasured: all.unmeasured,
    expectationMismatches: all.mismatches,
    localExpectationsMet: all.unmeasured === 0 && all.mismatches === 0,
    fields: fields.map((f) => ({
      ...f,
      precision: f.emitted === 0 ? null : f.correct / f.emitted,
      precisionInterval: wilsonInterval(f.correct, f.emitted),
      abstentionRate: f.labeled === 0 ? null : f.abstained / f.labeled,
    })),
    cohorts: [...cohorts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, s]) => ({ cohort, ...s })),
    pending: [
      '50-specialist-explanation-cases',
      '50-representative-labeled-images',
      'provenance-and-source-rights',
      'locked-independent-heldout-dataset',
      'actual-provider-model-prompt-schema-pins',
      'approved-precision-abstention-usefulness-thresholds',
      'actual-latency-cost-retry-budget-measurements',
      'specialist-adjudication',
      'privacy-retention-custody-approval',
      'P2-S3-G2-G7-signoff',
    ],
    criticalModelMisclaimsObserved: null,
    actualModelEvaluation: false,
    actualSpecialistExplanationLabels: 0,
    actualRepresentativeImages: 0,
    accepted: false,
    providerDispatches: 0,
    actualRecipientNotifications: 0,
    casesClosed: 0,
    gatesClosed: 0,
  });
}
