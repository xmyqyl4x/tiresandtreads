import { digest } from '../../../scripts/database/inventory.ts';
import {
  readLifecycleRequest,
  lifecycleSourceDigest,
  lifecyclePhases,
  type LifecycleBaseline,
} from '../lifecycle-validation/reader.ts';
import type { PairReceipt } from '../lifecycle-pair/contract.ts';

export const interruptionPoints = [
  'validation-locked',
  'app-read',
  'cms-read',
  'receipt',
  'handoff-locked',
] as const;
type Point = (typeof interruptionPoints)[number];
type Counts = Readonly<{ app: number; cms: number }>;
export interface ExecutorPlan {
  readonly version: 1;
  readonly project: string;
  readonly kind: 'interrupt' | 'restart';
  readonly point: Point | 'none';
  readonly inputs: Readonly<{ app: unknown; cms: unknown }>;
  readonly baseline: LifecycleBaseline;
  readonly identity: Readonly<{
    operationId: string;
    releaseDigest: string;
    credentialGeneration: string;
  }>;
  readonly previousReceipt: unknown;
}
const flags = { runtimeAdmission: false, hostedAccepted: false, productActivation: false } as const;
type BaseEvent = { scope: 'disposable-local-restart'; processId: number } & typeof flags;
export type ExecutorEvent = BaseEvent &
  (
    | { kind: 'checkpoint'; point: Point; receipt: PairReceipt; reads: Counts }
    | {
        kind: 'result';
        importedReceiptRejected: boolean | null;
        importReads: Counts;
        validationStatus: 'validated' | 'refused';
        handoffStatus: 'observed' | 'refused' | 'absent';
        reads: Counts;
      }
  );
export const executorFlags = flags;

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw Error();
}
function hashes(value: unknown, keys: readonly string[]) {
  exact(value, keys);
  if (Object.values(value).some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)))
    throw Error();
}
function counts(value: unknown) {
  exact(value, ['app', 'cms']);
  if (
    Object.values(value).some((v) => !Number.isInteger(v) || (v as number) < 0 || (v as number) > 6)
  )
    throw Error();
}

export function readExecutorPlan(
  raw: unknown,
  env: Readonly<Record<string, string | undefined>>,
): ExecutorPlan {
  try {
    const p = structuredClone(raw);
    exact(p, [
      'version',
      'project',
      'kind',
      'point',
      'inputs',
      'baseline',
      'identity',
      'previousReceipt',
    ]);
    if (
      Buffer.byteLength(JSON.stringify(p), 'utf8') > 65536 ||
      p.version !== 1 ||
      p.project !== env.ISOLATED_TEST_PROJECT ||
      (p.kind !== 'interrupt' && p.kind !== 'restart') ||
      (p.kind === 'interrupt'
        ? !interruptionPoints.includes(p.point as Point) || p.previousReceipt !== null
        : p.point !== 'none')
    )
      throw Error();
    exact(p.inputs, ['app', 'cms']);
    const app = readLifecycleRequest(p.inputs.app, env),
      cms = readLifecycleRequest(p.inputs.cms, env);
    if (app.target !== 'app' || cms.target !== 'cms' || app.phase !== cms.phase) throw Error();
    const b = p.baseline as Record<string, unknown>;
    exact(
      b,
      b && Object.hasOwn(b, 'migrated')
        ? ['project', 'sourceDigest', 'foundation', 'databaseAcls', 'migrated']
        : ['project', 'sourceDigest', 'foundation', 'databaseAcls'],
    );
    if (b.project !== p.project || b.sourceDigest !== lifecycleSourceDigest()) throw Error();
    hashes(b.foundation, ['app', 'cms']);
    if (Object.hasOwn(b, 'migrated')) hashes(b.migrated, ['app', 'cms']);
    if (app.phase !== 'foundation' && !b.migrated) throw Error();
    exact(b.databaseAcls, ['app', 'cms']);
    for (const value of Object.values(b.databaseAcls)) hashes(value, lifecyclePhases);
    exact(p.identity, ['operationId', 'releaseDigest', 'credentialGeneration']);
    for (const [key, length] of [
      ['operationId', 32],
      ['releaseDigest', 64],
      ['credentialGeneration', 32],
    ] as const)
      if (
        typeof p.identity[key] !== 'string' ||
        !new RegExp(`^[a-f0-9]{${length}}$`).test(p.identity[key])
      )
        throw Error();
    return p as unknown as ExecutorPlan;
  } catch {
    throw Error('Invalid disposable executor plan');
  }
}

export function readExecutorEvent(raw: unknown, plan: ExecutorPlan): ExecutorEvent {
  try {
    const e = structuredClone(raw);
    if (!e || typeof e !== 'object') throw Error();
    const v = e as Record<string, unknown>;
    const base = [
      'scope',
      'processId',
      'runtimeAdmission',
      'hostedAccepted',
      'productActivation',
      'kind',
      'reads',
    ];
    exact(
      v,
      v.kind === 'checkpoint'
        ? [...base, 'point', 'receipt']
        : [...base, 'importedReceiptRejected', 'importReads', 'validationStatus', 'handoffStatus'],
    );
    if (
      Buffer.byteLength(JSON.stringify(v), 'utf8') > 16384 ||
      v.scope !== 'disposable-local-restart' ||
      !Number.isSafeInteger(v.processId) ||
      (v.processId as number) < 1 ||
      Object.keys(flags).some((k) => v[k] !== false)
    )
      throw Error();
    counts(v.reads);
    if (v.kind === 'checkpoint') {
      if (plan.kind !== 'interrupt' || v.point !== plan.point) throw Error();
      const r = v.receipt;
      exact(r, [
        'scope',
        'formatVersion',
        'project',
        'fixtureId',
        'operationId',
        'releaseDigest',
        'credentialGeneration',
        'phase',
        'sourceDigest',
        'baselineDigest',
        'targetsDigest',
        'epoch',
        'issuedAt',
        'ttlMs',
        'observations',
        'hostedAccepted',
        'productActivation',
        'runtimeAdmission',
        'digest',
      ]);
      const app = readLifecycleRequest(plan.inputs.app, process.env);
      if (
        r.scope !== 'disposable-local-pair' ||
        r.formatVersion !== 1 ||
        r.project !== plan.project ||
        r.phase !== app.phase ||
        r.sourceDigest !== plan.baseline.sourceDigest ||
        r.baselineDigest !== digest(plan.baseline) ||
        Object.keys(plan.identity).some(
          (k) => r[k] !== plan.identity[k as keyof typeof plan.identity],
        ) ||
        Object.keys(flags).some((k) => r[k] !== false) ||
        typeof r.fixtureId !== 'string' ||
        !/^[a-f0-9]{32}$/.test(r.fixtureId) ||
        typeof r.targetsDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(r.targetsDigest) ||
        !Number.isInteger(r.epoch) ||
        (r.epoch as number) < 1 ||
        r.ttlMs !== 15000 ||
        typeof r.issuedAt !== 'string' ||
        !Number.isFinite(Date.parse(r.issuedAt)) ||
        !Array.isArray(r.observations) ||
        r.observations.length !== 2
      )
        throw Error();
      for (const [i, o] of r.observations.entries()) {
        exact(o, ['target', 'phase', 'checks']);
        exact(o.checks, [
          'readOnly',
          'tls',
          'serverVersion',
          'scopedRoles',
          'memberships',
          'migrations',
        ]);
        if (
          o.target !== (i === 0 ? 'app' : 'cms') ||
          o.phase !== app.phase ||
          o.checks.readOnly !== true ||
          o.checks.tls !== true ||
          o.checks.serverVersion !== 180006 ||
          o.checks.scopedRoles !== 19 ||
          o.checks.memberships !== 0 ||
          o.checks.migrations !== (app.phase === 'foundation' ? 0 : i === 0 ? 33 : 3)
        )
          throw Error();
      }
      const { digest: claimed, ...record } = r;
      if (typeof claimed !== 'string' || claimed !== digest(record)) throw Error();
    } else {
      if (
        v.kind !== 'result' ||
        (plan.kind === 'restart'
          ? v.importedReceiptRejected !== true
          : v.importedReceiptRejected !== null) ||
        !['validated', 'refused'].includes(v.validationStatus as string) ||
        !['observed', 'refused', 'absent'].includes(v.handoffStatus as string)
      )
        throw Error();
      counts(v.importReads);
      const c = v.importReads as Counts;
      if (c.app || c.cms || (v.handoffStatus === 'observed' && v.validationStatus !== 'validated'))
        throw Error();
    }
    return v as unknown as ExecutorEvent;
  } catch {
    throw Error('Invalid disposable executor event');
  }
}
