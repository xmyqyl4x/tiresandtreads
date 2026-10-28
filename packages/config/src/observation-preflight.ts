import { z } from 'zod';
export const components = [
  'analytics',
  'callbacks',
  'deliveries',
  'outbox',
  'privacy_notifications',
  'privacy_overdue',
  'privacy_work',
  'quota_capacity',
  'recovery_unknown',
  'uncertain_mail',
  'host_readiness',
  'storage_fixture',
  'workflow_freshness',
  'telemetry',
  'database_capacity',
  'capacity_telemetry',
] as const;
export const observationReasons = [
  'backlog',
  'lag',
  'capacity',
  'review_required',
  'unavailable',
  'access_denied',
  'overbooked',
] as const;
export const capacityEvidenceSchema = z
  .object({
    raw: z.number().int().positive().max(1000000),
    superReserved: z.number().int().nonnegative(),
    roleReserved: z.number().int().nonnegative(),
    required: z.number().int().positive().max(1000000),
    backends: z.number().int().nonnegative().max(1000000),
    sampledAt: z.string().max(30),
  })
  .strict();
export const alertSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: z.string().regex(/^tt-test-[a-f0-9]{16}$/),
    id: z.uuid(),
    component: z.enum(components),
    state: z.enum(['alert', 'recovered']),
    reasons: z.array(z.enum(observationReasons)).max(4),
    at: z.iso.datetime(),
  })
  .strict();
export const acknowledgementSchema = z
  .object({
    id: z.uuid(),
    project: z.string().regex(/^tt-test-[a-f0-9]{16}$/),
    accepted: z.literal(true),
  })
  .strict();
export type FixtureAlert = z.infer<typeof alertSchema>;
const at = z.number().int().nonnegative().max(8640000000000000);
export const responseInputSchema = z
  .object({
    healthy: z.boolean(),
    fresh: z.boolean(),
    activeAlerts: z.array(z.enum(components)).max(16),
    events: z
      .array(
        z
          .object({
            component: z.enum(components),
            state: z.enum(['alert', 'recovered']),
            reasons: z.array(z.enum(observationReasons)).max(4),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export const responseJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: z.string().regex(/^tt-test-[a-f0-9]{16}$/),
    incidents: z
      .array(
        z
          .object({
            id: z.uuid(),
            component: z.enum(components),
            open: z.boolean(),
            reasons: z.array(z.enum(observationReasons)).max(4),
            openedAt: at,
            acknowledgedAt: at.nullable(),
            escalatedAt: at.nullable(),
            resolvedAt: at.nullable(),
          })
          .strict(),
      )
      .max(16),
    events: z
      .array(
        z
          .object({
            message: alertSchema,
            status: z.enum(['pending', 'delivered', 'failed']),
            attempts: z.number().int().min(0).max(3),
            nextAttemptAt: at,
          })
          .strict(),
      )
      .max(96),
  })
  .strict();
export type ResponseJournal = z.infer<typeof responseJournalSchema>;
