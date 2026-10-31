import { readJson } from '../multitarget-plan/json.ts';
import { evidenceFlags } from '../tls-admission/contract.ts';
export function refused(): never {
  throw Error('Coordination proof refused');
}
export function must(value: unknown): asserts value {
  if (!value) refused();
}
export const channels = Object.freeze(
  (
    [
      { id: 'c0', slot: 0, kind: 'app', key: 7724054 },
      { id: 'c1', slot: 1, kind: 'app', key: 7724054 },
      { id: 'i0a', slot: 0, kind: 'app', key: 7724004 },
      { id: 'i0c', slot: 0, kind: 'cms', key: 7724004 },
      { id: 'i1a', slot: 1, kind: 'app', key: 7724004 },
      { id: 'i1c', slot: 1, kind: 'cms', key: 7724004 },
    ] as const
  ).map((c) => Object.freeze(c)),
);
export type Channel = (typeof channels)[number];
export type Id = Channel['id'];
export function descriptor(id: unknown): Channel {
  const c = channels.find((c) => c.id === id);
  must(c);
  return c;
}
export function next(prefix: readonly string[]): Id {
  must(
    Array.isArray(prefix) &&
      prefix.length < channels.length &&
      prefix.every((id, i) => channels[i]?.id === id),
  );
  return channels[prefix.length]!.id;
}
export type Kind = 'candidate' | 'blocker' | 'witness' | 'negative';
export type Request = {
  version: 1;
  nonce: string;
  op: 'join' | 'register' | 'sample';
  participant: string;
  kind?: Kind;
  channel?: Id;
};
export function request(raw: unknown): Request {
  try {
    const r = readJson(raw, 4096) as Record<string, unknown>;
    must(
      r &&
        !Array.isArray(r) &&
        r.version === 1 &&
        typeof r.nonce === 'string' &&
        /^[a-f0-9]{16}$/.test(r.nonce) &&
        typeof r.participant === 'string' &&
        /^[a-f0-9]{16}$/.test(r.participant),
    );
    const keys = ['version', 'nonce', 'op', 'participant'];
    if (r.op === 'join') {
      keys.push('kind');
      must(['candidate', 'blocker', 'witness', 'negative'].includes(String(r.kind)));
    } else if (r.op === 'register') {
      keys.push('channel');
      descriptor(r.channel);
    } else must(r.op === 'sample');
    must(Object.keys(r).length === keys.length && keys.every((k) => Object.hasOwn(r, k)));
    return Object.freeze(r) as Request;
  } catch {
    return refused();
  }
}
export type Identity = Readonly<{
  pid: number;
  start: string;
  database: string;
  role: string;
  application: string;
  type: string;
}>;
export function identity(raw: unknown, c: Channel, run: string, participant: string): Identity {
  const r = raw as Identity;
  must(
    r &&
      Number.isSafeInteger(r.pid) &&
      r.pid > 0 &&
      typeof r.start === 'string' &&
      r.start.length <= 64 &&
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?\+00$/.test(r.start) &&
      r.database === `tt_${c.kind}_recovery` &&
      r.role === `tt_${c.kind}_migrator` &&
      r.type === 'client backend' &&
      r.application === `tt-mt:${run}:${participant}:${c.id}` &&
      Buffer.byteLength(r.application) <= 63,
  );
  return Object.freeze({
    pid: r.pid,
    start: r.start,
    database: r.database,
    role: r.role,
    application: r.application,
    type: r.type,
  });
}
export function sameIdentity(a: Identity, b: unknown) {
  const r = b as Identity;
  return (
    !!r &&
    (['pid', 'start', 'database', 'role', 'application', 'type'] as const).every(
      (k) => a[k] === r[k],
    )
  );
}
type Facts = {
  status?: string;
  trace: readonly string[];
  opened?: number;
  ended?: number;
  acquired?: readonly Id[];
  attempted?: readonly Id[];
  workStarted?: number;
  workCompleted?: number;
  lateResults?: number;
  cleanupUnknown?: boolean;
  backendAbsent?: boolean;
  locksAbsent?: boolean;
  baselineParity?: boolean;
  elapsedMs?: number;
  unknownGrant?: boolean;
  reason?: string;
};
export function receipt(f: Facts) {
  must(
    Array.isArray(f.trace) &&
      f.trace.length <= 64 &&
      f.trace.every((v) => typeof v === 'string' && /^[a-z0-9:-]{1,40}$/.test(v)),
  );
  const r = Object.freeze({
    scope: 'disposable-multitarget-coordination',
    status: f.status ?? 'refused',
    reason: f.reason ?? 'refused',
    trace: Object.freeze([...f.trace]),
    opened: f.opened ?? 0,
    ended: f.ended ?? 0,
    acquired: Object.freeze([...(f.acquired ?? [])]),
    attempted: Object.freeze([...(f.attempted ?? [])]),
    workStarted: f.workStarted ?? 0,
    workCompleted: f.workCompleted ?? 0,
    lateResults: f.lateResults ?? 0,
    cleanupUnknown: f.cleanupUnknown ?? true,
    backendAbsent: f.backendAbsent ?? false,
    locksAbsent: f.locksAbsent ?? false,
    baselineParity: f.baselineParity ?? false,
    elapsedMs: f.elapsedMs ?? 0,
    unknownGrant: f.unknownGrant ?? false,
    ...evidenceFlags,
  });
  must(Buffer.byteLength(JSON.stringify(r)) <= 16384);
  return r;
}
