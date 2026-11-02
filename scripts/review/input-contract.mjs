const gateKinds = {
  'G1-specialist': 'human_review',
  'G1-fitment-catalog': 'provider',
  'G1-prices': 'provider',
  'G2-provider-effects': 'provider',
  'G2-privacy-policy': 'human_review',
  'S3-service-host': 'technical_integration',
};
const roles = [
  'budgetOwner',
  'primaryPlatformOperator',
  'backupPlatformOperator',
  'databaseRecoveryOwner',
  'securityKeyCustodian',
  'privacyReviewer',
  'releaseReviewer',
];
const budgetFields = [
  'recurringInfrastructureCeilingCents',
  'temporaryMonthlyCeilingCents',
  'temporaryPerEventCeilingCents',
  'setupHardwareCeilingCents',
  'laborHourlyRateCents',
  'monthlyLaborHours',
  'monthlySupportRetainerCents',
  'taxInvoiceCents',
  'allInMonthlyBudgetCents',
];
const coverageFields = [
  'timeZone',
  'days',
  'start',
  'end',
  'primaryContact',
  'backupContact',
  'alertDestination',
];
const selections = [
  'selectedProvider',
  'selectedRegion',
  'selectedDatabaseModel',
  'approvedMonthlyBudgetUsd',
  'primaryOperator',
  'backupOperator',
];
function must(value) {
  if (!value) throw Error('Manual input reconciliation required');
}
function object(value) {
  must(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}
function ordered(rows, ids, key) {
  must(Array.isArray(rows) && rows.length === ids.length);
  must(rows.every((row, index) => object(row)[key] === ids[index]));
}
function noAuthorization(input) {
  const auth = object(input);
  for (const key of [
    'provisioning',
    'purchases',
    'accountCreation',
    'cloudAuthentication',
    'notifications',
    'remoteDeployment',
    'productApiImplementation',
  ])
    must(auth[key] === false);
}
export function buildAcceptanceInputReview(raw) {
  const input = object(raw),
    register = object(input.register),
    decisions = object(input.decisions),
    operations = object(input.operations),
    specialist = object(input.specialist);
  must(register.schemaVersion === 1 && register.stage === 'S3');
  for (const key of ['acceptanceRequested', 'endpointImplementationAllowed', 'publicActivation'])
    must(register[key] === false);
  const gateIds = Object.keys(gateKinds);
  ordered(register.gates, gateIds, 'id');
  for (const gate of register.gates)
    must(
      gate.kind === gateKinds[gate.id] &&
        gate.status === 'pending' &&
        Array.isArray(gate.records) &&
        gate.records.length === 0,
    );
  must(decisions.schemaVersion === 1 && operations.schemaVersion === 1);
  noAuthorization(decisions.authorization);
  noAuthorization(operations.authorization);
  for (const key of ['dnsChanges']) must(decisions.authorization[key] === false);
  for (const key of selections) must(decisions[key] === null);
  const decisionIds = Array.from({ length: 8 }, (_, index) => 'HS0' + (index + 1));
  ordered(decisions.decisions, decisionIds, 'id');
  must(
    Array.isArray(decisions.pendingGates) &&
      JSON.stringify(decisions.pendingGates) === JSON.stringify(gateIds),
  );
  const disposition = object(decisions.disposition);
  must(
    disposition.parent === 'P1-PR-027' &&
      disposition.parentStatus === 'in progress' &&
      disposition.S3 === 'open' &&
      disposition.specialistReview === 'pending' &&
      disposition.licensedAdapters === 'pending' &&
      disposition.productApis === 'held' &&
      disposition.hostedProofs === 'not run',
  );
  for (const decision of decisions.decisions)
    must(
      decision.status === 'proposed' &&
        decision.approvedValue === null &&
        decision.actualApprover === null,
    );
  const candidate = object(operations.candidate),
    approved = object(operations.approved),
    coverage = object(operations.coverage);
  must(candidate.selected === false);
  for (const key of ['provider', 'region', 'databaseOperatingModel']) must(candidate[key] === null);
  for (const key of budgetFields) must(approved[key] === null);
  for (const key of coverageFields) must(coverage[key] === null);
  must(coverage.businessHoursCommitted === false && coverage.onCall24x7 === false);
  ordered(operations.assignments, roles, 'role');
  for (const assignment of operations.assignments)
    must(
      assignment.actualPerson === null &&
        assignment.acceptedAt === null &&
        assignment.coverageAccepted === false &&
        assignment.candidatePerson === null,
    );
  must(
    specialist.schemaVersion === 1 &&
      specialist.reviewStatus === 'pending' &&
      Array.isArray(specialist.scenarios) &&
      specialist.scenarios.length >= 50 &&
      specialist.scenarios.length <= 1000 &&
      specialist.scenarioCount === specialist.scenarios.length,
  );
  const ids = new Set();
  for (const scenario of specialist.scenarios) {
    object(scenario);
    must(typeof scenario.id === 'string' && /^G\d{3}$/.test(scenario.id) && !ids.has(scenario.id));
    ids.add(scenario.id);
    const review = object(scenario.specialistReview);
    must(review.status === 'pending' && review.reviewer === null && review.reviewedAt === null);
  }
  const missingInputs = [];
  const missing = (source, field) => missingInputs.push({ source, field, reason: 'unconfirmed' });
  for (const key of selections) missing('decisions', key);
  for (const id of decisionIds) {
    missing('decisions', id + '.approvedValue');
    missing('decisions', id + '.actualApprover');
  }
  for (const role of roles) missing('operations', 'assignments.' + role);
  for (const key of budgetFields) missing('operations', 'approved.' + key);
  for (const key of coverageFields) missing('operations', 'coverage.' + key);
  for (const id of gateIds) missing('register', id + '.actualAcceptanceRecords');
  return {
    schemaVersion: 1,
    scope: 'held-planning-input-review',
    status: 'pending-external-inputs',
    counts: {
      gates: gateIds.length,
      decisions: decisionIds.length,
      assignments: roles.length,
      budgetFields: budgetFields.length,
      coverageFields: coverageFields.length,
    },
    gates: gateIds.map((id) => ({ id, status: 'pending', actualRecords: 0 })),
    decisions: decisionIds.map((id) => ({ id, status: 'proposed' })),
    specialist: { draftCases: specialist.scenarioCount, actualReviews: 0, minimumRequired: 50 },
    missingInputs,
    accepted: false,
    endpointImplementationAllowed: false,
    publicActivation: false,
    specialistPending: true,
    licensedPending: true,
    frontendsHeld: true,
    externalCalls: 0,
    casesClosed: 0,
    gatesClosed: 0,
  };
}
