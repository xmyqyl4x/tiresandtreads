import { z } from 'zod';
const uuid = z
    .string()
    .uuid()
    .refine((value) => value !== '00000000-0000-0000-0000-000000000000'),
  day = z.iso.date(),
  path = z.string().min(1).max(2048),
  market = z.literal('US').default('US'),
  locale = z.literal('en-US').default('en-US');
export const operationQuerySchemas = {
  getBrowserConsent: z.strictObject({ cmpAvailable: z.enum(['true', 'false']).default('false') }),
  staffQueue: z.strictObject({
    after: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  importStatus: z.strictObject({}),
  importDiff: z.strictObject({ against: uuid.optional() }),
  seoMetrics: z.strictObject({ path: path.default('/'), locale, market, day }),
  operationsMetrics: z.strictObject({
    day,
    dimension: z.enum(['all', 'web', 'app', 'mcp']).default('all'),
  }),
  adRevenue: z.strictObject({
    account: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    day,
    dimension: z.string().min(1).max(100).default('all'),
    currency: z.literal('USD').default('USD'),
  }),
};
