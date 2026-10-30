import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

// Synthetic test support only. No SQL/network/filesystem, effect callbacks,
// authenticated checkpoint, durable backend, target fence or production import.
export const zero = '0'.repeat(64);
const kinds = [
  'operation',
  'coordination',
  'intent',
  'dispatch',
  'outcome',
  'inventory',
  'reconciliation',
  'receipt',
] as const;
export type Kind = (typeof kinds)[number];
type Data = Record<string, unknown>;
export interface Envelope extends Data {
  v: number;
  scope: string;
  operationId: string;
  project: string;
  domain: string;
  source: string;
  tree: string;
  image: string;
  config: string;
  manifest: string;
  release: string;
  credentialGeneration: string;
  review: string;
  phase: string;
  resources: string[];
  steps: { id: string; resource: string }[];
}
export interface Checkpoint {
  count: number;
  head: string;
}
export interface RecordEvent {
  v: number;
  kind: Kind;
  operationId: string;
  domain: string;
  epoch: number;
  sequence: number;
  previous: string;
  data: Data;
  digest: string;
}
type Effect = 'unknown' | 'observed_success' | 'observed_no_effect';
interface Attempt {
  id: string;
  step: string;
  resource: string;
  effect: Effect;
  observation: 'available' | 'unavailable';
  dispatched: boolean;
  reviewed: boolean;
  outcomeUsed: boolean;
  lastObservation: number;
  conflict: boolean;
  inventory: { provenance: string; digest: string; epoch: number; sequence: number } | null;
}
interface Operation {
  envelope: Envelope;
  epoch: number;
  holder: string;
  active: boolean;
  quiescent: boolean;
  receipted: boolean;
  attempts: Attempt[];
}
interface State {
  operations: Operation[];
  epochs: { [domain: string]: number };
}

function refuse(): never {
  throw Error('Journal model refused');
}
function must(value: unknown): asserts value {
  if (!value) refuse();
}
function object(value: unknown, keys: readonly string[]): asserts value is Data {
  must(value && typeof value === 'object' && !Array.isArray(value));
  must(
    Object.keys(value).length === keys.length &&
      Object.keys(value).every((key) => keys.includes(key)),
  );
}
const digestRef = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const shortRef = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const member = (v: unknown, list: readonly unknown[]) => list.includes(v);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

function validateData(kind: Kind, raw: unknown) {
  if (kind === 'operation') {
    object(raw, [
      'v',
      'scope',
      'operationId',
      'project',
      'domain',
      'source',
      'tree',
      'image',
      'config',
      'manifest',
      'release',
      'credentialGeneration',
      'review',
      'phase',
      'resources',
      'steps',
    ]);
    must(
      raw.v === 1 &&
        raw.scope === 'disposable-journal-model' &&
        shortRef(raw.operationId) &&
        shortRef(raw.review),
    );
    must(typeof raw.project === 'string' && /^tt-test-[a-f0-9]{16}$/.test(raw.project));
    must(member(raw.phase, ['foundation', 'migrated', 'quarantined']));
    for (const key of [
      'domain',
      'source',
      'tree',
      'image',
      'config',
      'manifest',
      'release',
      'credentialGeneration',
    ])
      must(digestRef(raw[key]));
    must(
      Array.isArray(raw.resources) &&
        raw.resources.length > 0 &&
        raw.resources.length <= 64 &&
        new Set(raw.resources).size === raw.resources.length,
    );
    must(raw.resources.every((v) => member(v, ['app', 'cms', 'roles'])));
    must(Array.isArray(raw.steps) && raw.steps.length > 0 && raw.steps.length <= 256);
    const ids = new Set();
    for (const step of raw.steps) {
      object(step, ['id', 'resource']);
      must(shortRef(step.id) && raw.resources.includes(step.resource) && !ids.has(step.id));
      ids.add(step.id);
    }
    return;
  }
  if (kind === 'coordination') {
    object(raw, ['state', 'holder']);
    must(member(raw.state, ['acquired', 'lost', 'quiescent']) && shortRef(raw.holder));
  } else if (kind === 'intent') {
    object(raw, ['step', 'attempt', 'precondition']);
    must(shortRef(raw.step) && shortRef(raw.attempt) && digestRef(raw.precondition));
  } else if (kind === 'dispatch') {
    object(raw, ['attempt']);
    must(shortRef(raw.attempt));
  } else if (kind === 'outcome') {
    object(raw, ['attempt', 'effect', 'observation', 'reason']);
    must(shortRef(raw.attempt));
    must(
      member(raw.effect, ['unknown', 'observed_success', 'observed_no_effect']) &&
        member(raw.observation, ['available', 'unavailable']),
    );
    if (raw.effect === 'unknown')
      must(member(raw.reason, ['response_lost', 'journal_unavailable', 'catalog_unavailable']));
    else
      must(
        raw.observation === 'available' &&
          raw.reason ===
            (raw.effect === 'observed_success' ? 'synthetic_success' : 'synthetic_rollback'),
      );
  } else if (kind === 'inventory') {
    object(raw, ['attempt', 'provenance', 'digest']);
    must(
      shortRef(raw.attempt) &&
        digestRef(raw.digest) &&
        member(raw.provenance, ['owned', 'foreign', 'ambiguous', 'absent', 'unavailable']),
    );
  } else if (kind === 'reconciliation') {
    object(raw, ['attempt', 'decision', 'review', 'inventory']);
    must(
      shortRef(raw.attempt) &&
        shortRef(raw.review) &&
        digestRef(raw.inventory) &&
        member(raw.decision, ['confirm_success', 'confirm_no_effect']),
    );
  } else object(raw, []);
}

function validate(raw: unknown): asserts raw is RecordEvent {
  object(raw, [
    'v',
    'kind',
    'operationId',
    'domain',
    'epoch',
    'sequence',
    'previous',
    'data',
    'digest',
  ]);
  must(
    raw.v === 1 && member(raw.kind, kinds) && shortRef(raw.operationId) && digestRef(raw.domain),
  );
  must(
    integer(raw.epoch, 0, 1_000_000) &&
      integer(raw.sequence, 1, 4096) &&
      digestRef(raw.previous) &&
      digestRef(raw.digest),
  );
  validateData(raw.kind as Kind, raw.data);
  const { digest: recorded, ...body } = raw;
  must(recorded === digest(body));
}

// Pinned MODEL-ASCII-JSON-v1: sorted object keys, compact JSON, arrays in order;
// schema permits only ASCII enums/hex IDs and bounded integers. Not general JCS.
export function encode(raw: unknown): string {
  try {
    validate(raw);
    const text = canonical(raw);
    must(Buffer.byteLength(text) <= 65536);
    return text;
  } catch {
    return refuse();
  }
}
export function decode(raw: string | Uint8Array): RecordEvent {
  try {
    must(typeof raw === 'string' || raw instanceof Uint8Array);
    const bytes = typeof raw === 'string' ? Buffer.from(raw) : raw;
    must(
      bytes.byteLength > 0 &&
        bytes.byteLength <= 65536 &&
        !(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191),
    );
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      value: unknown = JSON.parse(text);
    validate(value);
    must(canonical(value) === text);
    return frozen(value);
  } catch {
    return refuse();
  }
}
export function event(
  kind: Kind,
  data: unknown,
  meta: { operationId?: string; domain?: string; epoch?: number; checkpoint?: Checkpoint } = {},
): RecordEvent {
  try {
    validateData(kind, data);
    const values = data as Data;
    const body = {
      v: 1,
      kind,
      operationId: meta.operationId ?? values.operationId,
      domain: meta.domain ?? values.domain,
      epoch: meta.epoch ?? 0,
      sequence: (meta.checkpoint?.count ?? 0) + 1,
      previous: meta.checkpoint?.head ?? zero,
      data: clone(values),
    };
    return decode(canonical({ ...body, digest: digest(body) }));
  } catch {
    return refuse();
  }
}

const complete = (op: Operation) =>
  op.envelope.steps.every((step) =>
    op.attempts.some(
      (a) =>
        a.step === step.id &&
        a.effect === 'observed_success' &&
        a.observation === 'available' &&
        !a.conflict,
    ),
  );
const released = (op: Operation) => op.receipted && op.quiescent && complete(op);
function reduce(state: State, record: RecordEvent) {
  const { data, kind, epoch, sequence } = record;
  if (kind === 'operation') {
    const envelope = data as Envelope;
    must(
      epoch === 0 &&
        record.operationId === envelope.operationId &&
        record.domain === envelope.domain,
    );
    must(
      !state.operations.some(
        (op) =>
          op.envelope.operationId === record.operationId ||
          (op.envelope.domain === record.domain && !released(op)),
      ),
    );
    state.operations.push({
      envelope: clone(envelope),
      epoch: 0,
      holder: '',
      active: false,
      quiescent: true,
      receipted: false,
      attempts: [],
    });
    return;
  }
  const op = state.operations.find((entry) => entry.envelope.operationId === record.operationId);
  must(op && op.envelope.domain === record.domain);
  must(state.operations.findLast((entry) => entry.envelope.domain === record.domain) === op);
  if (kind !== 'receipt') op.receipted = false;
  if (kind === 'coordination') {
    if (data.state === 'acquired') {
      must(!op.active && op.quiescent && epoch > (state.epochs[record.domain] ?? 0));
      op.epoch = epoch;
      state.epochs[record.domain] = epoch;
      op.holder = data.holder as string;
      op.active = true;
      op.quiescent = false;
    } else {
      must(epoch === op.epoch && data.holder === op.holder && (op.active || !op.quiescent));
      if (data.state === 'lost') {
        must(op.active);
        op.active = false;
        op.quiescent = false;
      } else {
        op.active = false;
        op.quiescent = true;
      }
    }
    return;
  }
  must(epoch === op.epoch);
  if (kind === 'receipt') {
    op.receipted = true;
    return;
  }
  must(op.active);
  if (kind === 'intent') {
    must(
      !op.attempts.some(
        (a) => a.effect === 'unknown' || a.observation === 'unavailable' || a.conflict,
      ),
    );
    const step = op.envelope.steps.find(
      (s) => !op.attempts.some((a) => a.step === s.id && a.effect === 'observed_success'),
    );
    must(step && step.id === data.step && !op.attempts.some((a) => a.id === data.attempt));
    must(
      op.attempts
        .filter((a) => a.step === step.id)
        .every((a) => a.effect === 'observed_no_effect' && a.reviewed),
    );
    op.attempts.push({
      id: data.attempt as string,
      step: step.id,
      resource: step.resource,
      effect: 'unknown',
      observation: 'available',
      dispatched: false,
      reviewed: false,
      outcomeUsed: false,
      lastObservation: sequence,
      conflict: false,
      inventory: null,
    });
    return;
  }
  const attempt = op.attempts.find((entry) => entry.id === data.attempt);
  must(attempt);
  if (kind === 'dispatch') {
    must(
      !attempt.dispatched &&
        !attempt.outcomeUsed &&
        !attempt.reviewed &&
        attempt.effect === 'unknown',
    );
    attempt.dispatched = true;
  } else if (kind === 'outcome') {
    must(!attempt.outcomeUsed && !attempt.reviewed && attempt.effect === 'unknown');
    attempt.effect = data.effect as Effect;
    attempt.observation = data.observation as Attempt['observation'];
    attempt.outcomeUsed = true;
    attempt.lastObservation = sequence;
  } else if (kind === 'inventory') {
    attempt.inventory = {
      provenance: data.provenance as string,
      digest: data.digest as string,
      epoch,
      sequence,
    };
    attempt.observation = data.provenance === 'unavailable' ? 'unavailable' : 'available';
    attempt.conflict ||=
      !member(data.provenance, ['owned', 'absent']) ||
      (attempt.effect === 'observed_success' && data.provenance !== 'owned') ||
      (attempt.effect === 'observed_no_effect' && data.provenance !== 'absent');
  } else {
    const inventory = attempt.inventory;
    must(
      inventory &&
        inventory.epoch === epoch &&
        inventory.sequence > attempt.lastObservation &&
        inventory.digest === data.inventory &&
        data.review === op.envelope.review,
    );
    must(
      data.decision === 'confirm_success'
        ? inventory.provenance === 'owned'
        : inventory.provenance === 'absent',
    );
    const effect = data.decision === 'confirm_success' ? 'observed_success' : 'observed_no_effect';
    must(attempt.effect === 'unknown' || attempt.effect === effect);
    attempt.effect = effect;
    attempt.observation = 'available';
    attempt.reviewed = true;
    attempt.conflict = false;
    attempt.lastObservation = sequence;
  }
}

export function memoryJournal(records: readonly string[] = [], trusted?: Checkpoint) {
  let state: State = { operations: [], epochs: {} },
    online = true;
  const stored: RecordEvent[] = [];
  const checkpoint = () => frozen({ count: stored.length, head: stored.at(-1)?.digest ?? zero });
  function append(raw: string, expected: Checkpoint) {
    must(online);
    object(expected, ['count', 'head']);
    const current = checkpoint();
    must(expected.count === current.count && expected.head === current.head);
    const record = decode(raw);
    if (stored.some((entry) => entry.digest === record.digest)) return 'duplicate' as const;
    must(record.sequence === current.count + 1 && record.previous === current.head);
    const next = clone(state);
    reduce(next, record); // Commit model event/index together only after all checks.
    state = next;
    stored.push(record);
    return 'appended' as const;
  }
  must(records.length <= 4096 && (records.length === 0 || trusted));
  for (const raw of records) append(raw, checkpoint());
  must(stored.length === records.length);
  if (trusted) {
    object(trusted, ['count', 'head']);
    must(trusted.count === stored.length && trusted.head === checkpoint().head);
  }
  return {
    checkpoint,
    append,
    available(value: boolean) {
      must(typeof value === 'boolean');
      online = value;
    },
    events: () => frozen(clone(stored)),
    receipt: () =>
      frozen({
        scope: 'disposable-journal-model',
        kind: 'technical_receipt',
        checkpoint: checkpoint(),
        observationAvailable: online,
        operations: state.operations.map((op) => ({
          operationId: op.envelope.operationId,
          domain: op.envelope.domain,
          epoch: op.epoch,
          disposition:
            !online ||
            op.attempts.some(
              (a) => a.effect === 'unknown' || a.observation === 'unavailable' || a.conflict,
            ) ||
            (!op.active && !op.quiescent)
              ? 'quarantined'
              : released(op)
                ? 'technical_evidence_only'
                : 'awaiting_reconciliation',
          active: op.active,
          quiescent: op.quiescent,
          attempts: clone(op.attempts),
          plannedSteps: op.envelope.steps.map((step) => ({
            step: step.id,
            effect:
              op.attempts.findLast((attempt) => attempt.step === step.id)?.effect ??
              'not_dispatched',
          })),
        })),
        authenticated: false,
        independentDurability: false,
        targetFencing: false,
        runtimeAdmission: false,
        hostedAccepted: false,
        productActivation: false,
        sqlDispatches: 0,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
      }),
  };
}
export type Journal = ReturnType<typeof memoryJournal>;
