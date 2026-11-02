export interface AcceptanceInputReview {
  schemaVersion: 1;
  scope: 'held-planning-input-review';
  status: 'pending-external-inputs';
  counts: {
    gates: number;
    decisions: number;
    assignments: number;
    budgetFields: number;
    coverageFields: number;
  };
  gates: { id: string; status: 'pending'; actualRecords: 0 }[];
  decisions: { id: string; status: 'proposed' }[];
  specialist: { draftCases: number; actualReviews: 0; minimumRequired: 50 };
  missingInputs: { source: string; field: string; reason: 'unconfirmed' }[];
  accepted: false;
  endpointImplementationAllowed: false;
  publicActivation: false;
  specialistPending: true;
  licensedPending: true;
  frontendsHeld: true;
  externalCalls: 0;
  casesClosed: 0;
  gatesClosed: 0;
}
export function buildAcceptanceInputReview(raw: unknown): AcceptanceInputReview;
