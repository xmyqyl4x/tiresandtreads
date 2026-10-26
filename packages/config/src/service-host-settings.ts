import { z } from 'zod';
import { validateServiceHostPlan, type ServiceHostPlan } from './service-host-plan.ts';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const values = z
  .record(version, hex)
  .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 4);
const ring = z
  .strictObject({ current: version, values })
  .refine((v) => Object.hasOwn(v.values, v.current));
const action = z.enum([
  'callbacks',
  'publication',
  'privacy',
  'analytics',
  'quotas',
  'retention',
  'assets',
]);
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  plan: z.strictObject({
    urls: z.record(z.string(), z.string()),
    max: z.record(z.string(), z.number()),
    replicas: z.number(),
    reserve: z.number(),
    external: z.array(
      z.strictObject({
        name: z.string(),
        database: z.enum(['application', 'cms']),
        max: z.number(),
        replicas: z.number(),
      }),
    ),
  }),
  keys: z.strictObject({
    token: ring,
    report: ring,
    privacy: ring,
    collection: ring,
    lookup: values,
    contactIdentity: hex,
    reportIdentity: hex,
    collectionIdentity: hex,
  }),
  policy: z.strictObject({
    fixture: z.literal(true),
    version,
    privacyVersion: version,
    jurisdiction: version,
    notices: z.strictObject({
      report: z.uuid(),
      offers: z.uuid(),
      analytics: z.uuid(),
      ads: z.uuid(),
      targeted_ads: z.uuid(),
      necessary: z.uuid(),
    }),
    templateId: z.uuid(),
    rendererHash: hex,
  }),
  origin: z.string().url(),
  maintenance: z.strictObject({
    enabled: z.array(action).max(7),
    cycle: z.array(action).min(1).max(4),
  }),
});
export function readServiceHostSettings(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw Error('Invalid local service host settings');
  const p = parsed.data,
    plan = p.plan as unknown as ServiceHostPlan;
  validateServiceHostPlan(plan);
  const origin = new URL(p.origin);
  if (
    origin.protocol !== 'https:' ||
    !/^[a-z0-9.-]+\.test$/.test(origin.hostname) ||
    origin.port !== '' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    new Set(p.maintenance.enabled).size !== p.maintenance.enabled.length ||
    new Set(p.maintenance.cycle).size !== p.maintenance.cycle.length
  )
    throw Error('Invalid local service host settings');
  return Object.freeze({ ...p, plan });
}
export type ServiceHostSettings = ReturnType<typeof readServiceHostSettings>;
