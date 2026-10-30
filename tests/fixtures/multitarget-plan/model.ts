import { readJson, refused } from './json.ts';

// Synthetic, synchronous test support. No SQL, filesystem/network, target lookup,
// callbacks, executor, TLS configuration, journal backend or production import.
const keys = [
  'common:0',
  'common:1',
  'inner:0:app',
  'inner:0:cms',
  'inner:1:app',
  'inner:1:cms',
] as const;
const reads = ['0/app', '0/cms', '1/app', '1/cms'] as const;
type Key = (typeof keys)[number];
type Endpoint = (typeof reads)[number];
type Data = Record<string, unknown>;
type Environment = Readonly<Record<string, string | undefined>>;
function exact(value: unknown, fields: readonly string[]): asserts value is Data {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    refused();
}
function must(condition: unknown): asserts condition {
  if (!condition) refused();
}
function reference(value: unknown): asserts value is string {
  must(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value));
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function field(env: Environment, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  must(descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string');
  return descriptor.value as string;
}
export const evidenceFlags = frozen({
  simulated: true,
  actualSqlConnections: 0,
  actualFixtureExecutions: 0,
  lifecycleMutationDispatches: 0,
  providerDispatches: 0,
  actualRecipientNotifications: 0,
  productionPolicyChanged: false,
  independentDurability: false,
  authenticated: false,
  targetFencing: false,
  runtimeAdmission: false,
  hostedAccepted: false,
  productActivation: false,
  casesClosed: 0,
  gatesClosed: 0,
});

export function admitPlan(raw: unknown, bindingRaw: unknown, env: Environment) {
  try {
    const p = readJson(raw, 4096),
      b = readJson(bindingRaw, 8192);
    exact(p, ['version', 'scope', 'project', 'fixtureGeneration', 'domains']);
    exact(b, ['version', 'scope', 'project', 'fixtureGeneration', 'domains']);
    must(field(env, 'APP_ENV') === 'test-local' && field(env, 'PROVIDER_MODE') === 'fixtures');
    const project = field(env, 'ISOLATED_TEST_PROJECT');
    must(/^tt-test-[a-f0-9]{16}$/.test(project));
    must(
      p.version === 1 &&
        p.scope === 'disposable-readonly-multitarget-plan' &&
        p.project === project,
    );
    reference(p.fixtureGeneration);
    must(
      b.version === 1 &&
        b.scope === 'synthetic-multitarget-bindings' &&
        b.project === project &&
        b.fixtureGeneration === p.fixtureGeneration,
    );
    must(
      Array.isArray(p.domains) &&
        p.domains.length === 2 &&
        Array.isArray(b.domains) &&
        b.domains.length === 2,
    );
    const domains = p.domains
      .map((d: unknown) => {
        exact(d, ['slot', 'purpose']);
        must((d.slot === 0 && d.purpose === 'source') || (d.slot === 1 && d.purpose === 'target'));
        return { slot: d.slot as 0 | 1, purpose: d.purpose as 'source' | 'target' };
      })
      .sort((a, b) => a.slot - b.slot);
    must(domains[0]!.slot === 0 && domains[1]!.slot === 1);
    const bindings = b.domains
      .map((d: unknown) => {
        exact(d, [
          'slot',
          'service',
          'containerRef',
          'volumeRef',
          'credentialGeneration',
          'tlsGeneration',
        ]);
        must(
          (d.slot === 0 && d.service === 'postgres') ||
            (d.slot === 1 && d.service === 'recovery-postgres'),
        );
        must(
          typeof d.containerRef === 'string' &&
            /^synthetic-container:[a-f0-9]{64}$/.test(d.containerRef),
        );
        must(
          typeof d.volumeRef === 'string' && /^synthetic-volume:[a-f0-9]{32}$/.test(d.volumeRef),
        );
        reference(d.credentialGeneration);
        reference(d.tlsGeneration);
        return {
          slot: d.slot as 0 | 1,
          service: d.service as string,
          containerRef: d.containerRef,
          volumeRef: d.volumeRef,
          credentialGeneration: d.credentialGeneration,
          tlsGeneration: d.tlsGeneration,
        };
      })
      .sort((a, b) => a.slot - b.slot);
    must(bindings[0]!.slot === 0 && bindings[1]!.slot === 1);
    must(
      bindings[0]!.containerRef !== bindings[1]!.containerRef &&
        bindings[0]!.volumeRef !== bindings[1]!.volumeRef,
    );
    const canonicalPlan = JSON.stringify({
      version: 1,
      scope: p.scope,
      project,
      fixtureGeneration: p.fixtureGeneration,
      domains,
    });
    const canonicalBindings = JSON.stringify({
      version: 1,
      scope: b.scope,
      project,
      fixtureGeneration: b.fixtureGeneration,
      domains: bindings,
    });
    const allocations = keys.map((key) => {
      const parts = key.split(':');
      const slot = Number(parts[1]) as 0 | 1;
      const target = parts[2] === 'cms' ? 'cms' : 'app';
      return {
        key,
        slot,
        service: bindings[slot]!.service,
        database: `tt_${target}_recovery`,
        role: `tt_${target}_migrator`,
      };
    });
    return frozen({
      canonicalPlan,
      canonicalBindings,
      project,
      fixtureGeneration: p.fixtureGeneration,
      allocations,
    });
  } catch {
    return refused();
  }
}

type Event =
  | { type: 'acquire'; key: Key; outcome: 'held' | 'busy' | 'unavailable' }
  | { type: 'read-start'; endpoint: Endpoint }
  | { type: 'read-complete'; endpoint: Endpoint; outcome: 'observed' | 'unavailable' }
  | { type: 'loss'; slot: 0 | 1 }
  | { type: 'close'; key: Key; outcome: 'closed' | 'unknown' };
function event(raw: unknown): Event {
  const e = readJson(raw, 1024);
  must(e && typeof e === 'object' && !Array.isArray(e) && 'type' in e);
  const value = e as Data;
  if (value.type === 'acquire') {
    exact(value, ['type', 'key', 'outcome']);
    must(
      keys.includes(value.key as Key) &&
        ['held', 'busy', 'unavailable'].includes(value.outcome as string),
    );
  } else if (value.type === 'read-start') {
    exact(value, ['type', 'endpoint']);
    must(reads.includes(value.endpoint as Endpoint));
  } else if (value.type === 'read-complete') {
    exact(value, ['type', 'endpoint', 'outcome']);
    must(
      reads.includes(value.endpoint as Endpoint) &&
        ['observed', 'unavailable'].includes(value.outcome as string),
    );
  } else if (value.type === 'loss') {
    exact(value, ['type', 'slot']);
    must(value.slot === 0 || value.slot === 1);
  } else if (value.type === 'close') {
    exact(value, ['type', 'key', 'outcome']);
    must(
      keys.includes(value.key as Key) && ['closed', 'unknown'].includes(value.outcome as string),
    );
  } else refused();
  return value as Event;
}

export function createModel(
  raw: unknown,
  bindingRaw: unknown,
  env: Environment,
  startedAt: number,
) {
  const admission = admitPlan(raw, bindingRaw, env);
  must(Number.isSafeInteger(startedAt) && startedAt >= 0);
  const held: Key[] = [],
    closed: Key[] = [],
    unknown: Key[] = [];
  const trace: string[] = [];
  let failure = '',
    allocation = 0,
    reading = 0,
    inflight: Endpoint | undefined;
  let late = 0,
    workUnknown = false,
    last = startedAt,
    terminal = false;
  let observations: Endpoint[] = [];
  const fail = (reason: string) => {
    failure ||= reason;
    observations = [];
  };
  const readyToClose = () => !!failure || reading === reads.length;
  const disposition = () => {
    if (inflight) return 'awaiting_modeled_read' as const;
    if (readyToClose() && held.length) return 'awaiting_modeled_cleanup' as const;
    if (failure) return 'model_refused' as const;
    if (reading === reads.length && !held.length) return 'model_evidence_only' as const;
    return 'model_in_progress' as const;
  };
  const receipt = () =>
    frozen({
      scope: 'synthetic-multitarget-plan',
      disposition: disposition(),
      reason: failure || 'synthetic-only',
      simulatedHeld: [...held],
      simulatedClosed: [...closed],
      simulatedCleanupUnknown: [...unknown],
      simulatedObservations: [...observations],
      simulatedWorkUnknown: workUnknown,
      lateReadCompletions: late,
      trace: [...trace],
      ...evidenceFlags,
    });
  return Object.freeze({
    receipt,
    observe(rawEvent: unknown, now: number, currentBindings: unknown, currentEnv: Environment) {
      if (terminal) return refused();
      try {
        const e = event(rawEvent);
        const completing = e.type === 'read-complete',
          cleaning = e.type === 'close';
        must(Number.isSafeInteger(now) && now >= last);
        last = now;
        let current = false;
        try {
          const fresh = admitPlan(admission.canonicalPlan, currentBindings, currentEnv);
          current = fresh.canonicalBindings === admission.canonicalBindings;
        } catch {
          /* Changed context is a refusal, not a lookup or repair. */
        }
        if (!current) fail('binding');
        if (now - startedAt >= 4000) fail('deadline');
        if (trace.length >= 64) fail('event-budget');
        if (!current || failure) must(completing || cleaning || e.type === 'loss');
        if (e.type === 'acquire') {
          must(!readyToClose() && !inflight && e.key === keys[allocation]);
          if (e.outcome !== 'held') fail(e.outcome);
          else {
            held.push(e.key);
            allocation++;
          }
        } else if (e.type === 'read-start') {
          must(
            allocation === keys.length && !inflight && !failure && e.endpoint === reads[reading],
          );
          inflight = e.endpoint;
        } else if (e.type === 'read-complete') {
          must(inflight === e.endpoint);
          if (e.outcome === 'unavailable') {
            workUnknown = true;
            fail('read-unavailable');
          } else if (failure) late++;
          else {
            observations.push(e.endpoint);
            reading++;
          }
          inflight = undefined;
        } else if (e.type === 'loss') {
          must(held.includes(e.slot === 0 ? 'common:0' : 'common:1'));
          fail('coordinator-lost');
        } else {
          must(readyToClose() && !inflight && held.at(-1) === e.key);
          held.pop();
          if (e.outcome === 'unknown') {
            unknown.push(e.key);
            fail('cleanup-unknown');
          } else closed.push(e.key);
        }
        if (trace.length < 64)
          trace.push(e.type + ':' + ('key' in e ? e.key : 'endpoint' in e ? e.endpoint : e.slot));
        terminal = !inflight && !held.length && readyToClose();
        return receipt();
      } catch {
        fail('invalid-event');
        return refused();
      }
    },
  });
}
