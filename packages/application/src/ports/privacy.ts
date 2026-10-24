import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { ConsentPurpose } from '../../../domain/src/entities/consent.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Contact, Envelope, KeyDigest, Owner } from './private-records.ts';
import type { Page, PageRequest } from './pagination.ts';
export interface Permission {
  readonly subjectId: Id<'subject'>;
  readonly purpose: ConsentPurpose;
  readonly scope: string;
  readonly revision: Revision;
  readonly status: 'unknown' | 'pending' | 'confirmed' | 'withdrawn' | 'expired';
  readonly eventId: Id<'consent_event'> | null;
  readonly expiresAt: Instant | null;
}
// Trusted service ports. Authentication, confirmation and purpose-policy decisions precede writes.
export interface PrivacyRepository {
  registerContact(
    tx: Tx,
    input: Readonly<{
      id: Id<'contact'>;
      subjectId: Id<'subject'>;
      keys: readonly KeyDigest[];
      envelope: Envelope;
      // Include every other subject the service will mutate in this transaction.
      guardSubjects?: readonly Id<'subject'>[];
    }>,
  ): Promise<Contact>;
  contact(tx: Tx, id: Id<'contact'>): Promise<Contact | null>;
  confirmContact(tx: Tx, id: Id<'contact'>, expected: Revision): Promise<Contact>;
  rotateContact(
    tx: Tx,
    id: Id<'contact'>,
    expected: Revision,
    envelope: Envelope,
  ): Promise<Contact>;
  permission(
    tx: Tx,
    subjectId: Id<'subject'>,
    purpose: ConsentPurpose,
    scope: string,
  ): Promise<Permission>;
  consent(
    tx: Tx,
    input: Readonly<{
      id: Id<'consent_event'>;
      subjectId: Id<'subject'>;
      purpose: ConsentPurpose;
      scope: string;
      expectedRevision: Revision;
      action: 'grant' | 'confirm' | 'withdraw' | 'expire';
      noticeId: Id<'notice'>;
      policyVersion: string;
      method: string;
      expiresAt: Instant | null;
    }>,
  ): Promise<Permission>;
  suppress(
    tx: Tx,
    input: Readonly<{
      subjectId: Id<'subject'>;
      scope: string;
      reason: string;
      expiresAt: Instant | null;
    }>,
  ): Promise<void>;
  suppressed(tx: Tx, subjectId: Id<'subject'>, scopes: readonly string[]): Promise<boolean>;
  privateReport(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
  ): Promise<Readonly<{ envelope: Envelope; revision: Revision; expiresAt: Instant }> | null>;
  savePrivateReport(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    expected: Revision | null,
    envelope: Envelope,
    expiresAt: Instant,
  ): Promise<Revision>;
  request(
    tx: Tx,
    input: Readonly<{
      id: Id<'privacy_request'>;
      subjectId: Id<'subject'>;
      kind: 'access' | 'delete' | 'correct' | 'restrict' | 'opt_out' | 'export';
      jurisdiction: string;
      policyVersion: string;
      dueAt: Instant;
      steps: readonly Readonly<{ store: string; action: string }>[];
    }>,
  ): Promise<void>;
  steps(
    tx: Tx,
    subjectId: Id<'subject'>,
    requestId: Id<'privacy_request'>,
  ): Promise<readonly PrivacyStep[]>;
  finishStep(
    tx: Tx,
    subjectId: Id<'subject'>,
    requestId: Id<'privacy_request'>,
    stepId: Id<'privacy_step'>,
    expected: Revision,
    status: 'completed' | 'exempted' | 'failed' | 'manual_review',
    evidenceDigest: string,
  ): Promise<Revision>;
  resources(
    tx: Tx,
    subjectId: Id<'subject'>,
    kind: 'report' | 'session' | 'contact' | 'send' | 'asset' | 'request',
    page: PageRequest,
  ): Promise<Page<PrivacyResource>>;
  restrict(tx: Tx, subjectId: Id<'subject'>): Promise<void>;
  marker(
    tx: Tx,
    input: Readonly<{
      kind: string;
      key: KeyDigest;
      policyVersion: string;
      expiresAt: Instant | null;
    }>,
  ): Promise<void>;
  marked(tx: Tx, kind: string, keys: readonly KeyDigest[]): Promise<boolean>;
}
export interface PrivacyStep {
  readonly id: Id<'privacy_step'>;
  readonly store: string;
  readonly action: string;
  readonly status: string;
  readonly revision: Revision;
  readonly evidenceDigest: string | null;
}
export interface PrivacyResource {
  readonly id: Id<'resource'>;
  readonly kind: string;
}
