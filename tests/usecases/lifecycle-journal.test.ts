import { expect, it } from 'vitest';
import { encode, event, memoryJournal } from '../fixtures/lifecycle-journal/model.ts';
import {
  id,
  hash,
  operation,
  acquire,
  intent,
  append,
  outcome,
  reconcile,
} from '../fixtures/lifecycle-journal/samples.ts';

function start() {
  const journal = memoryJournal();
  journal.append(encode(operation()), journal.checkpoint());
  acquire(journal);
  return journal;
}

it('retains intent-only uncertainty across reconstructed sessions and blocks blind retry or a new operation ID', () => {
  const first = start();
  intent(first);
  const journal = memoryJournal(first.events().map(encode), first.checkpoint());
  expect(journal.receipt().operations[0]!.attempts[0]).toMatchObject({
    effect: 'unknown',
    observation: 'available',
    dispatched: false,
  });
  expect(() => intent(journal, id(21))).toThrow();
  expect(() =>
    journal.append(
      encode(operation({ operationId: id(2) }, journal.checkpoint())),
      journal.checkpoint(),
    ),
  ).toThrow();
  expect(journal.receipt().operations[0]!.disposition).toBe('quarantined');
});

it('keeps unknown effect and unavailable observation distinct without automatic compensation', () => {
  const journal = start();
  intent(journal);
  append(journal, 'dispatch', { attempt: id(20) });
  outcome(journal, 'unknown', 'unavailable', 'response_lost');
  const snapshot = journal.receipt();
  expect(snapshot.operations[0]!.attempts[0]).toMatchObject({
    effect: 'unknown',
    observation: 'unavailable',
    dispatched: true,
  });
  expect(() =>
    append(journal, 'outcome', {
      attempt: id(20),
      effect: 'observed_success',
      observation: 'available',
      reason: 'synthetic_success',
    }),
  ).toThrow();
  expect(journal.receipt()).toEqual(snapshot);
});

it('stops on simulated journal outage before intent and preserves unknown state after an unacknowledged outcome', () => {
  const journal = start();
  journal.available(false);
  expect(() => intent(journal)).toThrow();
  journal.available(true);
  intent(journal);
  journal.available(false);
  expect(() => outcome(journal)).toThrow();
  journal.available(true);
  const restarted = memoryJournal(journal.events().map(encode), journal.checkpoint());
  expect(restarted.receipt().operations[0]!.attempts[0]!.effect).toBe('unknown');
  expect(() => intent(restarted, id(21))).toThrow();
});

it('requires quiescence and fresh simulated inventory/review before re-entry, without calling it target fencing', () => {
  const journal = start();
  intent(journal);
  append(journal, 'coordination', { state: 'lost', holder: id(30) });
  expect(() => acquire(journal, 2)).toThrow();
  expect(() => outcome(journal)).toThrow();
  append(journal, 'coordination', { state: 'quiescent', holder: id(30) });
  acquire(journal, 2);
  expect(() => intent(journal, id(21), 2)).toThrow();
  expect(() =>
    append(
      journal,
      'reconciliation',
      { attempt: id(20), decision: 'confirm_no_effect', review: id(40), inventory: hash(4) },
      2,
    ),
  ).toThrow();
  reconcile(journal, 'absent', 'confirm_no_effect', 2);
  intent(journal, id(21), 2);
  expect(journal.receipt().targetFencing).toBe(false);
  expect(() => append(journal, 'dispatch', { attempt: id(21) }, 1)).toThrow();
});

it.each(['foreign', 'ambiguous', 'unavailable'] as const)(
  'refuses repair/retry when synthetic inventory is %s and preserves the full prior chain',
  (provenance) => {
    const journal = start();
    intent(journal);
    append(journal, 'inventory', { attempt: id(20), provenance, digest: hash(4) });
    const before = journal.checkpoint();
    expect(() =>
      append(journal, 'reconciliation', {
        attempt: id(20),
        decision: 'confirm_no_effect',
        review: id(40),
        inventory: hash(4),
      }),
    ).toThrow();
    expect(journal.checkpoint()).toEqual(before);
    expect(journal.receipt().operations[0]!.disposition).toBe('quarantined');
  },
);

it('retains a known app success when the CMS observation is unknown; paired labels cannot release a partial operation', () => {
  const journal = start();
  intent(journal);
  outcome(journal);
  intent(journal, id(21), 1, id(11));
  outcome(journal, 'unknown', 'unavailable', 'response_lost', id(21));
  expect(journal.receipt().operations[0]!.attempts.map((a) => a.effect)).toEqual([
    'observed_success',
    'unknown',
  ]);
  append(journal, 'receipt', {});
  expect(journal.receipt().operations[0]!.disposition).toBe('quarantined');
  expect(() => intent(journal, id(22), 1, id(10))).toThrow();
});

it('requires reviewed no-effect evidence for a new attempt and never erases the previous unknown event', () => {
  const journal = start();
  intent(journal);
  outcome(journal, 'unknown', 'available', 'response_lost');
  reconcile(journal, 'absent', 'confirm_no_effect');
  intent(journal, id(21));
  outcome(journal, 'observed_success', 'available', 'synthetic_success', id(21));
  expect(journal.events().some((r) => r.kind === 'outcome' && r.data.effect === 'unknown')).toBe(
    true,
  );
  expect(journal.receipt().operations[0]!.attempts.map((a) => a.effect)).toEqual([
    'observed_no_effect',
    'observed_success',
  ]);
});

it('can only finish as evidence, even after all simulated steps succeed and the simulated domain is released', () => {
  const journal = start();
  intent(journal);
  outcome(journal);
  intent(journal, id(21), 1, id(11));
  outcome(journal, 'observed_success', 'available', 'synthetic_success', id(21));
  append(journal, 'coordination', { state: 'quiescent', holder: id(30) });
  append(journal, 'receipt', {});
  expect(journal.receipt().operations[0]!.disposition).toBe('technical_evidence_only');
  journal.append(
    encode(operation({ operationId: id(2) }, journal.checkpoint())),
    journal.checkpoint(),
  );
  expect(journal.receipt().runtimeAdmission).toBe(false);
  console.log(
    'JOURNAL_STATE_EVIDENCE ' +
      JSON.stringify({
        scope: 'disposable-journal-model',
        simulatedReconstruction: true,
        realProcessRestart: false,
        sqlDispatches: 0,
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
      }),
  );
});

it('refuses an older operation reacquiring the domain after a newer operation is admitted', () => {
  const journal = start();
  intent(journal);
  outcome(journal);
  intent(journal, id(21), 1, id(11));
  outcome(journal, 'observed_success', 'available', 'synthetic_success', id(21));
  append(journal, 'coordination', { state: 'quiescent', holder: id(30) });
  append(journal, 'receipt', {});
  journal.append(
    encode(operation({ operationId: id(2) }, journal.checkpoint())),
    journal.checkpoint(),
  );
  const record = event(
    'coordination',
    { state: 'acquired', holder: id(31) },
    { operationId: id(2), domain: hash(1), epoch: 2, checkpoint: journal.checkpoint() },
  );
  journal.append(encode(record), journal.checkpoint());
  const before = journal.checkpoint();
  expect(() => acquire(journal, 3)).toThrow();
  expect(journal.checkpoint()).toEqual(before);
});

it('quarantines an observed disappearance after known success without rewriting that committed observation', () => {
  const journal = start();
  intent(journal);
  outcome(journal);
  append(journal, 'inventory', { attempt: id(20), provenance: 'absent', digest: hash(4) });
  expect(journal.receipt().operations[0]!.attempts[0]!.effect).toBe('observed_success');
  expect(journal.receipt().operations[0]!.disposition).toBe('quarantined');
  expect(() => reconcile(journal, 'absent', 'confirm_no_effect')).toThrow();
});

it('requires fresh review to clear unavailable inventory after a known success', () => {
  const journal = start();
  intent(journal);
  outcome(journal);
  append(journal, 'inventory', { attempt: id(20), provenance: 'unavailable', digest: hash(4) });
  append(journal, 'inventory', { attempt: id(20), provenance: 'owned', digest: hash(4) });
  expect(journal.receipt().operations[0]!.disposition).toBe('quarantined');
  append(journal, 'reconciliation', {
    attempt: id(20),
    decision: 'confirm_success',
    review: id(40),
    inventory: hash(4),
  });
  expect(journal.receipt().operations[0]!.attempts[0]!.conflict).toBe(false);
});

it('invalidates an early receipt after further coordination and reports an unavailable journal as quarantined', () => {
  const journal = start();
  intent(journal);
  outcome(journal);
  intent(journal, id(21), 1, id(11));
  outcome(journal, 'observed_success', 'available', 'synthetic_success', id(21));
  append(journal, 'receipt', {});
  append(journal, 'coordination', { state: 'quiescent', holder: id(30) });
  expect(journal.receipt().operations[0]!.disposition).not.toBe('technical_evidence_only');
  append(journal, 'receipt', {});
  journal.available(false);
  expect(journal.receipt().operations[0]!.disposition).toBe('quarantined');
});

it.each(['review', 'inventory'] as const)(
  'refuses a mismatched reconciliation %s reference atomically',
  (field) => {
    const journal = start();
    intent(journal);
    append(journal, 'inventory', { attempt: id(20), provenance: 'absent', digest: hash(4) });
    const before = journal.checkpoint();
    expect(() =>
      append(journal, 'reconciliation', {
        attempt: id(20),
        decision: 'confirm_no_effect',
        review: id(40),
        inventory: hash(4),
        [field]: field === 'review' ? id(41) : hash(5),
      }),
    ).toThrow();
    expect(journal.checkpoint()).toEqual(before);
  },
);
