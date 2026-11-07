import type {
  GenericAnalysisProvider,
  GenericAnalysisTransport,
} from '../../application/src/ports/generic-analysis.ts';
import { analysisUsage } from './analysis-provider.ts';
import { boundedIO } from './bounded-io.ts';
const schema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'factIds', 'questions'],
  properties: {
    schema: { const: 1 },
    factIds: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'string' } },
    questions: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'string',
        enum: ['verify_fitment', 'measure_tread', 'verify_dot', 'confirm_total'],
      },
    },
  },
});
const unknownUsage = {
  providerRequestId: null,
  inputTokens: null,
  outputTokens: null,
  costMinor: null,
} as const;
export function createStructuredGenericProvider(
  transport: GenericAnalysisTransport,
): GenericAnalysisProvider {
  return Object.freeze({
    async analyze(input: Parameters<GenericAnalysisProvider['analyze']>[0]) {
      try {
        if (
          !Number.isInteger(input.deadlineMs) ||
          input.deadlineMs < 1 ||
          input.deadlineMs > 25000 ||
          input.configuration.schema !== 'generic-selection-v1' ||
          input.configuration.validator !== 'generic-validator-v1' ||
          !/^[a-f0-9]{64}$/.test(input.configuration.configurationHash)
        )
          throw Error('Invalid evaluated generic contract');
        const packet = JSON.parse(JSON.stringify(input.packet));
        if (Buffer.byteLength(JSON.stringify(packet)) > 8192) throw Error('Packet exceeds bound');
        const result = await boundedIO(
          (signal) =>
            transport.send({
              packet,
              configuration: Object.freeze({ ...input.configuration }),
              schema,
              strict: true,
              store: false,
              tools: [],
              maxInputTokens: 65536,
              maxOutputTokens: 512,
              signal,
            }),
          input.deadlineMs,
        );
        const usage = analysisUsage(result);
        if (result.state === 'refused' || result.state === 'incomplete')
          return Object.freeze({ ...usage, state: result.state });
        if (result.state !== 'complete') throw Error('Unknown response');
        try {
          const text = JSON.stringify(result.output);
          if (!text || Buffer.byteLength(text) > 8192) throw Error('Invalid output');
          return Object.freeze({ ...usage, state: 'complete' as const, output: JSON.parse(text) });
        } catch {
          return Object.freeze({ ...usage, state: 'invalid_output' as const });
        }
      } catch {
        return Object.freeze({ ...unknownUsage, state: 'unavailable' as const });
      }
    },
  });
}
