import { z } from 'zod';
const uuid = z
    .string()
    .uuid()
    .refine((value) => value !== '00000000-0000-0000-0000-000000000000'),
  revision = z.string().regex(/^[1-9][0-9]{0,18}$/);
const rights = z.enum(['access', 'delete', 'correct', 'restrict', 'opt_out', 'export']);
const jurisdiction = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const notices = z.strictObject({ report: uuid.optional(), offers: uuid.optional() });
export const contactRequestSchema = z.strictObject({
  email: z.string().min(3).max(254),
  report: z.strictObject({ id: uuid, version: z.number().int().min(1).max(2147483647) }).nullable(),
  offers: z.boolean(),
  notices,
});
export const consentInputSchemas = {
  requestContact: contactRequestSchema,
  requestDelivery: contactRequestSchema.extend({
    comparisonRevision: revision.nullable().optional(),
  }),
  cancelDelivery: z.strictObject({
    expectedRevision: revision,
    reason: z.enum(['cancel', 'correct_address']).default('cancel'),
  }),
  setBrowserConsent: z.strictObject({
    expectedRevision: revision,
    allowed: z.array(z.enum(['analytics', 'ads', 'targeted_ads'])).max(3),
    gpc: z.boolean(),
    notices: z.strictObject({ necessary: uuid, analytics: uuid, ads: uuid, targeted_ads: uuid }),
  }),
  requestOwnerRights: z.strictObject({ kind: rights, jurisdiction }),
  requestEmailRights: z.strictObject({
    email: z.string().min(3).max(254),
    kind: rights,
    jurisdiction,
  }),
  confirmPrivacyProof: z.strictObject({}),
};
export type ConsentOperation = keyof typeof consentInputSchemas;
