import { memoryJournal, encode, type Checkpoint } from '../lifecycle-journal/model.ts';
import { operation, acquire, intent, append, outcome, id } from '../lifecycle-journal/samples.ts';

export const points = [
  'before-intent',
  'intent-ack',
  'dispatch-ack',
  'partial-outcome',
  'outcome-written',
  'outcome-ack',
  'receipt-ack',
] as const;
export type Point = (typeof points)[number];
export const flags = {
  sqlDispatches: 0,
  providerDispatches: 0,
  actualRecipientNotifications: 0,
  independentDurability: false,
  authenticated: false,
  targetFencing: false,
  runtimeAdmission: false,
  hostedAccepted: false,
  productActivation: false,
} as const;
const model = memoryJournal();
model.append(encode(operation()), model.checkpoint());
acquire(model);
intent(model);
append(model, 'dispatch', { attempt: id(20) });
outcome(model);
intent(model, id(21), 1, id(11));
outcome(model, 'observed_success', 'available', 'synthetic_success', id(21));
append(model, 'coordination', { state: 'quiescent', holder: id(30) });
append(model, 'receipt', {});
export const fixedRecords = Object.freeze(model.events().map(encode));
export function refuse(): never {
  throw Error('Journal process refused');
}
export function must(value: unknown): asserts value {
  if (!value) refuse();
}
export function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  must(value && typeof value === 'object' && !Array.isArray(value));
  must(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}
export function checkpointAt(count: number): Checkpoint {
  must(Number.isInteger(count) && count >= 0 && count <= 9);
  return Object.freeze({
    count,
    head: count === 0 ? '0'.repeat(64) : (JSON.parse(fixedRecords[count - 1]!).digest as string),
  });
}
function prefix(count: number) {
  return memoryJournal(fixedRecords.slice(0, count), checkpointAt(count));
}
export const exportedAt = (count: number) => JSON.stringify(prefix(count).receipt());
export function summaryAt(count: number) {
  const op = prefix(count).receipt().operations[0];
  return {
    disposition: op?.disposition ?? 'awaiting_reconciliation',
    appEffect: op?.plannedSteps[0]?.effect ?? 'not_dispatched',
    cmsEffect: op?.plannedSteps[1]?.effect ?? 'not_dispatched',
    unknown: op?.attempts.filter((a) => a.effect === 'unknown').length ?? 0,
  };
}
export const pointAt = (count: number): Point | 'none' =>
  (({ 2: 'before-intent', 3: 'intent-ack', 4: 'dispatch-ack', 5: 'outcome-ack', 9: 'receipt-ack' })[
    count
  ] as Point | undefined) ?? 'none';
export interface Plan {
  version: 1;
  scope: 'disposable-journal-process';
  project: string;
  runId: string;
  mode: 'write' | 'read';
  point: Point | 'none';
  checkpoint: Checkpoint;
  exportedReceipt: string;
}
function checkpoint(value: unknown): asserts value is Checkpoint {
  exact(value, ['count', 'head']);
  must(typeof value.count === 'number' && value.head === checkpointAt(value.count).head);
}
export function readPlan(raw: unknown, env: Readonly<Record<string, string | undefined>>): Plan {
  try {
    must(Buffer.byteLength(JSON.stringify(raw)) <= 16384);
    const p: unknown = JSON.parse(JSON.stringify(raw));
    exact(p, [
      'version',
      'scope',
      'project',
      'runId',
      'mode',
      'point',
      'checkpoint',
      'exportedReceipt',
    ]);
    must(env.APP_ENV === 'test-local' && env.PROVIDER_MODE === 'fixtures');
    must(
      typeof p.project === 'string' &&
        /^tt-test-[a-f0-9]{16}$/.test(p.project) &&
        p.project === env.ISOLATED_TEST_PROJECT,
    );
    must(
      typeof p.runId === 'string' &&
        /^[a-f0-9]{32}$/.test(p.runId) &&
        p.runId === env.JOURNAL_PROOF_RUN,
    );
    must(
      p.version === 1 &&
        p.scope === 'disposable-journal-process' &&
        (p.mode === 'write' || p.mode === 'read'),
    );
    must(
      p.mode === 'read'
        ? p.point === 'none'
        : p.point === 'none' || points.includes(p.point as Point),
    );
    checkpoint(p.checkpoint);
    must(p.mode === 'read' || p.checkpoint.count === 0);
    must(p.exportedReceipt === exportedAt(p.checkpoint.count));
    return Object.freeze(p) as unknown as Plan;
  } catch {
    return refuse();
  }
}
type Base = {
  scope: 'disposable-journal-process';
  processId: number;
  runId: string;
} & typeof flags;
export type Event = Base &
  (
    | { kind: 'ack'; point: Point | 'none'; checkpoint: Checkpoint }
    | { kind: 'paused'; point: 'partial-outcome' | 'outcome-written'; checkpoint: Checkpoint }
    | {
        kind: 'result';
        checkpoint: Checkpoint;
        summary: ReturnType<typeof summaryAt>;
        receiptRejected: true;
        replayRefused: true | null;
        sanitizedEnvironment: true;
      }
    | { kind: 'refused' }
  );
export function readEvent(raw: unknown, plan: Plan, pid: number): Event {
  try {
    must(Buffer.byteLength(JSON.stringify(raw)) <= 8192);
    const value: unknown = JSON.parse(JSON.stringify(raw));
    must(value && typeof value === 'object' && !Array.isArray(value));
    const e = value as Record<string, unknown>;
    const extras =
      e.kind === 'ack' || e.kind === 'paused'
        ? ['point', 'checkpoint']
        : e.kind === 'result'
          ? ['checkpoint', 'summary', 'receiptRejected', 'replayRefused', 'sanitizedEnvironment']
          : [];
    exact(e, ['scope', 'processId', 'runId', 'kind', ...Object.keys(flags), ...extras]);
    must(e.scope === plan.scope && e.processId === pid && e.runId === plan.runId);
    for (const [key, value] of Object.entries(flags)) must(e[key] === value);
    if (e.kind === 'ack' || e.kind === 'paused') {
      must(plan.mode === 'write');
      checkpoint(e.checkpoint);
      if (e.kind === 'ack')
        must(e.checkpoint.count >= 1 && e.point === pointAt(e.checkpoint.count));
      else
        must(
          (e.point === 'partial-outcome' || e.point === 'outcome-written') &&
            e.point === plan.point &&
            e.checkpoint.count === 4,
        );
    } else if (e.kind === 'result') {
      checkpoint(e.checkpoint);
      must(e.checkpoint.count === (plan.mode === 'read' ? plan.checkpoint.count : 9));
      const expected = summaryAt(e.checkpoint.count);
      exact(e.summary, Object.keys(expected));
      for (const [key, value] of Object.entries(expected)) must(e.summary[key] === value);
      must(
        e.receiptRejected === true &&
          e.sanitizedEnvironment === true &&
          e.replayRefused === (e.checkpoint.count >= 3 ? true : null),
      );
    } else must(e.kind === 'refused');
    return Object.freeze(e) as unknown as Event;
  } catch {
    return refuse();
  }
}
