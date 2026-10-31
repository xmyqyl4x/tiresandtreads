import { createHash } from 'node:crypto';
import { readJson } from '../multitarget-plan/json.ts';

export function refused(): never {
  throw Error('Disposable TLS admission refused');
}
export function must(value: unknown): asserts value {
  if (!value) refused();
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  must(value && typeof value === 'object' && !Array.isArray(value));
  must(Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k)));
}
function hex(value: unknown, length: number): asserts value is string {
  must(typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function digest(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b, 'en'))
              .map(([k, x]) => [k, normalize(x)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}
export type Endpoint = Readonly<{
  slot: 0 | 1;
  kind: 'app' | 'cms';
  host: string;
  database: string;
  user: string;
  password: string;
  baseline: string;
}>;
export function admit(
  raw: unknown,
  privateRaw: unknown,
  env: Readonly<Record<string, string | undefined>>,
) {
  try {
    for (const key of ['APP_ENV', 'PROVIDER_MODE', 'ISOLATED_TEST_PROJECT']) {
      const d = Object.getOwnPropertyDescriptor(env, key);
      must(d && Object.hasOwn(d, 'value') && typeof d.value === 'string');
    }
    must(
      env.APP_ENV === 'test-local' &&
        env.PROVIDER_MODE === 'fixtures' &&
        /^tt-test-[a-f0-9]{16}$/.test(env.ISOLATED_TEST_PROJECT ?? ''),
    );
    must(
      !Object.keys(env).some(
        (k) =>
          k.startsWith('PG') ||
          ['NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS'].includes(k),
      ),
    );
    const p = readJson(raw, 4096),
      o = readJson(privateRaw, 32768);
    exact(p, ['version', 'scope', 'project', 'fixtureGeneration', 'domains']);
    exact(o, ['version', 'scope', 'project', 'fixtureGeneration', 'caSha256', 'owners']);
    must(
      p.version === 1 &&
        p.scope === 'disposable-readonly-multitarget-plan' &&
        p.project === env.ISOLATED_TEST_PROJECT,
    );
    hex(p.fixtureGeneration, 32);
    must(
      o.version === 1 &&
        o.scope === 'private-tls-admission' &&
        o.project === p.project &&
        o.fixtureGeneration === p.fixtureGeneration,
    );
    hex(o.caSha256, 64);
    must(
      Array.isArray(p.domains) &&
        p.domains.length === 2 &&
        Array.isArray(o.owners) &&
        o.owners.length === 4,
    );
    const slots = p.domains
      .map((d) => {
        exact(d, ['slot', 'purpose']);
        must((d.slot === 0 && d.purpose === 'source') || (d.slot === 1 && d.purpose === 'target'));
        return d.slot;
      })
      .sort();
    must(slots[0] === 0 && slots[1] === 1);
    const endpoints = o.owners
      .map((item) => {
        exact(item, ['slot', 'kind', 'password', 'baseline']);
        must((item.slot === 0 || item.slot === 1) && (item.kind === 'app' || item.kind === 'cms'));
        hex(item.password, 64);
        hex(item.baseline, 64);
        return {
          slot: item.slot,
          kind: item.kind,
          host: item.slot === 0 ? 'postgres.preflight.test' : 'recovery-postgres.preflight.test',
          database: `tt_${item.kind}_recovery`,
          user: `tt_${item.kind}_migrator`,
          password: item.password,
          baseline: item.baseline,
        } as Endpoint;
      })
      .sort((a, b) => a.slot - b.slot || a.kind.localeCompare(b.kind));
    must(endpoints.map((e) => `${e.slot}/${e.kind}`).join(',') === '0/app,0/cms,1/app,1/cms');
    return freeze({
      project: p.project as string,
      generation: p.fixtureGeneration,
      caSha256: o.caSha256,
      endpoints,
    });
  } catch {
    return refused();
  }
}
export function budget(start: number, now: number) {
  must(
    Number.isFinite(start) &&
      Number.isFinite(now) &&
      start >= 0 &&
      now >= start &&
      now - start < 4000,
  );
  return Math.max(1, Math.min(1500, Math.floor(4000 - (now - start))));
}
export function checkFacts(row: unknown, e: Endpoint) {
  must(row && typeof row === 'object');
  const r = row as Record<string, unknown>;
  must(
    r.actor === e.user &&
      r.session_actor === e.user &&
      r.database === e.database &&
      r.owner === e.user &&
      r.version === 180006 &&
      r.readonly === 'on' &&
      r.isolation === 'repeatable read' &&
      r.tls === true,
  );
  return true;
}
export function mapping(raw: unknown, project: string, generation: string, nonce: string) {
  try {
    const r = readJson(raw, 2048);
    exact(r, ['version', 'project', 'fixtureGeneration', 'nonce', 'current', 'binding']);
    must(
      r.version === 1 &&
        r.project === project &&
        r.fixtureGeneration === generation &&
        r.nonce === nonce &&
        r.current === true,
    );
    hex(r.binding, 64);
    return r.binding;
  } catch {
    return refused();
  }
}
export const evidenceFlags = Object.freeze({
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
