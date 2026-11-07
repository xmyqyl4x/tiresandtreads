import type {
  AnalysisProvider,
  AnalysisProviderResult,
  AnalysisUsage,
  StructuredAnalysisTransport,
} from '../../application/src/ports/report-analysis.ts';
import { maxInt64 } from '../../domain/src/values/core.ts';
import {
  analysisSchema,
  analysisValidator,
  analysisLimitations,
  analysisQuestions,
} from '../../domain/src/analysis-policy.ts';
const unknownUsage: AnalysisUsage = Object.freeze({
  providerRequestId: null,
  inputTokens: null,
  outputTokens: null,
  costMinor: null,
});
export const groundedAnalysisOutputSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'summary', 'claims', 'limitations', 'questions'],
  properties: {
    schema: { type: 'integer', enum: [1] },
    summary: { type: 'string', enum: ['report_facts'] },
    claims: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'citations'],
        properties: {
          id: {
            type: 'string',
            enum: ['option-1', 'option-2', 'option-3', 'option-4', 'option-5'],
          },
          citations: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 100 } },
        },
      },
    },
    limitations: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', enum: [...analysisLimitations] },
    },
    questions: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', enum: [...analysisQuestions] },
    },
  },
});
function usage(raw: AnalysisUsage): AnalysisUsage {
  for (const v of [raw.inputTokens, raw.outputTokens, raw.costMinor])
    if (v !== null && (typeof v !== 'bigint' || v < 0n || v > maxInt64))
      throw Error('Invalid usage');
  if (
    raw.providerRequestId !== null &&
    (typeof raw.providerRequestId !== 'string' ||
      !/^[A-Za-z0-9_.:/-]{1,300}$/.test(raw.providerRequestId))
  )
    throw Error('Invalid provider identity');
  return Object.freeze({
    providerRequestId: raw.providerRequestId,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    costMinor: raw.costMinor,
  });
}
// A selected official SDK/endpoint adapter supplies this transport after its acceptance gate.
// This wrapper supplies no credentials, network destination, provider default or automatic retry.
export function createStructuredAnalysisProvider(
  transport: StructuredAnalysisTransport,
): AnalysisProvider {
  return Object.freeze({
    async analyze(
      input: Parameters<AnalysisProvider['analyze']>[0],
    ): Promise<AnalysisProviderResult> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      try {
        if (!Number.isInteger(input.deadlineMs) || input.deadlineMs < 1 || input.deadlineMs > 30000)
          throw Error('Invalid deadline');
        const configuration = Object.freeze({ ...input.configuration });
        if (
          configuration.schema !== analysisSchema ||
          configuration.validator !== analysisValidator ||
          !/^[a-f0-9]{64}$/.test(configuration.configurationHash)
        )
          throw Error('Invalid evaluated policy');
        for (const v of [
          configuration.provider,
          configuration.model,
          configuration.prompt,
          configuration.canonical,
        ])
          if (typeof v !== 'string' || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(v))
            throw Error('Invalid evaluated policy');
        const body = JSON.stringify(input.packet);
        if (new TextEncoder().encode(body).length > 32768) throw Error('Oversized packet');
        const packet = JSON.parse(body);
        const expired = new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, input.deadlineMs);
        });
        const result = await Promise.race([
          transport.send(
            Object.freeze({
              packet,
              configuration,
              schema: groundedAnalysisOutputSchema,
              strict: true,
              store: false,
              tools: Object.freeze([]) as readonly never[],
              maxOutputTokens: 4096,
              signal: controller.signal,
            }),
          ),
          expired,
        ]);
        if (result === null) return Object.freeze({ ...unknownUsage, state: 'timeout' });
        const observed = usage(result);
        if (result.state === 'refused' || result.state === 'incomplete')
          return Object.freeze({ ...observed, state: result.state });
        if (result.state !== 'complete') throw Error('Invalid response state');
        try {
          if (!result.output || typeof result.output !== 'object' || Array.isArray(result.output))
            throw Error('Invalid output');
          const text = JSON.stringify(result.output);
          if (new TextEncoder().encode(text).length > 16384) throw Error('Oversized output');
          return Object.freeze({ ...observed, state: 'complete', output: JSON.parse(text) });
        } catch {
          return Object.freeze({ ...observed, state: 'invalid_output' });
        }
      } catch {
        return Object.freeze({ ...unknownUsage, state: 'unavailable' });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  });
}
