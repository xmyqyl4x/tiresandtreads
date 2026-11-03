import type { RecordedRestore } from './restore-catalog.mjs';
export interface RestoreReadiness {
  schemaVersion: number;
  scope: string;
  currentCheck: string;
  status: string;
  pinScope: Record<string, number>;
  priorExceptions: number;
  localToolExceptions: number;
  newExceptions: number;
  fileReview: {
    filesChecked: number;
    bytesRead: number;
    matchedPins: number;
    issues: { path: string; code: string }[];
  };
  reviewedPaths: string[];
  recordedHandoff: RecordedRestore | null;
  acceptanceInputReview: unknown;
  historicalUnknownAdmissionReceipts: number | null;
  historicalExecutionOnly: boolean;
  fixtureExecutions: number;
  gitHistoryVerifiedNow: boolean;
  ciReexecutedNow: boolean;
  accepted: boolean;
  endpointImplementationAllowed: boolean;
  publicActivation: boolean;
  runtimeAdmission: boolean;
  independentDurability: boolean;
  authenticated: boolean;
  targetFencing: boolean;
  hostedAccepted: boolean;
  providerDispatches: number;
  actualRecipientNotifications: number;
  casesClosed: number;
  gatesClosed: number;
}
export function reviewRestoreEvidence(root: string): RestoreReadiness;
