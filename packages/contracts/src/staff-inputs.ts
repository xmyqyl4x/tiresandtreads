import { z } from 'zod';
const uuid = z
  .string()
  .uuid()
  .refine((v) => v !== '00000000-0000-0000-0000-000000000000');
const revision = z.string().regex(/^[1-9][0-9]{0,18}$/);
const head = z.strictObject({ bundleId: uuid, revision });
const market = z.literal('US');
export const staffInputSchemas = {
  prepareImport: z.strictObject({ artifactId: uuid }),
  publishImport: z.strictObject({
    bundleId: uuid,
    market,
    approvalId: uuid,
    expectedHead: head.nullable(),
    members: z
      .array(
        z.strictObject({
          key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
          kind: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
          datasetId: uuid,
        }),
      )
      .min(1)
      .max(16),
  }),
  rollbackImport: z.strictObject({ bundleId: uuid, market, approvalId: uuid, expectedHead: head }),
  recoverOperation: z.strictObject({
    kind: z.enum(['mail_reconcile', 'callback_replay', 'privacy_retry']),
    target: uuid,
    evidence: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  enqueueContent: z.strictObject({
    collection: z.enum(['articles', 'glossary-terms']),
    id: uuid,
    revision: z.number().int().min(1).max(2147483647),
    action: z.enum(['publish', 'withdraw']),
  }),
  auditSeo: z.strictObject({
    locale: z.literal('en-US'),
    market,
    after: z.string().max(2048).nullable().default(null),
  }),
};
