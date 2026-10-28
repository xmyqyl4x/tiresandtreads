import { capacityEvidenceSchema } from '../../packages/config/src/observation-preflight.ts';
import { createLocalObserver } from '../../packages/integrations/src/local-observer.ts';
import { postgresCapacity } from '../../packages/config/src/postgres-capacity.ts';

const dependencies = ['host_readiness', 'storage_fixture', 'workflow_freshness'] as const;
function age(stamp: unknown, now: number) {
  if (typeof stamp !== 'string' || stamp.length !== 24 || !Number.isSafeInteger(now)) throw Error();
  const at = Date.parse(stamp);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== stamp || at > now + 1000)
    throw Error();
  return now - at;
}
function fresh(stamp: unknown, now: number) {
  if (age(stamp, now) > 10000) throw Error();
}
export function capacityReading(input: unknown, now: number, threshold: number) {
  try {
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10000) throw Error();
    const s = capacityEvidenceSchema.parse(input);
    fresh(s.sampledAt, now);
    const c = postgresCapacity(s.raw, s.superReserved, s.roleReserved, 1),
      usedBasisPoints = Math.floor((s.backends * 10000) / c.usableCapacity);
    return {
      raw: c.capacity,
      serverReserved: c.serverReserved,
      usable: c.usableCapacity,
      required: s.required,
      observedDatabaseBackends: s.backends,
      usedBasisPoints,
      unallocatedUsable: c.usableCapacity - s.required,
      reasons: [
        ...(usedBasisPoints >= threshold ? ['capacity'] : []),
        ...(s.required > c.usableCapacity ? ['overbooked'] : []),
      ],
    };
  } catch {
    throw Error('Observation evidence unavailable');
  }
}
export function createFreshObserver(d: {
  review: () => Promise<unknown>;
  readCapacity: () => Promise<unknown>;
  checks: Record<(typeof dependencies)[number], () => Promise<unknown>>;
  now: () => number;
  capacityThreshold: number;
}) {
  if (
    !Number.isInteger(d.capacityThreshold) ||
    d.capacityThreshold < 1 ||
    d.capacityThreshold > 10000
  )
    throw Error('Invalid observation threshold');
  const status: Record<
    (typeof dependencies)[number],
    'healthy' | 'unhealthy' | 'stale' | 'unavailable'
  > = {
    host_readiness: 'unavailable',
    storage_fixture: 'unavailable',
    workflow_freshness: 'unavailable',
  };
  const checks = Object.fromEntries(
    dependencies.map((key) => [
      key,
      async () => {
        try {
          const v = await d.checks[key]();
          if (
            !v ||
            typeof v !== 'object' ||
            !('healthy' in v) ||
            typeof v.healthy !== 'boolean' ||
            !('sampledAt' in v)
          )
            throw Error();
          if (age(v.sampledAt, d.now()) > 10000) {
            status[key] = 'stale';
            return false;
          }
          status[key] = v.healthy ? 'healthy' : 'unhealthy';
          return v.healthy;
        } catch {
          status[key] = 'unavailable';
          return false;
        }
      },
    ]),
  ) as Record<(typeof dependencies)[number], () => Promise<boolean>>;
  const base = createLocalObserver({
    review: async () => {
      const value = await d.review();
      if (value && typeof value === 'object' && 'ok' in value && value.ok === true) {
        if (!('value' in value) || !Array.isArray(value.value) || value.value.length !== 10)
          throw Error();
        for (const row of value.value) fresh(row?.sampledAt, d.now());
      }
      return value;
    },
    checks,
    now: d.now,
  });
  const active = new Map<string, string[]>();
  let running = false;
  return {
    async sample() {
      if (running) throw Error('Observation already running');
      running = true;
      try {
        const [sample, result] = await Promise.all([
          base.sample(),
          Promise.resolve()
            .then(d.readCapacity)
            .then((v) => capacityReading(v, d.now(), d.capacityThreshold))
            .catch(() => null),
        ]);
        const events: { component: string; state: 'alert' | 'recovered'; reasons: string[] }[] = [
          ...sample.events,
        ];
        const change = (component: string, reasons: string[]) => {
          const old = active.get(component);
          if (!reasons.length) {
            if (old) {
              active.delete(component);
              events.push({ component, state: 'recovered', reasons: [] });
            }
          } else if (!old || old.join('|') !== reasons.join('|')) {
            active.set(component, reasons);
            events.push({ component, state: 'alert', reasons });
          }
        };
        change('capacity_telemetry', result ? [] : ['unavailable']);
        if (result) change('database_capacity', result.reasons);
        return {
          ...sample,
          capacity: result,
          fresh: sample.fresh && result !== null,
          dependencyStatus: { ...status },
          healthy: sample.healthy && result !== null && active.size === 0,
          activeAlerts: [...sample.activeAlerts, ...active.keys()].sort(),
          events,
        };
      } finally {
        running = false;
      }
    },
  };
}
export type Observation = Awaited<ReturnType<ReturnType<typeof createFreshObserver>['sample']>>;
