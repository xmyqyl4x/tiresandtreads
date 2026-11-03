import type { ReviewPin } from './evidence-catalog.mjs';
export interface RecordedRestore {
  nativeProfiles: number;
  artifactRefusals: number;
  actualRestoreReplayProfiles: number;
  repeatedExistingCustodyExecutions: number;
  newUniqueCustodyTests: number;
  focusedControls: number;
  modeledOnly: string[];
  normalObserverMutationStatements: number;
  separateRejectedWriteProbes: number;
  parentAssertionCountsAreDerived: boolean;
  historicalExecutionOnly: boolean;
  provenance: Record<string, string>;
}
export interface RestoreCatalog {
  sources: ReviewPin[];
  historical: ReviewPin[];
  inputs: ReviewPin[];
  sp08: ReviewPin[];
  proofSources: ReviewPin[];
  all: ReviewPin[];
  recorded: RecordedRestore;
}
export const restoreManifestPaths: readonly string[];
export const proofDocumentPaths: readonly string[];
export function compileRestoreCatalog(raw: unknown): RestoreCatalog;
