import { analysisLimitations, analysisQuestions } from './analysis-policy.ts';
import { id } from './values/core.ts';

export const analysisSummary =
  'These explanations refer only to facts recorded in the deterministic report.';
export const analysisGenericSummary =
  'These installer questions use reviewed general guidance and do not assess your tires.';
export type AnalysisFallback = 'not_requested' | 'unavailable' | 'declined' | 'expired';
export type FrozenAnalysis = Readonly<
  | { schema: 1; mode: 'none'; fallback: AnalysisFallback }
  | {
      schema: 1;
      mode: 'artifact';
      attachmentRevision: string;
      artifactHash: string;
      output: Readonly<
        | {
            schema: 1;
            kind: 'ai_assisted_selection';
            summary: string;
            claims: readonly Readonly<Record<string, unknown>>[];
            limitations: readonly string[];
            questions: readonly string[];
          }
        | {
            schema: 1;
            kind: 'reviewed_generic_explanation';
            claims: readonly Readonly<Record<string, unknown>>[];
            limitations: readonly string[];
            questions: readonly string[];
          }
      >;
    }
>;
function demand(v: unknown): asserts v {
  if (!v) throw Error('Frozen analysis unavailable');
}
function object(v: unknown, keys: string) {
  demand(v && typeof v === 'object' && !Array.isArray(v));
  demand(Object.keys(v).sort().join(',') === keys);
  return v as Record<string, unknown>;
}
function codes(v: unknown, allowed: readonly string[], max: number) {
  demand(Array.isArray(v) && v.length <= max && new Set(v).size === v.length);
  demand(v.every((x) => typeof x === 'string' && allowed.includes(x)));
  return Object.freeze([...v] as string[]);
}
export function freezeAnalysis(raw: unknown): FrozenAnalysis {
  demand(JSON.stringify(raw)?.length <= 32768);
  const m =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).mode
      : null;
  if (m === 'none') {
    const x = object(raw, 'fallback,mode,schema');
    demand(
      x.schema === 1 &&
        ['not_requested', 'unavailable', 'declined', 'expired'].includes(String(x.fallback)),
    );
    return Object.freeze({ schema: 1, mode: 'none', fallback: x.fallback as AnalysisFallback });
  }
  const x = object(raw, 'artifactHash,attachmentRevision,mode,output,schema');
  demand(
    x.schema === 1 &&
      x.mode === 'artifact' &&
      typeof x.attachmentRevision === 'string' &&
      /^[1-9]\d{0,18}$/.test(x.attachmentRevision),
  );
  demand(typeof x.artifactHash === 'string' && /^[a-f0-9]{64}$/.test(x.artifactHash));
  if (
    x.output &&
    typeof x.output === 'object' &&
    (x.output as Record<string, unknown>).kind === 'reviewed_generic_explanation'
  ) {
    const o = object(x.output, 'claims,kind,limitations,questions,schema');
    demand(o.schema === 1 && Array.isArray(o.claims) && o.claims.length === 1);
    const c = object(o.claims[0], 'adviceId,sourceId,text'),
      advice = id('advice_fact', c.adviceId),
      source = id('dataset', c.sourceId);
    demand(
      typeof c.text === 'string' &&
        c.text.trim().length > 0 &&
        c.text.length <= 2000 &&
        !c.text.includes('\0') &&
        advice.ok &&
        source.ok,
    );
    return Object.freeze({
      schema: 1,
      mode: 'artifact',
      attachmentRevision: x.attachmentRevision,
      artifactHash: x.artifactHash,
      output: Object.freeze({
        schema: 1,
        kind: 'reviewed_generic_explanation',
        claims: Object.freeze([
          Object.freeze({ text: c.text, adviceId: advice.value, sourceId: source.value }),
        ]),
        limitations: codes(o.limitations, analysisLimitations, 4),
        questions: codes(o.questions, analysisQuestions, 4),
      }),
    });
  }
  const o = object(x.output, 'claims,kind,limitations,questions,schema,summary');
  demand(o.schema === 1 && o.kind === 'ai_assisted_selection' && o.summary === analysisSummary);
  demand(Array.isArray(o.claims) && o.claims.length <= 5);
  // Claims remain in the frozen provenance. Critical facts are rendered from the report DTO,
  // never by interpreting model text or repeating numeric claims from an arbitrary artifact.
  const claims = o.claims.map((v) => {
    const c = object(v, 'budget,citations,rank,reasonCodes,scoreBasisPoints,status');
    demand(Number.isInteger(c.rank) && Number(c.rank) >= 1 && Number(c.rank) <= 5);
    demand(
      ['eligible', 'blocked', 'unverified'].includes(String(c.status)) &&
        ['within', 'above', 'unknown', 'not_requested'].includes(String(c.budget)),
    );
    demand(
      c.scoreBasisPoints === null ||
        (Number.isInteger(c.scoreBasisPoints) &&
          Number(c.scoreBasisPoints) >= 0 &&
          Number(c.scoreBasisPoints) <= 10000),
    );
    demand(
      Array.isArray(c.reasonCodes) &&
        c.reasonCodes.length <= 64 &&
        c.reasonCodes.every((v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(v)),
    );
    demand(
      Array.isArray(c.citations) &&
        c.citations.length <= 64 &&
        c.citations.every((v) => typeof v === 'string' && /^[A-Za-z0-9_:-]{1,160}$/.test(v)),
    );
    return Object.freeze({
      ...c,
      rank: c.rank,
      reasonCodes: Object.freeze([...c.reasonCodes]),
      citations: Object.freeze([...c.citations]),
    });
  });
  demand(new Set(claims.map((c) => c.rank)).size === claims.length);
  return Object.freeze({
    schema: 1,
    mode: 'artifact',
    attachmentRevision: x.attachmentRevision,
    artifactHash: x.artifactHash,
    output: Object.freeze({
      schema: 1,
      kind: 'ai_assisted_selection',
      summary: analysisSummary,
      claims: Object.freeze(claims),
      limitations: codes(o.limitations, analysisLimitations, 4),
      questions: codes(o.questions, analysisQuestions, 4),
    }),
  });
}
const questionCopy: Record<string, string> = {
  verify_fitment: 'Ask your installer to verify the complete vehicle, wheel and tire fitment.',
  measure_tread: 'Ask your installer to measure tread and inspect all tires.',
  verify_dot: 'Ask your installer to verify the complete DOT identification and date markings.',
  confirm_total:
    'Ask your installer to confirm the complete installed total and included services.',
};
export function analysisDeliveryText(raw: FrozenAnalysis): readonly string[] {
  const x = freezeAnalysis(raw);
  if (x.mode === 'none')
    return Object.freeze([
      'AI assistance was not included in this presentation. Use the deterministic report and reviewed guidance.',
      'Selection: ' +
        x.fallback.replaceAll('_', ' ') +
        '. No later analysis is added to this frozen delivery.',
    ]);
  return Object.freeze([
    x.output.kind === 'reviewed_generic_explanation'
      ? 'Reviewed general installer questions'
      : 'AI-assisted installer questions',
    x.output.kind === 'reviewed_generic_explanation' ? analysisGenericSummary : analysisSummary,
    'Frozen attachment revision ' +
      x.attachmentRevision +
      '. Later refreshes do not change this delivery.',
    'Personalized claims and citations remain in the private owner view. Shared reports contain the deterministic facts only.',
    ...x.output.questions.map((k) => questionCopy[k]!),
    'This assistance does not establish fitment, tire condition or recall clearance. A physical inspection and current source verification are required.',
  ]);
}
