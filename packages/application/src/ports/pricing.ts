import type { QuoteInput } from '../../../engine/src/pricing/model.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure } from './transactions.ts';
export interface PricingRequest {
  readonly quoteId: string;
  readonly planId: string | null;
  readonly regionKey: string;
  readonly includeAlignment: boolean;
}
// Trusted server compiler of one coherent offer: enforce ownership, reviewed tax
// scope, source rights, package quantities, current observations and all fee inclusions.
// PR019 supplies the database resolver; client JSON cannot assert these facts.
export interface PricingEvidence {
  load(request: PricingRequest, asOf: string): Promise<Result<QuoteInput, ApplicationFailure>>;
}
