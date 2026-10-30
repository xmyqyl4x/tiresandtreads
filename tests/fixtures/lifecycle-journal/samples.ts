import {
  event,
  encode,
  type Checkpoint,
  type Envelope,
  type Journal,
  type Kind,
  type RecordEvent,
} from './model.ts';

export const id = (n: number) => n.toString(16).padStart(32, '0');
export const hash = (n: number) => n.toString(16).padStart(64, '0');
export function envelope(patch: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    scope: 'disposable-journal-model',
    operationId: id(1),
    project: 'tt-test-0000000000000001',
    domain: hash(1),
    source: hash(2),
    tree: hash(3),
    image: hash(4),
    config: hash(5),
    manifest: hash(6),
    release: hash(7),
    credentialGeneration: hash(8),
    review: id(40),
    phase: 'foundation',
    resources: ['app', 'cms', 'roles'],
    steps: [
      { id: id(10), resource: 'app' },
      { id: id(11), resource: 'cms' },
    ],
    ...patch,
  };
}
export function operation(
  patch: Partial<Envelope> = {},
  checkpoint?: Checkpoint,
): RecordEvent & { data: Envelope } {
  return JSON.parse(encode(event('operation', envelope(patch), checkpoint ? { checkpoint } : {})));
}
export function append(journal: Journal, kind: Kind, data: unknown, epoch = 1) {
  const record = event(kind, data, {
    operationId: id(1),
    domain: hash(1),
    epoch,
    checkpoint: journal.checkpoint(),
  });
  return journal.append(encode(record), journal.checkpoint());
}
export function acquire(journal: Journal, epoch = 1) {
  return append(journal, 'coordination', { state: 'acquired', holder: id(30) }, epoch);
}
export function intent(journal: Journal, attempt = id(20), epoch = 1, step = id(10)) {
  return append(journal, 'intent', { attempt, step, precondition: hash(1) }, epoch);
}
export function outcome(
  journal: Journal,
  effect = 'observed_success',
  observation = 'available',
  reason = 'synthetic_success',
  attempt = id(20),
  epoch = 1,
) {
  return append(journal, 'outcome', { attempt, effect, observation, reason }, epoch);
}
export function reconcile(
  journal: Journal,
  provenance = 'absent',
  decision = 'confirm_no_effect',
  epoch = 1,
) {
  append(journal, 'inventory', { attempt: id(20), provenance, digest: hash(4) }, epoch);
  return append(
    journal,
    'reconciliation',
    { attempt: id(20), decision, inventory: hash(4), review: id(40) },
    epoch,
  );
}
