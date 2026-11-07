import { createHash } from 'node:crypto';
import type {
  PhotoExtractionProvider,
  PhotoExtractionTransport,
} from '../../application/src/ports/photo-services.ts';
import { imageMime, photoFields } from '../../domain/src/photo-policy.ts';
import { analysisUsage } from './analysis-provider.ts';
import { boundedIO } from './bounded-io.ts';
const stringOrNull = { type: ['string', 'null'], maxLength: 160 };
const schema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'fields'],
  properties: {
    schema: { const: 1 },
    fields: {
      type: 'array',
      maxItems: 9,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'rawText', 'value', 'quality', 'unknownReason', 'region'],
        properties: {
          field: { type: 'string', enum: photoFields },
          rawText: stringOrNull,
          value: stringOrNull,
          quality: { enum: ['clear', 'uncertain', 'unknown'] },
          unknownReason: { enum: [null, 'unreadable', 'not_visible', 'ambiguous', 'unsupported'] },
          region: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['x', 'y', 'w', 'h'],
                properties: {
                  x: { type: 'number', minimum: 0, maximum: 1 },
                  y: { type: 'number', minimum: 0, maximum: 1 },
                  w: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
                  h: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
                },
              },
            ],
          },
        },
      },
    },
  },
});
export function createPhotoExtractionProvider(
  transport: PhotoExtractionTransport,
): PhotoExtractionProvider {
  return Object.freeze<PhotoExtractionProvider>({
    async extract(input) {
      const unavailable = {
        state: 'unavailable' as const,
        providerRequestId: null,
        inputTokens: null,
        outputTokens: null,
        costMinor: null,
      };
      if (
        !(input.bytes instanceof Uint8Array) ||
        input.bytes.length < 1 ||
        input.bytes.length > 10485760 ||
        imageMime(input.bytes) !== 'image/jpeg' ||
        createHash('sha256').update(input.bytes).digest('hex') !== input.sha256 ||
        !Number.isInteger(input.deadlineMs) ||
        input.deadlineMs < 1 ||
        input.deadlineMs > 25000 ||
        input.configuration.schema !== 'photo-selection-v1' ||
        input.configuration.validator !== 'photo-fields-v1' ||
        Object.values(input.configuration).some(
          (v) => typeof v !== 'string' || v.length < 1 || v.length > 256,
        )
      )
        return unavailable;
      try {
        const reply = await boundedIO(
            (signal) =>
              transport.send({
                bytes: new Uint8Array(input.bytes),
                mime: 'image/jpeg',
                configuration: Object.freeze({ ...input.configuration }),
                attempt: input.attempt,
                signal,
                strict: true,
                store: false,
                tools: [],
                schema,
                maxInputTokens: 1048576,
                maxOutputTokens: 1024,
              }),
            input.deadlineMs,
          ),
          usage = analysisUsage(reply);
        if (!usage) return unavailable;
        if (reply.state === 'refused' || reply.state === 'incomplete')
          return { ...usage, state: reply.state };
        if (reply.state !== 'complete') return unavailable;
        const encoded = JSON.stringify(reply.output);
        if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 8192)
          return { ...usage, state: 'invalid_output' };
        return { ...usage, state: 'complete', output: JSON.parse(encoded) as unknown };
      } catch {
        return unavailable;
      }
    },
  });
}
