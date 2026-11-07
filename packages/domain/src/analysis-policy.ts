import { id, instant, invalid, ok, type Result } from './values/core.ts';

export const analysisSchema = 'grounded-selection-v1';
export const analysisValidator = 'grounded-validator-v1';
const reasons = new Set(
  'FITMENT_VERIFIED FITMENT_UNCONFIRMED FITMENT_CONSTRAINT_UNKNOWN FITMENT_SIZE_CONFLICT WHEEL_PACKAGE_UNCONFIRMED SIZE_MISMATCH RIM_MISMATCH CONSTRUCTION_MISMATCH INSUFFICIENT_LOAD INSUFFICIENT_SPEED LOAD_RANGE_MISMATCH XL_REQUIRED RUN_FLAT_REQUIRED SOURCE_UNAVAILABLE POLICY_REVIEW_REQUIRED REGIONAL_POLICY_UNCONFIRMED CLIMATE_UNKNOWN SEASONAL_POLICY_UNKNOWN SEASONAL_STRATEGY_MISMATCH WINTER_MARK_REQUIRED WINTER_MARK_UNKNOWN MARKET_UNAVAILABLE AVAILABILITY_UNKNOWN RECALL_MATCHED RECALL_REVIEW_REQUIRED RECALL_STALE REPLACEMENT_POLICY_UNKNOWN REPLACEMENT_PATTERN_UNAPPROVED MODEL_MIX_UNAPPROVED INSPECTION_REQUIRED RETAINED_TIRE_CONDITION REPLACEMENT_MEASUREMENTS_UNKNOWN TREAD_DIFFERENCE_EXCEEDED CIRCUMFERENCE_DIFFERENCE_EXCEEDED EVIDENCE_MISSING EVIDENCE_NOT_COMPARABLE PREFERENCE_SCORE PRIORITY_UNSUPPORTED ABOVE_BUDGET BUDGET_UNVERIFIED'.split(
    ' ',
  ),
);
const priorities = [
  'wet',
  'longevity',
  'comfort',
  'dry',
  'value',
  'noise',
  'efficiency',
  'snow',
  'ice',
];
export const analysisLimitations = [
  'source_limits',
  'physical_inspection_required',
  'deterministic_authority',
  'no_recall_clearance',
] as const;
export const analysisQuestions = [
  'verify_fitment',
  'measure_tread',
  'verify_dot',
  'confirm_total',
] as const;
export interface AnalysisClaim {
  readonly id: string;
  readonly rank: number;
  readonly status: 'eligible' | 'blocked' | 'unverified';
  readonly reasons: readonly string[];
  readonly citations: readonly string[];
  readonly scoreBp: number | null;
  readonly budget: 'within' | 'above' | 'unknown' | 'not_requested';
}
export interface AnalysisPacket {
  readonly schema: 'analysis-packet-v1';
  readonly market: 'US';
  readonly locale: 'en-US';
  readonly authoritativeHash: string;
  readonly bundleId: string;
  readonly ruleVersion: string;
  readonly engineVersion: string;
  readonly parameters: Readonly<{
    strategy: string;
    winterUse: string;
    priorities: readonly string[];
    frontSize: string | null;
    rearSize: string | null;
  }>;
  readonly claims: readonly AnalysisClaim[];
  readonly sources: readonly Readonly<{ id: string; validUntil: string }>[];
}
export interface AnalysisSelection {
  readonly schema: 1;
  readonly summary: 'report_facts';
  readonly claims: readonly Readonly<{ id: string; citations: readonly string[] }>[];
  readonly limitations: readonly string[];
  readonly questions: readonly string[];
}
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw Error('Invalid grounded analysis');
}
function record(v: unknown): Record<string, unknown> {
  requireValue(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype,
  );
  return v as Record<string, unknown>;
}
function list(v: unknown, max: number): unknown[] {
  requireValue(Array.isArray(v) && v.length <= max);
  return v;
}
function word(v: unknown, max = 100): string {
  requireValue(
    typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9_.:-]+$/.test(v),
  );
  return v;
}
function code<T extends string>(v: unknown, allowed: readonly T[]): T {
  requireValue(typeof v === 'string' && allowed.includes(v as T));
  return v as T;
}
function unique(v: readonly string[]) {
  requireValue(new Set(v).size === v.length);
  return Object.freeze([...v]);
}
function size(v: unknown) {
  if (v === null || v === undefined) return null;
  requireValue(typeof v === 'string' && /^[A-Z0-9/.-]{1,80}$/.test(v));
  // Reports support more than metric sizes. Retain known bounded code shapes;
  // omit other optional normalized codes instead of blocking all grounded assistance.
  const metric = /^(?:P|LT|ST)?[0-9]{3}\/[0-9]{2,3}(?:ZR|R|D|B)[0-9]{2}(?:\.[05])?(?:C|LT)?$/;
  const flotation =
    /^(?:LT)?[0-9]{2}(?:\.[0-9]{1,2})?X[0-9]{1,2}(?:\.[0-9]{1,2})?(?:R|D|B)[0-9]{2}(?:\.[05])?(?:LT|C)?$/;
  const widthOnly = /^(?:LT)?[0-9]{3}(?:R|D|B)[0-9]{2}(?:\.[05])?C?$/;
  return metric.test(v) || flotation.test(v) || widthOnly.test(v) ? v : null;
}
export function buildAnalysisPacket(raw: unknown, now: string): Result<AnalysisPacket> {
  try {
    const e = record(raw),
      input = record(e.input),
      output = record(e.output),
      result = record(output.result);
    requireValue(instant(now).ok && e.market === 'US' && e.locale === 'en-US');
    requireValue(typeof e.snapshotHash === 'string' && /^[a-f0-9]{64}$/.test(e.snapshotHash));
    requireValue(id('bundle', e.bundleId).ok && id('rule', e.ruleVersion).ok);
    const sources = list(e.sources, 64).map((v) => {
      const s = record(v);
      requireValue(
        id('dataset', s.id).ok && instant(s.validUntil).ok && String(s.validUntil) > now,
      );
      return Object.freeze({ id: String(s.id), validUntil: String(s.validUntil) });
    });
    unique(sources.map((s) => s.id));
    const picks = unique(list(result.picks, 5).map((v) => word(v, 200))),
      decisions = list(result.decisions, 1000);
    const claims = picks.map((key, i) => {
      const found = decisions.map(record).filter((d) => d.id === key);
      requireValue(found.length === 1);
      const d = found[0]!,
        refs = unique(list(d.sourceIds, 64).map((v) => word(v)));
      requireValue(refs.length > 0 && refs.every((ref) => sources.some((s) => s.id === ref)));
      const codes = unique(
        list(d.reasons, 40).map((v) => {
          const r = word(v);
          requireValue(reasons.has(r));
          return r;
        }),
      );
      requireValue(
        codes.length > 0 &&
          (d.scoreBp === null ||
            (Number.isInteger(d.scoreBp) && Number(d.scoreBp) >= 0 && Number(d.scoreBp) <= 10000)),
      );
      return Object.freeze({
        id: 'option-' + (i + 1),
        rank: i + 1,
        status: code(d.status, ['eligible', 'blocked', 'unverified']),
        reasons: codes,
        citations: refs,
        scoreBp: d.scoreBp as number | null,
        budget: code(d.budget, ['within', 'above', 'unknown', 'not_requested']),
      });
    });
    const sizes = input.sizes === undefined || input.sizes === null ? {} : record(input.sizes);
    return ok(
      Object.freeze({
        schema: 'analysis-packet-v1',
        market: 'US',
        locale: 'en-US',
        authoritativeHash: e.snapshotHash,
        bundleId: String(e.bundleId),
        ruleVersion: String(e.ruleVersion),
        engineVersion: word(e.engineVersion),
        parameters: Object.freeze({
          strategy: code(input.strategy, ['year_round', 'summer_set', 'winter_set']),
          winterUse: code(input.winterUse, ['none', 'snow', 'ice', 'unknown']),
          priorities: unique(list(input.priorities, 9).map((v) => code(v, priorities))),
          frontSize: size(sizes.front),
          rearSize: size(sizes.rear),
        }),
        claims: Object.freeze(claims),
        sources: Object.freeze(sources),
      }),
    );
  } catch {
    return invalid('analysis_packet');
  }
}
export function validateAnalysisSelection(
  packet: AnalysisPacket,
  raw: unknown,
): Result<AnalysisSelection> {
  try {
    const x = record(raw);
    requireValue(
      Object.keys(x).sort().join(',') === 'claims,limitations,questions,schema,summary' &&
        x.schema === 1 &&
        x.summary === 'report_facts',
    );
    const claims = list(x.claims, 5).map((v) => {
      const c = record(v);
      requireValue(Object.keys(c).sort().join(',') === 'citations,id');
      const found = packet.claims.find((p) => p.id === c.id);
      requireValue(found);
      const citations = unique(list(c.citations, 64).map((v) => word(v)));
      requireValue(
        citations.length === found.citations.length &&
          citations.every((id) => found.citations.includes(id)),
      );
      return Object.freeze({ id: found.id, citations });
    });
    unique(claims.map((c) => c.id));
    requireValue(packet.claims.length === 0 || claims.length > 0);
    return ok(
      Object.freeze({
        schema: 1,
        summary: 'report_facts',
        claims: Object.freeze(claims),
        limitations: unique(list(x.limitations, 4).map((v) => code(v, analysisLimitations))),
        questions: unique(list(x.questions, 4).map((v) => code(v, analysisQuestions))),
      }),
    );
  } catch {
    return invalid('analysis_selection');
  }
}
export function renderAnalysisSelection(packet: AnalysisPacket, selection: AnalysisSelection) {
  return Object.freeze({
    schema: 1,
    kind: 'ai_assisted_selection',
    summary: 'These explanations refer only to facts recorded in the deterministic report.',
    claims: Object.freeze(
      packet.claims
        .filter((c) => selection.claims.some((s) => s.id === c.id))
        .map((c) =>
          Object.freeze({
            rank: c.rank,
            status: c.status,
            reasonCodes: c.reasons,
            citations: c.citations,
            scoreBasisPoints: c.scoreBp,
            budget: c.budget,
          }),
        ),
    ),
    limitations: unique([
      'deterministic_authority',
      'physical_inspection_required',
      'no_recall_clearance',
      ...selection.limitations.filter(
        (c) =>
          ![
            'deterministic_authority',
            'physical_inspection_required',
            'no_recall_clearance',
          ].includes(c),
      ),
    ]),
    questions: selection.questions,
  });
}
