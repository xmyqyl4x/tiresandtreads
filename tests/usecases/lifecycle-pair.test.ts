import { expect, it } from 'vitest';
import { receiptLedger } from '../fixtures/lifecycle-pair/contract.ts';
import { binding, reports } from '../fixtures/lifecycle-pair/samples.ts';

it('requires a new paired observation after a failed handoff, repair or declared generation change', () => {
  const ledger = receiptLedger(binding);
  const original = ledger.issue(ledger.begin(0), reports(), 10)!;
  expect(ledger.consume(original, 20)).toBe(true);
  // A real SQL failure is exercised in the database suite. Neither an old success
  // nor a subsequent repair revives this consumed evidence.
  expect(ledger.consume(original, 30)).toBe(false);
  const next = ledger.issue(ledger.begin(40), reports(), 50)!;
  ledger.invalidate();
  expect(ledger.consume(next, 60)).toBe(false);
  const renewed = ledger.issue(ledger.begin(70), reports(), 80)!;
  expect(ledger.consume(renewed, 90)).toBe(true);
  expect(renewed).toMatchObject({
    hostedAccepted: false,
    productActivation: false,
    runtimeAdmission: false,
  });
});
