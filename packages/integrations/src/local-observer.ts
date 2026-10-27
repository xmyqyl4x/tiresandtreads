// Local operator telemetry only. No identities, error text or automated remediation cross this boundary.
export const healthCodes = [
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
] as const;
const checks = ['host_readiness', 'storage_fixture', 'workflow_freshness'] as const;
const queueReasons = ['backlog', 'lag', 'capacity', 'review_required'] as const;
type Component = (typeof healthCodes)[number] | (typeof checks)[number] | 'telemetry';
type Event = { component: Component; state: 'alert' | 'recovered'; reasons: string[] };
function receipt(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('ok' in input) ||
    input.ok !== true ||
    !('value' in input) ||
    !Array.isArray(input.value) ||
    input.value.length !== healthCodes.length
  )
    return null;
  const result = new Map<Component, string[]>();
  const queues: { code: string; queued: number; ageSeconds: number | null; capped: boolean }[] = [];
  for (const row of input.value) {
    if (
      !row ||
      typeof row !== 'object' ||
      !healthCodes.includes(row.code) ||
      result.has(row.code) ||
      !Number.isSafeInteger(row.queued) ||
      row.queued < 0 ||
      typeof row.capped !== 'boolean' ||
      (row.ageSeconds !== null && (!Number.isSafeInteger(row.ageSeconds) || row.ageSeconds < 0)) ||
      !Array.isArray(row.alerts) ||
      row.alerts.length > 4 ||
      new Set(row.alerts).size !== row.alerts.length ||
      row.alerts.some((a: unknown) => !queueReasons.some((r) => r === a))
    )
      return null;
    result.set(
      row.code,
      queueReasons.filter((r) => row.alerts.includes(r)),
    );
    queues.push({
      code: row.code,
      queued: row.queued,
      ageSeconds: row.ageSeconds,
      capped: row.capped,
    });
  }
  return { alarms: result, queues };
}
export function createLocalObserver(d: {
  readonly review: () => Promise<unknown>;
  readonly checks: Readonly<Record<(typeof checks)[number], () => Promise<boolean>>>;
  readonly now: () => number;
}) {
  const active = new Map<Component, string[]>();
  let running = false;
  return {
    async sample() {
      if (running) throw Error('Observer sample already running');
      running = true;
      try {
        const results = await Promise.allSettled([
          Promise.resolve().then(d.review),
          ...checks.map((k) => Promise.resolve().then(d.checks[k])),
        ]);
        const events: Event[] = [];
        const change = (component: Component, reasons: string[]) => {
          const previous = active.get(component);
          if (!reasons.length) {
            if (previous) {
              active.delete(component);
              events.push({ component, state: 'recovered', reasons: [] });
            }
          } else if (!previous || previous.join('|') !== reasons.join('|')) {
            active.set(component, reasons);
            events.push({ component, state: 'alert', reasons });
          }
        };
        const reviewed = results[0]!,
          input = reviewed.status === 'fulfilled' ? reviewed.value : null;
        const rows = receipt(input);
        const denied =
          input &&
          typeof input === 'object' &&
          'error' in input &&
          input.error &&
          typeof input.error === 'object' &&
          'code' in input.error &&
          input.error.code === 'forbidden';
        change('telemetry', rows ? [] : [denied ? 'access_denied' : 'unavailable']);
        // An unknown/denied snapshot never resolves an outstanding queue alert.
        if (rows) for (const [component, reasons] of rows.alarms) change(component, reasons);
        checks.forEach((component, i) => {
          const result = results[i + 1]!;
          change(
            component,
            result.status === 'fulfilled' && result.value === true ? [] : ['unavailable'],
          );
        });
        return {
          schemaVersion: 1,
          sampledAt: new Date(d.now()).toISOString(),
          fresh: rows !== null,
          queues: rows?.queues ?? null,
          healthy: rows !== null && active.size === 0,
          activeAlerts: [...active.keys()].sort(),
          events,
        };
      } finally {
        running = false;
      }
    },
  };
}
