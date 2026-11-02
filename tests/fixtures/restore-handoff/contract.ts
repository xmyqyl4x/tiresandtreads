export const profiles = [
  'positive',
  'bundle-corrupt',
  'bundle-project',
  'bundle-manifest',
  'checkpoint-missing',
  'checkpoint-stale',
  'checkpoint-changed',
  'image-binding',
  'config-binding',
  'app-history',
  'cms-history',
  'target-row',
  'source-row',
  'quarantine',
  'observer-loss',
  'inspection-loss',
] as const;
export type Profile = (typeof profiles)[number];
export interface Bindings {
  project: string;
  generation: string;
  image: string;
  config: string;
  sourceDigest: string;
}
export interface Observation {
  slot: number;
  kind: 'app' | 'cms';
  catalog: string;
  rows: string;
  sequences: string;
  security: string;
  history: string;
  populated: boolean;
  historiesValid: boolean;
  quarantined: boolean;
  tables: number;
}
export interface Current {
  version: 1;
  project: string;
  generation: string;
  digest: string;
  observedAt: string;
  backupFinishedAt: string;
}
export interface Seal extends Bindings {
  version: 1;
  phase: 'maintenance-closed';
  maintenanceClosedAt: number;
  setup: {
    appRestored: boolean;
    cmsRestored: boolean;
    privacyReplayed: boolean;
    maintenanceClosed: boolean;
  };
  checkpoint: Current;
  observations: Observation[];
}
export class HandoffRefusal extends Error {
  constructor(readonly code: string) {
    super('Restore handoff refused');
  }
}
function demand(value: unknown, code = 'record'): asserts value {
  if (!value) throw new HandoffRefusal(code);
}
function object(value: unknown, keys: string): Record<string, unknown> {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value));
  demand(Object.keys(value).sort().join(',') === keys.split(',').sort().join(','));
  return value as Record<string, unknown>;
}
function parse(raw: unknown, max: number) {
  try {
    demand(typeof raw === 'string' && Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= max);
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HandoffRefusal('record');
  }
}
function hash(value: unknown) {
  demand(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  return value;
}
function time(value: unknown) {
  demand(typeof value === 'string');
  const t = Date.parse(value);
  demand(Number.isSafeInteger(t) && new Date(t).toISOString() === value);
  return t;
}
function observations(raw: unknown, positive: boolean): Observation[] {
  demand(Array.isArray(raw) && raw.length === 4, 'observation-shape');
  demand(
    raw.map((x) => `${x?.slot}/${x?.kind}`).join(',') === '0/app,0/cms,1/app,1/cms',
    'observation-shape',
  );
  for (const value of raw) {
    const o = object(
      value,
      'slot,kind,catalog,rows,sequences,security,history,populated,historiesValid,quarantined,tables',
    );
    for (const key of ['catalog', 'rows', 'sequences', 'security', 'history']) hash(o[key]);
    for (const key of ['populated', 'historiesValid', 'quarantined'])
      demand(typeof o[key] === 'boolean' && (!positive || o[key] === true), 'observation-shape');
    demand(
      Number.isSafeInteger(o.tables) && Number(o.tables) > 0 && Number(o.tables) <= 200,
      'observation-budget',
    );
  }
  return structuredClone(raw) as Observation[];
}
function checkpoint(
  raw: unknown,
  seal: Pick<Seal, 'project' | 'generation' | 'maintenanceClosedAt'>,
  now: number,
): Current {
  const c = object(raw, 'version,project,generation,digest,observedAt,backupFinishedAt');
  demand(
    c.version === 1 && c.project === seal.project && c.generation === seal.generation,
    'checkpoint-changed',
  );
  hash(c.digest);
  const at = time(c.observedAt),
    backup = time(c.backupFinishedAt);
  demand(
    Number.isSafeInteger(now) &&
      Number.isSafeInteger(seal.maintenanceClosedAt) &&
      seal.maintenanceClosedAt > 0 &&
      seal.maintenanceClosedAt <= now + 5000,
    'checkpoint-stale',
  );
  demand(
    at >= seal.maintenanceClosedAt && at >= backup && at <= now + 5000 && now - at <= 300000,
    'checkpoint-stale',
  );
  return structuredClone(c) as unknown as Current;
}
export function admitSeal(raw: unknown, expected: Bindings, now: number): Seal {
  const s = object(
    parse(raw, 65536),
    'version,phase,project,generation,image,config,sourceDigest,maintenanceClosedAt,setup,checkpoint,observations',
  );
  demand(s.version === 1 && s.phase === 'maintenance-closed', 'phase');
  demand(typeof s.project === 'string' && /^tt-test-[a-f0-9]{16}$/.test(s.project));
  demand(typeof s.generation === 'string' && /^[a-f0-9]{32}$/.test(s.generation));
  demand(typeof s.image === 'string' && /^sha256:[a-f0-9]{64}$/.test(s.image));
  hash(s.config);
  hash(s.sourceDigest);
  for (const key of ['project', 'generation', 'image', 'config', 'sourceDigest'] as const)
    demand(s[key] === expected[key], key);
  const setup = object(s.setup, 'appRestored,cmsRestored,privacyReplayed,maintenanceClosed');
  demand(
    Object.values(setup).every((x) => x === true),
    'setup',
  );
  checkpoint(s.checkpoint, s as unknown as Seal, now);
  observations(s.observations, true);
  return structuredClone(s) as unknown as Seal;
}
export function admitCurrent(raw: unknown, seal: Seal, now: number): Current {
  const c = checkpoint(parse(raw, 16384), seal, now);
  for (const key of [
    'version',
    'project',
    'generation',
    'digest',
    'observedAt',
    'backupFinishedAt',
  ] as const)
    demand(c[key] === seal.checkpoint[key], 'checkpoint-changed');
  return c;
}
export function compareObservations(expected: Observation[], current: unknown) {
  return compare(expected, current, true);
}
export function preservationFindings(expected: Observation[], current: unknown) {
  return compare(expected, current, false);
}
function compare(expected: Observation[], current: unknown, positive: boolean) {
  const before = observations(expected, positive),
    actual = observations(current, false),
    findings: string[] = [];
  for (let i = 0; i < 4; i++) {
    const b = before[i]!,
      a = actual[i]!;
    for (const key of [
      'catalog',
      'rows',
      'sequences',
      'security',
      'history',
      'populated',
      'historiesValid',
      'quarantined',
      'tables',
    ] as const)
      if (a[key] !== b[key]) findings.push(`${a.slot}/${a.kind}:${key}`);
  }
  return findings;
}
export function terminal(
  status: 'success' | 'refused' | 'unavailable' | 'unknown',
  code: string,
  observed: number,
  ends: number,
) {
  demand(['success', 'refused', 'unavailable', 'unknown'].includes(status));
  demand(/^[a-z][a-z0-9-]{0,63}$/.test(code));
  demand(
    Number.isSafeInteger(observed) &&
      Number.isSafeInteger(ends) &&
      observed >= 0 &&
      observed <= 4 &&
      ends >= 0 &&
      ends <= observed,
  );
  demand(status !== 'success' || (observed === 4 && ends === 4 && code === 'compatible'));
  demand(status === 'success' || code !== 'compatible');
  return {
    status,
    code,
    attemptedEndpoints: observed,
    nativeEndsObserved: ends,
    complete: status === 'success',
    cleanupUnknown: status === 'unknown' || ends < observed,
    freshAttemptBlocked: status !== 'success',
    actualAcceptance: false,
    runtimeAdmission: false,
    hostedAccepted: false,
    productActivation: false,
    independentDurability: false,
    authenticated: false,
    targetFencing: false,
    observerMutationStatements: 0,
    providerDispatches: 0,
    actualRecipientNotifications: 0,
    casesClosed: 0,
    gatesClosed: 0,
  };
}
