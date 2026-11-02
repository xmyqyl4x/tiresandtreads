import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAcceptanceInputReview } from '../../scripts/review/input-contract.mjs';

const read = (name: string) =>
  JSON.parse(readFileSync('docs/implementation/evidence/P1/' + name, 'utf8'));
function inputs() {
  return {
    register: read('s3-service-register.json'),
    decisions: read('p1-pr-027-staging-decision.json'),
    operations: read('p1-pr-027-staging-operations-budget.json'),
    specialist: read('p1-pr-017-golden-review.json'),
  };
}
it('reports missing actual inputs while preserving proposed decisions and six pending gates', () => {
  const report = buildAcceptanceInputReview(inputs());
  expect(report).toMatchObject({
    schemaVersion: 1,
    scope: 'held-planning-input-review',
    status: 'pending-external-inputs',
    counts: { gates: 6, decisions: 8, assignments: 7, budgetFields: 9, coverageFields: 7 },
    specialist: { draftCases: 98, actualReviews: 0, minimumRequired: 50 },
    accepted: false,
    endpointImplementationAllowed: false,
    publicActivation: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
  expect(report.gates.map((g) => g.id)).toEqual([
    'G1-specialist',
    'G1-fitment-catalog',
    'G1-prices',
    'G2-provider-effects',
    'G2-privacy-policy',
    'S3-service-host',
  ]);
  expect(report.missingInputs).toContainEqual({
    source: 'operations',
    field: 'approved.allInMonthlyBudgetCents',
    reason: 'unconfirmed',
  });
});
it('never treats accumulated local evidence, proposals or a recommendation as actual acceptance', () => {
  const input = inputs();
  input.decisions.recommendation.provider = 'SYNTHETIC_PRIVATE_PROVIDER';
  input.decisions.recommendation.region = 'SYNTHETIC_PRIVATE_REGION';
  input.register.gates[5].localEvidence.push('synthetic-local-proof');
  const report = buildAcceptanceInputReview(input);
  expect(report.accepted).toBe(false);
  expect(report.counts.gates).toBe(6);
  expect(JSON.stringify(report)).not.toContain('SYNTHETIC_PRIVATE');
  expect(JSON.stringify(report)).not.toContain('synthetic-local-proof');
});
for (const [name, change] of [
  [
    'gate activation',
    (i: ReturnType<typeof inputs>) => {
      i.register.endpointImplementationAllowed = true;
    },
  ],
  [
    'actual gate record',
    (i: ReturnType<typeof inputs>) => {
      i.register.gates[1].records.push({
        kind: 'provider',
        path: 'local',
        reviewer: 'SYNTHETIC_SECRET',
      });
    },
  ],
  [
    'accepted gate',
    (i: ReturnType<typeof inputs>) => {
      i.register.gates[3].status = 'accepted';
    },
  ],
  [
    'missing gate',
    (i: ReturnType<typeof inputs>) => {
      i.register.gates.pop();
    },
  ],
  [
    'duplicate gate',
    (i: ReturnType<typeof inputs>) => {
      i.register.gates[1] = i.register.gates[0];
    },
  ],
  [
    'relabelled gate',
    (i: ReturnType<typeof inputs>) => {
      i.register.gates[1].kind = 'fixture';
    },
  ],
  [
    'approved decision',
    (i: ReturnType<typeof inputs>) => {
      i.decisions.decisions[0].status = 'approved';
    },
  ],
  [
    'selected value',
    (i: ReturnType<typeof inputs>) => {
      i.decisions.selectedProvider = 'SYNTHETIC_SECRET';
    },
  ],
  [
    'decision approver',
    (i: ReturnType<typeof inputs>) => {
      i.decisions.decisions[0].actualApprover = 'SYNTHETIC_SECRET';
    },
  ],
  [
    'duplicate decision',
    (i: ReturnType<typeof inputs>) => {
      i.decisions.decisions[1] = i.decisions.decisions[0];
    },
  ],
  [
    'spending authorization',
    (i: ReturnType<typeof inputs>) => {
      i.decisions.authorization.purchases = true;
    },
  ],
  [
    'operator assignment',
    (i: ReturnType<typeof inputs>) => {
      i.operations.assignments[0].actualPerson = 'SYNTHETIC_SECRET';
    },
  ],
  [
    'accepted coverage',
    (i: ReturnType<typeof inputs>) => {
      i.operations.coverage.businessHoursCommitted = true;
    },
  ],
  [
    'actual alert destination',
    (i: ReturnType<typeof inputs>) => {
      i.operations.coverage.alertDestination = 'SYNTHETIC_SECRET';
    },
  ],
  [
    'approved zero cost',
    (i: ReturnType<typeof inputs>) => {
      i.operations.approved.laborHourlyRateCents = 0;
    },
  ],
  [
    'selected operating model',
    (i: ReturnType<typeof inputs>) => {
      i.operations.candidate.selected = true;
    },
  ],
  [
    'named specialist review',
    (i: ReturnType<typeof inputs>) => {
      i.specialist.scenarios[0].specialistReview.status = 'accepted';
    },
  ],
  [
    'inconsistent scenario count',
    (i: ReturnType<typeof inputs>) => {
      i.specialist.scenarioCount++;
    },
  ],
  [
    'duplicate scenario',
    (i: ReturnType<typeof inputs>) => {
      i.specialist.scenarios[1] = i.specialist.scenarios[0];
    },
  ],
] as const)
  it(`requires manual reconciliation after ${name}, without echoing submitted values`, () => {
    const input = inputs();
    change(input);
    expect(() => buildAcceptanceInputReview(input)).toThrow('Manual input reconciliation required');
    try {
      buildAcceptanceInputReview(input);
    } catch (error) {
      expect(String(error)).not.toContain('SYNTHETIC_SECRET');
    }
  });
it('rejects malformed or oversized input collections rather than truncating them', () => {
  for (const malformed of [null, [], {}, { ...inputs(), specialist: null }])
    expect(() => buildAcceptanceInputReview(malformed)).toThrow(
      'Manual input reconciliation required',
    );
  const input = inputs();
  input.specialist.scenarios = Array(1001).fill(input.specialist.scenarios[0]);
  input.specialist.scenarioCount = 1001;
  expect(() => buildAcceptanceInputReview(input)).toThrow('Manual input reconciliation required');
});
it('does not mutate input files or retain mutable references across reports', () => {
  const input = inputs(),
    before = JSON.stringify(input);
  const first = buildAcceptanceInputReview(input);
  first.missingInputs.splice(0);
  first.gates[0]!.id = 'changed-output';
  expect(JSON.stringify(input)).toBe(before);
  expect(buildAcceptanceInputReview(input).gates[0]!.id).toBe('G1-specialist');
  expect(buildAcceptanceInputReview(input).missingInputs.length).toBeGreaterThan(30);
});
