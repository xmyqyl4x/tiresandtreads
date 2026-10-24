import type { Evidence, Id, Instant, Revision } from '../values/index.ts';
export type ConsentPurpose =
  | 'report'
  | 'offers'
  | 'lifecycle'
  | 'identity_sharing'
  | 'analytics'
  | 'ads'
  | 'targeted_ads'
  | 'necessary';
// Absence is unknown/denied by policy, never an implicit grant. No contact plaintext belongs here.
export type ConsentDecision =
  | Readonly<{ state: 'unknown' }>
  | Readonly<{
      state: 'pending' | 'confirmed' | 'withdrawn' | 'expired';
      evidenceId: Id<'consent_event'>;
      effectiveAt: Instant;
    }>;
export interface ConsentProjection {
  readonly subjectId: Id<'subject'>;
  readonly scopeKey: string;
  readonly purpose: ConsentPurpose;
  readonly revision: Revision;
  readonly decision: ConsentDecision;
  readonly expiresAt: Evidence<Instant>;
}
