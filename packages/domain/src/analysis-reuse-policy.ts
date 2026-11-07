import { integer, maxInt64, ok, invalid, type Result } from './values/core.ts';
import { analysisQuestions } from './analysis-policy.ts';
const codes: Readonly<Record<string, readonly string[]>> = {
  climate_category: ['cold', 'mild', 'hot', 'wet', 'mixed'],
  usage: ['commute', 'highway', 'offroad', 'mixed'],
  tire_category: [
    'all_season',
    'all_weather',
    'winter',
    'summer',
    'touring',
    'performance',
    'light_truck',
  ],
  market: ['US'],
  locale: ['en-US'],
  season: ['spring', 'summer', 'autumn', 'winter', 'all'],
  question_code: ['tradeoffs', 'installer_questions', 'care'],
};
function record(raw: unknown): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Object.prototype
  )
    throw Error('Invalid object');
  return raw as Record<string, unknown>;
}
export function estimateAnalysisReservation(raw: unknown): Result<bigint> {
  try {
    const r = record(raw);
    if (
      Object.keys(r).sort().join(',') !==
      'inputCeiling,inputPerMillionMinor,outputCeiling,outputPerMillionMinor'
    )
      return invalid('analysis_pricing');
    const i = integer(r.inputCeiling, 1n, 1048576n),
      o = integer(r.outputCeiling, 1n, 4096n),
      a = integer(r.inputPerMillionMinor, 0n),
      b = integer(r.outputPerMillionMinor, 0n);
    if (!i.ok || !o.ok || !a.ok || !b.ok) return invalid('analysis_pricing');
    const cost = (i.value * a.value + o.value * b.value + 999999n) / 1000000n;
    if (cost > maxInt64) return invalid('analysis_pricing');
    return ok(cost === 0n ? 1n : cost);
  } catch {
    return invalid('analysis_pricing');
  }
}
export function normalizeSharedParameters(
  raw: unknown,
  allow: readonly string[],
): Result<Readonly<Record<string, string | null>>> {
  try {
    const r = record(raw);
    if (
      !Array.isArray(allow) ||
      allow.length < 1 ||
      allow.length > 7 ||
      new Set(allow).size !== allow.length ||
      allow.some((k) => !Object.hasOwn(codes, k)) ||
      Object.keys(r).some((k) => !allow.includes(k))
    )
      return invalid('shared_parameters');
    const out: Record<string, string | null> = {};
    for (const k of [...allow].sort()) {
      const v = Object.hasOwn(r, k) ? r[k] : null;
      if (v !== null && (typeof v !== 'string' || !codes[k]!.includes(v)))
        return invalid('shared_parameters');
      out[k] = v as string | null;
    }
    return ok(Object.freeze(out));
  } catch {
    return invalid('shared_parameters');
  }
}
export function analysisRetry(
  state: string,
  cost: bigint | null,
  attempt: number,
  remainingMs: number,
) {
  if (
    state !== 'incomplete' ||
    cost === null ||
    cost < 0n ||
    cost > maxInt64 ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt >= 3 ||
    !Number.isSafeInteger(remainingMs) ||
    remainingMs > 120000
  )
    return null;
  const delayMs = 2000 * 2 ** (attempt - 1);
  return remainingMs >= 30000 + delayMs ? Object.freeze({ attempt: attempt + 1, delayMs }) : null;
}
export interface GenericAnalysisPacket {
  readonly schema: 'generic-evidence-v1';
  readonly definition: string;
  readonly parameters: Readonly<Record<string, string | null>>;
  readonly fact: Readonly<{ id: string; text: string; source: string; validUntil: string }>;
}
export interface GenericSelection {
  readonly schema: 1;
  readonly factIds: readonly string[];
  readonly questions: readonly string[];
}
export function validateGenericSelection(
  packet: GenericAnalysisPacket,
  raw: unknown,
): Result<GenericSelection> {
  try {
    const r = record(raw);
    if (
      Object.keys(r).sort().join(',') !== 'factIds,questions,schema' ||
      r.schema !== 1 ||
      !Array.isArray(r.factIds) ||
      r.factIds.length !== 1 ||
      r.factIds[0] !== packet.fact.id ||
      !Array.isArray(r.questions) ||
      r.questions.length > 4 ||
      new Set(r.questions).size !== r.questions.length ||
      r.questions.some((q) => !analysisQuestions.includes(q))
    )
      return invalid('generic_selection');
    return ok(
      Object.freeze({
        schema: 1,
        factIds: Object.freeze([packet.fact.id]),
        questions: Object.freeze([...r.questions] as string[]),
      }),
    );
  } catch {
    return invalid('generic_selection');
  }
}
export function renderGenericSelection(packet: GenericAnalysisPacket, selection: GenericSelection) {
  return Object.freeze({
    schema: 1,
    kind: 'reviewed_generic_explanation',
    claims: Object.freeze([
      Object.freeze({
        text: packet.fact.text,
        adviceId: packet.fact.id,
        sourceId: packet.fact.source,
      }),
    ]),
    questions: selection.questions,
    limitations: Object.freeze([
      'deterministic_authority',
      'physical_inspection_required',
      'no_recall_clearance',
    ]),
  });
}
