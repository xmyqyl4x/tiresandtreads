import { expect, it } from 'vitest';
import { decode, encode, event, memoryJournal, zero } from '../fixtures/lifecycle-journal/model.ts';
import {
  envelope,
  id,
  hash,
  operation,
  acquire,
  intent,
  append,
} from '../fixtures/lifecycle-journal/samples.ts';

it('round-trips fixed canonical ASCII records without accepting alternate JSON spellings', () => {
  const record = operation();
  expect(decode(encode(record))).toEqual(record);
  expect(encode(record)).toEqual(encode(JSON.parse(encode(record))));
  expect(() => decode(JSON.stringify(record, null, 2))).toThrow('Journal model refused');
  expect(() => decode(encode(record).replace('"v":1', '"v":1,"v":1'))).toThrow(
    'Journal model refused',
  );
});

it.each([
  '',
  '{',
  'null',
  '[]',
  '1e400',
  '{"__proto__":{}}',
  '{"sql":"SELECT private"}',
  'x'.repeat(65537),
])('rejects malformed or expanded raw input case %# with a fixed diagnostic', (raw) => {
  expect(() => decode(raw)).toThrow(/^Journal model refused$/);
});

it.each([
  ['operationId', 'postgresql://secret@host'],
  ['project', 'tt-stage'],
  ['scope', 'hosted'],
  ['phase', 'runtime'],
  ['source', 'main'],
  ['credentialGeneration', 'password'],
  ['review', 'operator-name'],
  ['sql', 'DROP DATABASE'],
])('rejects envelope field %s without echoing its value', (key, value) => {
  expect(() => event('operation', { ...envelope(), [key]: value })).toThrow(
    /^Journal model refused$/,
  );
});

it.each([
  'source',
  'tree',
  'image',
  'config',
  'manifest',
  'release',
  'domain',
  'credentialGeneration',
])('binds the synthetic %s reference as an exact digest', (field) => {
  expect(() => event('operation', { ...envelope(), [field]: 'b'.repeat(63) })).toThrow();
});

it('rejects invalid UTF-8, a BOM, duplicate resources and excessive steps', () => {
  expect(() => decode(new Uint8Array([0xc3, 0x28]))).toThrow(/^Journal model refused$/);
  expect(() =>
    decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(encode(operation()))])),
  ).toThrow();
  expect(() => operation({ resources: ['app', 'app'] })).toThrow();
  expect(() => operation({ resources: Array(65).fill('app') })).toThrow();
  expect(() =>
    operation({
      steps: Array.from({ length: 257 }, (_, n) => ({ id: id(n + 100), resource: 'app' })),
    }),
  ).toThrow();
});

it('refuses changed record digests and unknown fields before append, retaining the old head', () => {
  const journal = memoryJournal();
  const record = operation();
  expect(() =>
    journal.append(JSON.stringify({ ...record, digest: hash(9) }), journal.checkpoint()),
  ).toThrow();
  expect(() => encode({ ...record, token: 'private' })).toThrow(/^Journal model refused$/);
  expect(journal.checkpoint()).toEqual({ count: 0, head: zero });
});

it('conditionally appends atomically, recognizes exact duplicate evidence, and refuses a stale competing append', () => {
  const journal = memoryJournal(),
    initial = journal.checkpoint(),
    record = operation();
  journal.append(encode(record), initial);
  expect(() => journal.append(encode(record), initial)).toThrow();
  expect(journal.append(encode(record), journal.checkpoint())).toBe('duplicate');
  expect(journal.checkpoint().count).toBe(1);
  const before = journal.checkpoint();
  expect(() =>
    append(journal, 'intent', { step: id(10), attempt: id(20), precondition: hash(1) }, 1),
  ).toThrow();
  expect(journal.checkpoint()).toEqual(before);
});

it('freezes views and detaches caller-owned record objects', () => {
  const journal = memoryJournal(),
    record = operation();
  journal.append(encode(record), journal.checkpoint());
  record.data.resources.reverse();
  expect(journal.events()[0]).not.toEqual(record);
  expect(Object.isFrozen(journal.events()[0]!.data)).toBe(true);
  expect(Object.isFrozen(journal.receipt().operations)).toBe(true);
});

it.each(['observed_success', 'observed_no_effect'] as const)(
  'rejects %s with unavailable observation or an unrelated reason',
  (effect) => {
    const journal = memoryJournal();
    journal.append(encode(operation()), journal.checkpoint());
    acquire(journal);
    intent(journal);
    for (const data of [
      { attempt: id(20), effect, observation: 'unavailable', reason: 'response_lost' },
      { attempt: id(20), effect, observation: 'available', reason: 'response_lost' },
    ])
      expect(() => append(journal, 'outcome', data)).toThrow();
    expect(journal.receipt().operations[0]!.attempts[0]!.effect).toBe('unknown');
  },
);

it('requires a trusted simulated current checkpoint for reconstruction and refuses gaps, reorder and truncation', () => {
  const journal = memoryJournal();
  journal.append(encode(operation()), journal.checkpoint());
  acquire(journal);
  intent(journal);
  const records = journal.events().map(encode),
    checkpoint = journal.checkpoint();
  expect(memoryJournal(records, checkpoint).receipt()).toEqual(journal.receipt());
  for (const raw of [records.slice(0, -1), [...records].reverse(), [records[0]!, records[2]!]])
    expect(() => memoryJournal(raw, checkpoint)).toThrow();
  expect(() => memoryJournal(records, { ...checkpoint, head: hash(9) })).toThrow();
});

it('rejects exported receipts as appendable authority and exposes no activation or claimed real effects', () => {
  const journal = memoryJournal();
  journal.append(encode(operation()), journal.checkpoint());
  const receipt = journal.receipt();
  expect(() => journal.append(JSON.stringify(receipt), journal.checkpoint())).toThrow();
  expect(receipt).toMatchObject({
    scope: 'disposable-journal-model',
    runtimeAdmission: false,
    hostedAccepted: false,
    productActivation: false,
    sqlDispatches: 0,
    providerDispatches: 0,
    actualRecipientNotifications: 0,
    authenticated: false,
    independentDurability: false,
    targetFencing: false,
  });
});

it('makes the lack of checkpoint authentication observable: a self-consistent replacement plus its own checkpoint is accepted as simulation only', () => {
  const real = memoryJournal(),
    replacement = memoryJournal();
  real.append(encode(operation()), real.checkpoint());
  replacement.append(encode(operation({ source: hash(77) })), replacement.checkpoint());
  expect(() => memoryJournal(replacement.events().map(encode), real.checkpoint())).toThrow();
  const simulated = memoryJournal(replacement.events().map(encode), replacement.checkpoint());
  expect(simulated.receipt().authenticated).toBe(false);
  expect(simulated.events()).not.toEqual(real.events());
});

it('reports no dispatched effect for planned steps when admission fails before intent', () => {
  const journal = memoryJournal();
  journal.append(encode(operation()), journal.checkpoint());
  acquire(journal);
  journal.available(false);
  expect(() => intent(journal)).toThrow();
  expect(journal.receipt().operations[0]!.plannedSteps.map((s) => s.effect)).toEqual([
    'not_dispatched',
    'not_dispatched',
  ]);
});
