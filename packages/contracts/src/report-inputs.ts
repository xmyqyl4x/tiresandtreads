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
  saveQuote: z.strictObject({
    id: uuid.nullable(),
    expectedRevision: revision.nullable(),
    skuId: uuid.nullable(),
    productText: z.string().max(200),
    shopName: z.string().max(200).nullable(),
    currency: z.literal('USD'),
    totalMinor: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
    quantity: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    basis: z.enum(['per_tire', 'set', 'installed_set']),
    sizeCode: z.string().min(1).max(80).nullable().optional(),
    observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    taxContextConfirmed: z.boolean(),
    taxIncluded: z.boolean().nullable(),
    components: z
      .array(
        z.strictObject({
          kind: z.enum([
            'mounting',
            'balancing',
            'tpms_valve',
            'disposal',
            'tax',
            'alignment',
            'required_other',
          ]),
          included: z.boolean(),
          basis: z.enum(['per_tire', 'per_axle', 'per_order']),
          minor: z
            .string()
            .regex(/^(0|[1-9][0-9]{0,18})$/)
            .nullable(),
        }),
      )
      .max(7),
  }),
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
