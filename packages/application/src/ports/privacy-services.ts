import type { Id, Instant, Revision } from '../../../domain/src/values/core.ts';
import type { RightsKind, RightsPolicy } from '../../../domain/src/privacy-policy.ts';
import type { KeyDigest, Envelope } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { AssetLocation } from './assets.ts';
export interface PrivacyCrypto {
  readonly versions: readonly string[];
  readonly current: string;
  id<K extends string>(kind: K): Id<K>;
  hash(purpose: string, value: string): string;
  markers(kind: string, resource: string): readonly KeyDigest[];
  proof(id: Id<'privacy_request'>, version: string): Readonly<{ raw: string; key: KeyDigest }>;
  parse(raw: string): Readonly<{ id: Id<'privacy_request'>; key: KeyDigest }> | null;
  sign(document: unknown): SignedPrivacyRecord;
  verify(record: unknown): unknown | null;
}
export interface SignedPrivacyRecord {
  readonly keyVersion: string;
  readonly digest: string;
  readonly document: unknown;
}
export interface PrivacyJournal {
  // An acknowledged append must survive loss/restore of the application database.
  append(key: string, record: SignedPrivacyRecord): Promise<void>;
}
export interface PrivacyMail {
  verify(input: Readonly<{ key: string; address: string; proof: string }>): Promise<void>;
  erase(
    input: Readonly<{ provider: string; messageId: string | null; deliveryKey: string }>,
  ): Promise<'erased' | 'not_stored' | 'unsupported'>;
}
export interface PrivacyRequestInput {
  readonly id: Id<'privacy_request'>;
  readonly subjectId: Id<'subject'> | null;
  readonly targetKind: 'subject' | 'report';
  readonly targetId: string | null;
  readonly kind: RightsKind;
  readonly jurisdiction: string;
  readonly policyVersion: string;
  readonly policy: RightsPolicy;
  readonly dueAt: Instant;
  readonly proofExpiresAt: Instant;
  readonly proof: KeyDigest;
  readonly reply: Envelope | null;
  readonly verified: boolean;
  readonly restoreRunId: Id<'restore'> | null;
  readonly ownerProof: KeyDigest | null;
}
export interface RightsStatus {
  readonly id: Id<'privacy_request'>;
  readonly kind: RightsKind;
  readonly status: string;
  readonly dueAt: Instant;
  readonly completedAt: Instant | null;
  readonly error: string | null;
}
export interface PrivacyLease {
  readonly id: Id<'privacy_request'>;
  readonly token: Id<'lease'>;
  readonly generation: Revision;
}
export type PrivacyStage = 'journal' | 'email' | 'objects' | 'analytics' | 'sql';
export interface PrivacyServiceRepository {
  resume(
    tx: Tx,
    keys: readonly KeyDigest[],
  ): Promise<Readonly<{
    id: Id<'privacy_request'>;
    proofVersion: string;
    journaled: boolean;
  }> | null>;
  policy(
    tx: Tx,
    jurisdiction: string,
    version: string,
    kind: RightsKind,
  ): Promise<RightsPolicy | null>;
  contactSubject(tx: Tx, keys: readonly KeyDigest[]): Promise<Id<'subject'> | null>;
  bindContact(
    tx: Tx,
    id: Id<'privacy_request'>,
    proof: KeyDigest,
    keys: readonly KeyDigest[],
  ): Promise<void>;
  create(tx: Tx, input: PrivacyRequestInput): Promise<void>;
  authorize(tx: Tx, id: Id<'privacy_request'>, key: KeyDigest): Promise<RightsStatus>;
  confirm(tx: Tx, id: Id<'privacy_request'>, key: KeyDigest): Promise<void>;
  notification(
    tx: Tx,
    id: Id<'privacy_request'>,
  ): Promise<Readonly<{ envelope: Envelope; keyVersion: string }> | null>;
  notified(tx: Tx, id: Id<'privacy_request'>): Promise<void>;
  journaled(tx: Tx, id: Id<'privacy_request'>, digest: string): Promise<void>;
  restrict(tx: Tx, id: Id<'privacy_request'>): Promise<void>;
  journal(
    tx: Tx,
    id: Id<'privacy_request'>,
  ): Promise<
    Readonly<{
      kind: RightsKind;
      targetKind: string;
      targetId: string | null;
      policy: string;
      contacts: readonly KeyDigest[];
    }>
  >;
  lease(tx: Tx, id: Id<'privacy_request'>): Promise<PrivacyLease | null>;
  stage(tx: Tx, lease: PrivacyLease): Promise<PrivacyStage | null>;
  finishStage(tx: Tx, lease: PrivacyLease, stage: PrivacyStage, digest: string): Promise<void>;
  email(
    tx: Tx,
    lease: PrivacyLease,
  ): Promise<Readonly<{
    id: string;
    provider: string;
    messageId: string | null;
    deliveryKey: string;
    attempted: boolean;
  }> | null>;
  asset(tx: Tx, lease: PrivacyLease): Promise<AssetLocation | null>;
  receipt(
    tx: Tx,
    lease: PrivacyLease,
    store: 'email' | 'objects',
    id: string,
    digest: string,
  ): Promise<void>;
  analytics(tx: Tx, lease: PrivacyLease): Promise<boolean>;
  erase(tx: Tx, lease: PrivacyLease): Promise<boolean>;
  complete(tx: Tx, lease: PrivacyLease): Promise<void>;
  failed(
    tx: Tx,
    lease: PrivacyLease,
    error: 'downstream_unconfirmed' | 'execution_failed',
  ): Promise<void>;
  release(tx: Tx, lease: PrivacyLease): Promise<void>;
  queue(tx: Tx): Promise<readonly RightsStatus[]>;
  retry(tx: Tx, actor: Id<'staff'>, id: Id<'privacy_request'>, evidence: string): Promise<void>;
  review(
    tx: Tx,
    actor: Id<'staff'>,
    id: Id<'privacy_request'>,
    decision: 'fulfilled' | 'rejected',
    evidence: string,
  ): Promise<void>;
  retention(
    tx: Tx,
    dryRun: boolean,
    version: string,
    jurisdiction: string,
  ): Promise<
    readonly Readonly<{ kind: 'subject' | 'report'; id: string; subjectId: Id<'subject'> }>[]
  >;
  cleanup(tx: Tx, dryRun: boolean): Promise<Readonly<Record<string, number>>>;
  replayMarkers(tx: Tx, entries: readonly JournalEntry[]): Promise<void>;
  restoreStart(tx: Tx, id: Id<'restore'>, backupAt: Instant, expected: string): Promise<void>;
  restorePage(
    tx: Tx,
    id: Id<'restore'>,
  ): Promise<
    readonly Readonly<{ kind: 'subject' | 'report'; id: string; subjectId: Id<'subject'> }>[]
  >;
  markedAction(tx: Tx, kind: string, keys: readonly KeyDigest[]): Promise<RightsKind | null>;
  restoreProgress(tx: Tx, id: Id<'restore'>, cursor: string | null): Promise<boolean>;
}
export interface JournalEntry {
  readonly version: 1;
  readonly action: RightsKind;
  readonly resourceKind: 'subject' | 'report';
  readonly markers: readonly KeyDigest[];
  readonly tombstones: readonly KeyDigest[];
  readonly policy: string;
}
