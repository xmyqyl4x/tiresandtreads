import type { AssessmentInput, EngineSnapshot } from '../../../engine/src/model.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure } from './transactions.ts';
// Trusted server resolver: pin one bundle, bind facts/rights/scope, check current recall
// health, authorize inspection records, and verify actual policy review evidence.
// PR 019 composes it with catalog/report repositories. It is never a client payload.
export interface RecommendationEvidence {
  load(input: AssessmentInput, asOf: string): Promise<Result<EngineSnapshot, ApplicationFailure>>;
}
