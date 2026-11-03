import { z } from 'zod';
const uuid = z.string().uuid(),
  revision = z.string().regex(/^[1-9][0-9]{0,18}$/),
  version = z.number().int().min(1).max(2147483647);
const metric = z.enum([
  'wet',
  'longevity',
  'comfort',
  'dry',
  'value',
  'noise',
  'efficiency',
  'snow',
  'ice',
]);
export const assessmentInputSchema = z.strictObject({
  market: z.literal('US'),
  regionKey: z.string().min(1).max(80),
  configurationId: uuid.nullable(),
  wheelPackage: z.string().min(1).max(200).nullable(),
  sizes: z
    .strictObject({ front: z.string().min(1).max(80), rear: z.string().min(1).max(80) })
    .nullable(),
  strategy: z.enum(['year_round', 'summer_set', 'winter_set']),
  winterUse: z.enum(['none', 'snow', 'ice', 'unknown']),
  replace: z
    .array(z.enum(['front_left', 'front_right', 'rear_left', 'rear_right']))
    .min(1)
    .max(4),
  priorities: z.array(metric).max(3),
  budget: z
    .strictObject({
      basis: z.enum(['installed', 'merchandise']),
      ceilingMinor: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
      currency: z.literal('USD'),
    })
    .nullable(),
});
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
    productText: z.string().min(1).max(200),
    shopName: z.string().min(1).max(200),
    currency: z.literal('USD'),
    totalMinor: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
    quantity: z.number().int().min(1).max(4),
    basis: z.enum(['installed_set', 'merchandise_set']),
    observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    taxContextConfirmed: z.boolean(),
    taxIncluded: z.boolean(),
    components: z
      .array(
        z.strictObject({
          kind: z.enum(['mounting', 'balancing', 'tpms_valve', 'disposal', 'tax']),
          included: z.boolean(),
          basis: z.enum(['per_tire', 'per_order']),
          minor: z
            .string()
            .regex(/^(0|[1-9][0-9]{0,18})$/)
            .nullable(),
        }),
      )
      .max(10),
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
