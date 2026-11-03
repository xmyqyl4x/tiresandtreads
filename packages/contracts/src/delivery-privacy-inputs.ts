import './browser-runtime.ts';
import * as z from 'zod/mini';
export const resourceId = z
  .uuid()
  .check(z.refine((v) => v !== '00000000-0000-0000-0000-000000000000'));
const revision = z.string().check(z.regex(/^[1-9][0-9]{0,18}$/));
export const rightsKind = z.enum(['access', 'delete', 'correct', 'restrict', 'opt_out', 'export']);
const jurisdiction = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,100}$/));
const email = z.string().check(z.minLength(3), z.maxLength(254));
export const contactRequestSchema = z.strictObject({
  email,
  report: z.nullable(
    z.strictObject({
      id: resourceId,
      version: z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
    }),
  ),
  offers: z.boolean(),
  notices: z.strictObject({ report: z.optional(resourceId), offers: z.optional(resourceId) }),
});
export const deliveryRequestSchema = z.extend(contactRequestSchema, {
  comparisonRevision: z.optional(z.nullable(revision)),
});
export const cancelDeliverySchema = z.strictObject({
  expectedRevision: revision,
  reason: z._default(z.enum(['cancel', 'correct_address']), 'cancel'),
});
export const ownerRightsSchema = z.strictObject({ kind: rightsKind, jurisdiction });
export const emailRightsSchema = z.strictObject({ email, kind: rightsKind, jurisdiction });
export type ContactInput = z.input<typeof contactRequestSchema>;
export type DeliveryInput = z.input<typeof deliveryRequestSchema>;
export type OwnerRightsInput = z.input<typeof ownerRightsSchema>;
export type EmailRightsInput = z.input<typeof emailRightsSchema>;
export type DeliveryChoice =
  | { readonly kind: 'delivery'; readonly input: DeliveryInput }
  | { readonly kind: 'offers'; readonly input: ContactInput };
