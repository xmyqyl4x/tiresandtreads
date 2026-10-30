import { expect, it } from 'vitest';
import { admitPlan, createModel, evidenceFlags } from '../fixtures/multitarget-plan/model.ts';
import { readJson } from '../fixtures/multitarget-plan/json.ts';
import {
  environment,
  plan,
  bindings,
  json,
  allocationOrder,
} from '../fixtures/multitarget-plan/samples.ts';

const refusal = /^Synthetic multi-target model refused$/;
function admit(
  raw: unknown = json(plan()),
  binding: unknown = json(bindings()),
  env = environment(),
) {
  return admitPlan(raw, binding, env);
}

it('canonicalizes either input enumeration to the same fixed common-before-inner order', () => {
  const first = admit();
  const reversed = plan();
  reversed.domains.reverse();
  const second = bindings();
  second.domains.reverse();
  expect(admit(json(reversed), json(second))).toEqual(first);
  expect(first.allocations.map((entry) => entry.key)).toEqual(allocationOrder);
  expect(first.allocations.map((entry) => [entry.service, entry.database, entry.role])).toEqual([
    ['postgres', 'tt_app_recovery', 'tt_app_migrator'],
    ['recovery-postgres', 'tt_app_recovery', 'tt_app_migrator'],
    ['postgres', 'tt_app_recovery', 'tt_app_migrator'],
    ['postgres', 'tt_cms_recovery', 'tt_cms_migrator'],
    ['recovery-postgres', 'tt_app_recovery', 'tt_app_migrator'],
    ['recovery-postgres', 'tt_cms_recovery', 'tt_cms_migrator'],
  ]);
});

it('detaches UTF-8 inputs and freezes every admitted descriptor', () => {
  const bytes = new TextEncoder().encode(json(plan()));
  const admitted = admit(bytes);
  bytes.fill(0);
  expect(admitted.canonicalPlan).toBe(json(plan()));
  expect(Object.isFrozen(admitted)).toBe(true);
  expect(Object.isFrozen(admitted.allocations)).toBe(true);
  expect(admitted.allocations.every(Object.isFrozen)).toBe(true);
});

it.each([
  { version: 2 },
  { scope: 'production' },
  { project: 'tt-dev' },
  { fixtureGeneration: 'b'.repeat(32) },
  { domains: [] },
  { domains: [{ slot: 0, purpose: 'source' }] },
  {
    domains: [
      { slot: 0, purpose: 'source' },
      { slot: 0, purpose: 'target' },
    ],
  },
  {
    domains: [
      { slot: 0, purpose: 'target' },
      { slot: 1, purpose: 'source' },
    ],
  },
  {
    domains: [
      { slot: 0, purpose: 'source' },
      { slot: 2, purpose: 'target' },
    ],
  },
  {
    domains: [
      { slot: 0, purpose: 'source', host: 'localhost' },
      { slot: 1, purpose: 'target' },
    ],
  },
  { domains: [...plan().domains, { slot: 2, purpose: 'target' }] },
  { url: 'postgresql://private/retained' },
  { ca: 'private material' },
  { sql: 'SELECT private' },
  { key: [1, 2] },
  { timeout: 0 },
  { pid: 123 },
  { role: 'local_harness' },
  { program: 'other.ts' },
  { receipt: {} },
  { journal: [] },
  { archive: 'app.dump' },
])('refuses an expanded or mismatched plan %# without reflecting private values', (patch) => {
  expect(() => admit(json({ ...plan(), ...patch }))).toThrow(refusal);
});

it.each([
  '',
  'null',
  '[]',
  json(plan()) + ' false',
  '\ufeff' + json(plan()),
  json(plan()).replace('"version":1', '"version":01'),
  json(plan()).replace('"version":1', '"version":1e999'),
  json(plan()).replace('"slot":0', '"slot":-0'),
  json(plan()).replace('"version":1', '"version":1,"version":1'),
  json(plan()).replace('"version":1', '"version":1,"\\u0076ersion":1'),
  json(plan()).replace('"slot":0', '"slot":0,"\\u0073lot":0'),
  json(plan()).replace('"purpose":"source"', '"purpose":"source","purpose":"source"'),
  json(plan()).replace('"scope":', '"scope":"\\ud800","extra":'),
  '{"x":' + '['.repeat(12) + '0' + ']'.repeat(12) + '}',
  ' '.repeat(4097),
  json(plan()) + ' '.repeat(4096),
  '{"x":"' + 'a'.repeat(513) + '"}',
  '{"x":[' + '0,'.repeat(130) + '0]}',
  json(plan()).replace('"source"', '"source",'),
  new Uint8Array([0xc3, 0x28]),
  { ...plan() },
])('refuses malformed duplicate oversized or unsupported raw input %#', (raw) => {
  expect(() => admit(raw)).toThrow(refusal);
});

it.each([
  (b: ReturnType<typeof bindings>) => ({ ...b, version: 2 }),
  (b: ReturnType<typeof bindings>) => ({ ...b, scope: 'actual-cluster-authentication' }),
  (b: ReturnType<typeof bindings>) => ({ ...b, project: 'tt-stage' }),
  (b: ReturnType<typeof bindings>) => ({ ...b, fixtureGeneration: 'b'.repeat(32) }),
  (b: ReturnType<typeof bindings>) => ({ ...b, domains: b.domains.slice(0, 1) }),
  (b: ReturnType<typeof bindings>) => ({ ...b, password: 'private' }),
  (b: ReturnType<typeof bindings>) => ({ ...b, held: [] }),
  (b: ReturnType<typeof bindings>) => ({ ...b, domains: [b.domains[0], b.domains[0]] }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, service: 'postgres' })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, containerRef: b.domains[0]!.containerRef })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, volumeRef: b.domains[0]!.volumeRef })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, containerRef: 'f'.repeat(64) })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, volumeRef: 'retained-volume' })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, tlsGeneration: '' })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, credentialGeneration: 'x'.repeat(32) })),
  }),
  (b: ReturnType<typeof bindings>) => ({
    ...b,
    domains: b.domains.map((d) => ({ ...d, host: 'localhost' })),
  }),
])('refuses missing aliased retained expanded or mismatched synthetic binding %#', (change) => {
  expect(() => admit(json(plan()), json(change(bindings())))).toThrow(refusal);
});

it.each([
  { APP_ENV: 'dev-local' },
  { APP_ENV: 'stage-local' },
  { PROVIDER_MODE: 'live' },
  { ISOLATED_TEST_PROJECT: 'tt-test-bbbbbbbbbbbbbbbb' },
])('refuses an environment mismatch %#', (patch) => {
  expect(() => admit(json(plan()), json(bindings()), { ...environment(), ...patch })).toThrow(
    refusal,
  );
});

it('does not execute an environment getter as an admission mechanism', () => {
  let invoked = false;
  const env = environment();
  Object.defineProperty(env, 'APP_ENV', {
    get() {
      invoked = true;
      return 'test-local';
    },
  });
  expect(() => admit(json(plan()), json(bindings()), env)).toThrow(refusal);
  expect(invoked).toBe(false);
});

it('rejects binding duplicate fields and does not accept a supplied receipt as a fresh plan', () => {
  const raw = json(bindings()).replace('"version":1', '"version":1,"version":1');
  expect(() => admit(json(plan()), raw)).toThrow(refusal);
  const model = createModel(json(plan()), json(bindings()), environment(), 0);
  expect(() => admit(json(model.receipt()))).toThrow(refusal);
  expect(model.receipt()).toMatchObject(evidenceFlags);
  expect(Object.isFrozen(model.receipt())).toBe(true);
});

it('normalizes whitespace escaped fixed keys and equivalent integer spelling without losing duplicates', () => {
  const raw = json(plan()).replace('"version":1', '"\\u0076ersion":1.0');
  expect(admit(' \n' + raw + '\t')).toEqual(admit());
  expect(readJson('{"__proto__":{"x":1},"key":[true,false,null,"ok"]}', 4096)).toEqual({
    ['__proto__']: { x: 1 },
    key: [true, false, null, 'ok'],
  });
  expect(Object.getPrototypeOf(readJson('{"__proto__":1}', 4096))).toBe(null);
});

it.each([
  '{"key":"' + 'a'.repeat(513) + '"}',
  '[' + '0,'.repeat(128) + '0]',
  '['.repeat(8) + '0' + ']'.repeat(8),
  '"\\ud800"',
  '"\\udc00"',
  '"' + String.fromCharCode(0xd800) + '"',
  '"' + String.fromCharCode(0xdc00) + '"',
  '"unterminated',
  '"bad\\xescape"',
  '{"key":1,"\\u006bey":2}',
  '9007199254740992',
])(
  'enforces JSON byte token node depth Unicode and duplicate boundaries %# before schema admission',
  (raw) => {
    expect(() => readJson(raw, 4096)).toThrow(refusal);
  },
);
