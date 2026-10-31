import { expect, it } from 'vitest';
import { admit, checkFacts, budget, mapping, digest } from '../fixtures/tls-admission/contract.ts';
import { resource } from '../fixtures/tls-admission/resources.ts';
import versions from '../../infra/local/versions.json' with { type: 'json' };

const env = () => ({
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-' + 'a'.repeat(16),
});
const plan = () => ({
  version: 1,
  scope: 'disposable-readonly-multitarget-plan',
  project: env().ISOLATED_TEST_PROJECT,
  fixtureGeneration: 'b'.repeat(32),
  domains: [
    { slot: 0, purpose: 'source' },
    { slot: 1, purpose: 'target' },
  ],
});
const owners = () => ({
  version: 1,
  scope: 'private-tls-admission',
  project: plan().project,
  fixtureGeneration: plan().fixtureGeneration,
  caSha256: 'c'.repeat(64),
  owners: [0, 1].flatMap((slot) =>
    ['app', 'cms'].map((kind) => ({
      slot,
      kind,
      password: 'd'.repeat(64),
      baseline: 'e'.repeat(64),
    })),
  ),
});
const raw = (v: unknown) => JSON.stringify(v);
const read = (p: unknown = plan(), o: unknown = owners(), e = env()) => admit(raw(p), raw(o), e);
const no = /^Disposable TLS admission refused$/;
it('admits only four fixed endpoints and detaches/freeze private configurations', () => {
  const result = read();
  expect(result.endpoints.map((x) => [x.slot, x.host, x.database, x.user])).toEqual([
    [0, 'postgres.preflight.test', 'tt_app_recovery', 'tt_app_migrator'],
    [0, 'postgres.preflight.test', 'tt_cms_recovery', 'tt_cms_migrator'],
    [1, 'recovery-postgres.preflight.test', 'tt_app_recovery', 'tt_app_migrator'],
    [1, 'recovery-postgres.preflight.test', 'tt_cms_recovery', 'tt_cms_migrator'],
  ]);
  expect(Object.isFrozen(result.endpoints)).toBe(true);
  expect(result.endpoints.every(Object.isFrozen)).toBe(true);
  const p = plan();
  p.domains.reverse();
  const o = owners();
  o.owners.reverse();
  expect(read(p, o)).toEqual(result);
});
it.each([
  { version: 2 },
  { scope: 'production' },
  { project: 'tt-stage' },
  { fixtureGeneration: 'x' },
  { domains: [] },
  { url: 'postgresql://private' },
  { sql: 'private' },
  { ca: 'private' },
  { timeout: 100 },
  { callback: 'private' },
  { role: 'local_harness' },
  { receipt: {} },
])('rejects envelope patch %j', (patch) => {
  expect(() => read({ ...plan(), ...patch })).toThrow(no);
});
it.each([
  { slot: 0, purpose: 'target' },
  { slot: 1, purpose: 'source' },
  { slot: 2, purpose: 'target' },
  { slot: 0, purpose: 'source', host: 'remote' },
])('rejects slot substitution %j', (d) => {
  expect(() => read({ ...plan(), domains: [d, plan().domains[1]] })).toThrow(no);
});
it.each([
  { version: 2 },
  { scope: 'public' },
  { project: 'tt-dev' },
  { fixtureGeneration: 'f'.repeat(32) },
  { caSha256: 'x' },
  { owners: [] },
  { admin: 'private' },
  { connectionString: 'private' },
])('rejects private configuration patch %j', (patch) => {
  expect(() => read(plan(), { ...owners(), ...patch })).toThrow(no);
});
it.each([
  { slot: 2 },
  { kind: 'other' },
  { password: 'short' },
  { baseline: 'x' },
  { host: 'remote' },
  { user: 'local_harness' },
  { ssl: { rejectUnauthorized: false } },
])('rejects owner substitution %j', (patch) => {
  const o = owners();
  (o.owners[0] as Record<string, unknown>) = { ...o.owners[0], ...patch };
  expect(() => read(plan(), o)).toThrow(no);
});
it('rejects duplicate owners, decoded duplicate keys, excessive input and accessor environments', () => {
  const o = owners();
  o.owners[1] = o.owners[0]!;
  expect(() => read(plan(), o)).toThrow(no);
  expect(() =>
    admit(
      raw(plan()).replace('"version":1', '"version":1,"\\u0076ersion":1'),
      raw(owners()),
      env(),
    ),
  ).toThrow(no);
  expect(() => admit(raw(plan()) + ' '.repeat(4096), raw(owners()), env())).toThrow(no);
  const e = Object.defineProperty(env(), 'APP_ENV', {
    get() {
      throw Error('private');
    },
  });
  expect(() => read(plan(), owners(), e)).toThrow(no);
});
it.each([
  'PGSSLMODE',
  'PGSSLNEGOTIATION',
  'PGOPTIONS',
  'NODE_OPTIONS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_EXTRA_CA_CERTS',
])('rejects ambient %s before connection', (key) => {
  expect(() => read(plan(), owners(), { ...env(), [key]: 'private' })).toThrow(no);
});
it('requires exact fixture environment', () => {
  expect(() => read(plan(), owners(), { ...env(), PROVIDER_MODE: 'live' })).toThrow(no);
});
const fact = () => ({
  actor: 'tt_app_migrator',
  session_actor: 'tt_app_migrator',
  database: 'tt_app_recovery',
  owner: 'tt_app_migrator',
  version: 180006,
  readonly: 'on',
  isolation: 'repeatable read',
  tls: true,
});
it('checks exact observed identity and protocol facts without treating TLS as journal authority', () => {
  expect(checkFacts(fact(), read().endpoints[0]!)).toBe(true);
});
it.each([
  { actor: 'local_harness' },
  { session_actor: 'other' },
  { database: 'tt_cms_recovery' },
  { owner: 'other' },
  { version: 180005 },
  { version: 190000 },
  { readonly: 'off' },
  { isolation: 'read committed' },
  { tls: false },
  { tls: null },
])('refuses observed drift %j', (patch) => {
  expect(() => checkFacts({ ...fact(), ...patch }, read().endpoints[0]!)).toThrow(no);
});
it.each([NaN, Infinity, -1, 4000, 4001])(
  'refuses exhausted or invalid elapsed time %j',
  (elapsed) => {
    expect(() => budget(0, elapsed)).toThrow(no);
  },
);
it('caps work with one attempt budget and no per-endpoint reset', () => {
  expect(budget(100, 100)).toBe(1500);
  expect(budget(100, 3999)).toBe(101);
  expect(() => budget(100, 99)).toThrow(no);
});
it('requires fresh bounded mapping replies and never grants authority from old digests', () => {
  const expected = {
    version: 1,
    project: plan().project,
    fixtureGeneration: plan().fixtureGeneration,
    nonce: '1'.repeat(16),
    current: true,
    binding: '2'.repeat(64),
  };
  expect(mapping(raw(expected), plan().project, plan().fixtureGeneration, expected.nonce)).toBe(
    expected.binding,
  );
  for (const patch of [
    { current: false },
    { nonce: '3'.repeat(16) },
    { project: 'tt-stage' },
    { fixtureGeneration: '4'.repeat(32) },
    { binding: 'x' },
    { extra: true },
  ])
    expect(() =>
      mapping(
        raw({ ...expected, ...patch }),
        plan().project,
        plan().fixtureGeneration,
        expected.nonce,
      ),
    ).toThrow(no);
});
it('canonicalizes metadata key order only for comparison, never authentication', () => {
  expect(digest({ b: 2, a: [{ z: 1, y: 2 }] })).toBe(digest({ a: [{ y: 2, z: 1 }], b: 2 }));
});
function container() {
  const project = plan().project;
  return {
    Id: '1'.repeat(64),
    Name: '/' + project + '-postgres-1',
    State: {
      Running: true,
      Paused: false,
      Restarting: false,
      StartedAt: '2026-10-31T01:00:00.123456789Z',
      Health: { Status: 'healthy' },
    },
    Config: {
      Image: versions.postgresImage,
      Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'postgres' },
      Cmd: [
        'postgres',
        '-c',
        'ssl=on',
        '-c',
        'ssl_cert_file=/tls/server.valid.crt',
        '-c',
        'ssl_key_file=/tls/server.key',
      ],
    },
    HostConfig: { PortBindings: {} },
    Mounts: [
      {
        Type: 'volume',
        Name: project + '_postgres-data',
        Destination: '/var/lib/postgresql',
        RW: true,
      },
      { Type: 'volume', Name: project + '_source-tls', Destination: '/tls', RW: false },
    ],
    NetworkSettings: {
      Ports: { '5432/tcp': null },
      Networks: {
        [project + '_local']: {
          NetworkID: '2'.repeat(64),
          IPAddress: '172.21.0.2',
          Aliases: ['postgres', 'postgres.preflight.test', 'postgres.mismatch.preflight.test'],
        },
      },
    },
  };
}
it('extracts only the fixed owned running resource facts, without container environment secrets', () => {
  const c = container();
  const r = resource(c, plan().project, 0, 'valid');
  expect(r.startedAt).toBe(c.State.StartedAt);
  expect(JSON.stringify(r)).not.toContain('Labels');
});
it.each(['', 'invalid', '0001-01-01T00:00:00Z'])(
  'refuses a missing/malformed incarnation %j',
  (started) => {
    const c = container();
    c.State.StartedAt = started;
    expect(() => resource(c, plan().project, 0, 'valid')).toThrow();
  },
);
it.each(['Running', 'Paused', 'Restarting'] as const)(
  'refuses inactive resource state %s',
  (key) => {
    const c = container();
    c.State[key] = key === 'Running' ? false : true;
    expect(() => resource(c, plan().project, 0, 'valid')).toThrow();
  },
);
it('refuses published ports, foreign volume or extra network alias', () => {
  const c = container();
  c.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5432' }] };
  expect(() => resource(c, plan().project, 0, 'valid')).toThrow();
  const v = container();
  v.Mounts[0]!.Name = 'tt-stage_data';
  expect(() => resource(v, plan().project, 0, 'valid')).toThrow();
  const a = container();
  a.NetworkSettings.Networks[plan().project + '_local']!.Aliases.push('remote');
  expect(() => resource(a, plan().project, 0, 'valid')).toThrow();
});
