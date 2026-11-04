import './browser-runtime.ts';
import { z } from 'zod';
export { z };
export const commercialPublishInputSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483647),
  policy: z.unknown(),
});
const uuid = z
  .string()
  .uuid()
  .refine((v) => v !== '00000000-0000-0000-0000-000000000000');
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => [...v].every((c) => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>'));
const cursor = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
  .nullable();
const publicPath = z
  .string()
  .max(500)
  .regex(/^(\/|\/(learn|guides|glossary|tires\/models|tires\/sizes)\/[a-z0-9]+(-[a-z0-9]+)*)$/);
export const queueViewSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: uuid, state: text(40), dueAt: z.iso.datetime().nullable() }))
    .max(100),
  next: uuid.nullable(),
});
export const reportQueueViewSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: uuid, state: text(40), updatedAt: z.iso.datetime() }))
    .max(100),
  next: cursor,
});
export const strategicRegisterViewSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: uuid,
        path: publicPath,
        canonical: publicPath,
        status: z.enum(['draft', 'eligible', 'noindex', 'removed']),
        reviewDue: z.iso.datetime(),
      }),
    )
    .max(100),
  next: cursor,
});
// Wire shape only. The existing commercial domain/service retains policy, time, route and review decisions.
export const commercialPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  accountId: uuid.nullable(),
  adsTxt: z.array(text(500)).max(50),
  blockedCategories: z.array(text(100)).max(100),
  blockedUrls: z.array(z.url().max(2048)).max(100),
  slots: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        route: z.enum(['education', 'glossary', 'tire_model', 'tire_size']),
        width: z.number().int().min(1).max(2000),
        height: z.number().int().min(1).max(2000),
        housePath: publicPath,
        houseLabel: text(100),
      }),
    )
    .max(8),
});
export const commercialConfigurationViewSchema = z
  .strictObject({
    version: z.number().int().min(0).max(2147483647),
    policy: commercialPolicySchema.nullable(),
    networkReady: z.boolean(),
  })
  .refine((v) => (v.version === 0 ? v.policy === null && !v.networkReady : v.policy !== null));
const rights = z.strictObject({
  display: z.boolean(),
  api: z.boolean(),
  cache: z.boolean(),
  derived: z.boolean(),
  snapshot: z.boolean(),
});
export const sourceHealthViewSchema = z.strictObject({
  asOf: z.iso.datetime(),
  actualCoverage: z.literal('unconfirmed'),
  next: uuid.nullable(),
  bundle: z
    .strictObject({
      id: uuid,
      market: z.literal('US'),
      completeness: z.enum(['available', 'partial', 'unavailable']),
      components: z
        .array(
          z.strictObject({
            key: text(80),
            datasetId: uuid,
            kind: text(80),
            fetchedAt: z.iso.datetime(),
            expiresAt: z.iso.datetime().nullable(),
            freshness: z.enum(['fresh', 'stale', 'unknown']),
            rights,
          }),
        )
        .max(16),
    })
    .nullable(),
  sources: z
    .array(
      z.strictObject({
        key: text(80),
        kind: text(80),
        enabled: z.boolean(),
        state: z.enum(['disabled', 'not_ready', 'scheduled', 'due', 'attention']),
        lastRunState: text(40).nullable(),
        lastAttemptAt: z.iso.datetime().nullable(),
        lastSucceededAt: z.iso.datetime().nullable(),
        nextDueAt: z.iso.datetime().nullable(),
      }),
    )
    .max(100),
});
export type QueueView = z.infer<typeof queueViewSchema>;
export type ReportQueueView = z.infer<typeof reportQueueViewSchema>;
export type StrategicRegisterView = z.infer<typeof strategicRegisterViewSchema>;
export type CommercialConfigurationView = z.infer<typeof commercialConfigurationViewSchema>;
export type SourceHealthView = z.infer<typeof sourceHealthViewSchema>;
export const seoFindingsViewSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: uuid,
        pageId: uuid,
        rule: text(100),
        severity: z.enum(['info', 'warning', 'error']),
        state: z.enum(['open', 'resolved', 'waived']),
        detectedAt: z.iso.datetime(),
      }),
    )
    .max(100),
  next: cursor,
});
const count = z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
  signed = z.string().regex(/^-?(0|[1-9][0-9]{0,18})$/);
const aggregate = z
  .strictObject({
    value: count,
    generation: count,
    pending: z.boolean(),
    computedAt: z.iso.datetime().nullable(),
  })
  .nullable();
export const operationsViewSchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimension: z.enum(['all', 'web', 'app', 'mcp']),
  market: z.literal('US'),
  events: aggregate,
  dailyDistinctSessions: aggregate,
  coverage: z.literal('consented traffic only'),
  currency: z.null(),
  health: z.strictObject({
    sampledAt: z.iso.datetime(),
    analyticsPending: z.number().int().nonnegative(),
    sendsQueued: z.number().int().nonnegative(),
    sendsUncertain: z.number().int().nonnegative(),
    outboxPending: z.number().int().nonnegative(),
    quotaRows: z.number().int().nonnegative(),
    quotaCapacity: z.number().int().positive(),
    capped: z.boolean(),
  }),
});
const adMetric = z.strictObject({
  day: z.string(),
  dimension: text(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  impressions: count,
  eligibleRequests: count.nullable(),
  revenueMinor: signed,
  revenueStatus: z.enum(['estimated', 'finalized']),
  viewableImpressions: count.nullable(),
  consentRequests: count.nullable(),
  totalRequests: count.nullable(),
  latencySamples: count.nullable(),
  latencyTotalMs: count.nullable(),
  sourceRevision: text(200),
  sourceGeneration: count,
  fetchedAt: z.iso.datetime(),
});
export const revenueViewSchema = z.strictObject({
  status: z.enum(['not_connected', 'not_reported', 'reported']),
  account: uuid,
  day: z.string(),
  dimension: text(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  metric: adMetric.nullable(),
  fillBasisPoints: signed.nullable(),
  rpmMinor: signed.nullable(),
  viewabilityBasisPoints: signed.nullable(),
  consentCoverageBasisPoints: signed.nullable(),
  meanLatencyMs: signed.nullable(),
  measurement: z.literal('provider aggregates; missing measurements remain unavailable'),
});
export type SeoFindingsView = z.infer<typeof seoFindingsViewSchema>;
export type OperationsView = z.infer<typeof operationsViewSchema>;
export type RevenueView = z.infer<typeof revenueViewSchema>;
