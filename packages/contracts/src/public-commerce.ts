import { z } from 'zod';
const key = z.string().regex(/^[a-z0-9_]{1,100}$/);
const path = z.string().regex(/^\/(learn|guides|glossary)\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const publicCommercialSlot = z.strictObject({
  key,
  width: z.number().int().min(100).max(970),
  height: z.number().int().min(50).max(128),
  housePath: path,
  houseLabel: z.string().min(1).max(100),
  mode: z.literal('house'),
  label: z.literal('From Tires & Tread'),
});
export const publicCommerceView = z.strictObject({
  network: z.literal('held'),
  refreshSeconds: z.null(),
  slots: z.array(publicCommercialSlot).max(2),
  affiliates: z
    .array(
      z.strictObject({
        key,
        label: z.string().min(1).max(100),
        href: z.string().regex(/^\/go\/[a-z0-9_]{1,100}$/),
        disclosure: z.literal('We may earn a commission from this link.'),
        checkedAt: z.string().datetime(),
      }),
    )
    .max(1),
});
export const affiliateView = z.strictObject({
  destination: z.url({ protocol: /^https$/ }).max(2048),
  checkedAt: z.string().datetime(),
  disclosure: z.literal('We may earn a commission from this link.'),
  rel: z.literal('sponsored noopener noreferrer'),
  referrerPolicy: z.literal('no-referrer'),
});
export const adsTxtView = z.strictObject({
  status: z.enum(['ready', 'not_connected']),
  body: z.string().max(32768),
  version: z.number().int().positive().nullable(),
});
export type PublicCommerceView = z.infer<typeof publicCommerceView>;
