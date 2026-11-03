import { quoteInputSchema } from './quote-input.ts';
import { z } from 'zod';
import { assessmentInputSchema } from './assessment-input.ts';
export { assessmentInputSchema } from './assessment-input.ts';
const uuid = z.string().uuid(),
  revision = z.string().regex(/^[1-9][0-9]{0,18}$/),
  version = z.number().int().min(1).max(2147483647);
export const reportInputSchemas = {
  createReport: assessmentInputSchema,
  forkReport: assessmentInputSchema,
  saveDraft: z.strictObject({
    baseVersion: version,
    expectedRevision: revision.nullable(),
    input: assessmentInputSchema,
  }),
  refineReport: z.strictObject({
    baseVersion: version,
    draftRevision: revision,
    expectedRevision: revision,
  }),
  compareReport: z.strictObject({
    version,
    expectedRevision: revision.nullable(),
    items: z
      .array(z.strictObject({ kind: z.enum(['catalog', 'quote']), key: uuid }))
      .min(1)
      .max(4),
  }),
  saveQuote: quoteInputSchema,
  shareReport: z.strictObject({
    version: version.nullable(),
    comparisonRevision: revision.nullable(),
  }),
  revokeShare: z.strictObject({}),
  ownerPdf: z.strictObject({ assetId: uuid, version }),
  sharedPdf: z.strictObject({ assetId: uuid }),
};
export type AssessmentRequest = z.infer<typeof assessmentInputSchema>;
export type ReportOperation = keyof typeof reportInputSchemas;
export type ReportInput<K extends ReportOperation> = z.infer<(typeof reportInputSchemas)[K]>;
