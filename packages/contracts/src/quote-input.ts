import './browser-runtime.ts';
import * as z from 'zod/mini';
const cents = z.string().check(z.regex(/^(0|[1-9][0-9]{0,18})$/));
export const quoteInputSchema = z.strictObject({
  id: z.nullable(z.uuid()),
  expectedRevision: z.nullable(z.string().check(z.regex(/^[1-9][0-9]{0,18}$/))),
  skuId: z.nullable(z.uuid()),
  productText: z.string().check(z.maxLength(200)),
  shopName: z.nullable(z.string().check(z.maxLength(200))),
  currency: z.literal('USD'),
  totalMinor: cents,
  quantity: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  basis: z.enum(['per_tire', 'set', 'installed_set']),
  sizeCode: z.optional(z.nullable(z.string().check(z.minLength(1), z.maxLength(80)))),
  observedOn: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  taxContextConfirmed: z.boolean(),
  taxIncluded: z.nullable(z.boolean()),
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
        minor: z.nullable(cents),
      }),
    )
    .check(z.maxLength(7)),
});
export type QuoteInput = ReturnType<typeof quoteInputSchema.parse>;
