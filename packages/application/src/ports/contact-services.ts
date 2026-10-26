import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { BrowserPurpose } from '../../../domain/src/contact-policy.ts';
import type { Contact, Envelope, KeyDigest, Owner } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export type EmailPurpose = 'report' | 'offers';
export interface ContactIntent {
  readonly id: Id<'verification'>;
  readonly contactId: Id<'contact'>;
  readonly subjectId: Id<'subject'>;
  readonly ownerId: Id<'subject'>;
  readonly purpose: EmailPurpose;
  readonly scope: string;
  readonly noticeId: Id<'notice'>;
  readonly policyVersion: string;
  readonly eventId: Id<'consent_event'>;
  readonly key: KeyDigest;
  readonly expiresAt: Instant;
  readonly usedAt: Instant | null;
  readonly invalidated: boolean;
  readonly live: boolean;
}
export interface ContactServiceRepository {
  guard(tx: Tx, owner: Owner | null, contactId: Id<'contact'>): Promise<Contact>;
  notice(tx: Tx, id: Id<'notice'>, purpose: string, policyVersion: string): Promise<boolean>;
  intent(tx: Tx, id: Id<'verification'>): Promise<ContactIntent | null>;
  createIntent(
    tx: Tx,
    input: Omit<ContactIntent, 'usedAt' | 'invalidated' | 'live'>,
  ): Promise<void>;
  consume(tx: Tx, id: Id<'verification'>): Promise<void>;
  invalidate(tx: Tx, subject: Id<'subject'>, purpose: EmailPurpose, scope: string): Promise<void>;
  clearWithdrawal(tx: Tx, subject: Id<'subject'>, scope: string): Promise<void>;
  confirmationBlocked(tx: Tx, subject: Id<'subject'>, scopes: readonly string[]): Promise<boolean>;
  currentPermission(
    tx: Tx,
    subject: Id<'subject'>,
    purpose: EmailPurpose,
    scope: string,
    notice: Id<'notice'>,
    policy: string,
  ): Promise<boolean>;
  tombstoned(tx: Tx, keys: readonly KeyDigest[], scopes: readonly string[]): Promise<boolean>;
  tombstone(tx: Tx, keys: readonly KeyDigest[], scope: string, reason: string): Promise<void>;
  contactKeys(tx: Tx, id: Id<'contact'>): Promise<readonly KeyDigest[]>;
  cookie(
    tx: Tx,
    owner: Owner,
    noticeId: Id<'notice'>,
    policy: string,
    gpc: boolean,
    allowed: readonly BrowserPurpose[],
    digest: string,
  ): Promise<void>;
  browser(tx: Tx, owner: Owner, policy: string): Promise<readonly BrowserPurpose[]>;
}
export interface ContactCrypto {
  readonly lookupVersions: readonly string[];
  readonly currentTokenVersion: string;
  id<K extends string>(kind: K, stableKey?: string): Id<K>;
  hash(purpose: string, value: string): string;
  emailKeys(normalized: string): readonly KeyDigest[];
  token(
    audience: 'verify' | 'unsubscribe',
    id: Id<'verification'>,
    version: string,
  ): Readonly<{ raw: string; key: KeyDigest }>;
  parse(
    audience: 'verify' | 'unsubscribe',
    raw: string,
  ): Readonly<{ id: Id<'verification'>; key: KeyDigest }> | null;
}
export interface ContactEncryption {
  encrypt(bytes: Uint8Array, purpose: string, id: string): Promise<Envelope>;
  decrypt(value: Envelope, purpose: string, id: string): Promise<Uint8Array>;
}
export interface ContactPolicy {
  readonly version: string;
  readonly notices: Readonly<Record<EmailPurpose | BrowserPurpose | 'necessary', Id<'notice'>>>;
}
export interface ContactRequest {
  readonly email: string;
  readonly report: Readonly<{ id: Id<'report'>; version: number }> | null;
  readonly offers: boolean;
  // These are the notices actually presented. Must equal current server configuration.
  readonly notices: Readonly<Partial<Record<EmailPurpose, Id<'notice'>>>>;
}
export interface BrowserChoices {
  readonly expectedRevision: Revision;
  readonly allowed: readonly BrowserPurpose[];
  readonly gpc: boolean;
  readonly notices: Readonly<Record<BrowserPurpose | 'necessary', Id<'notice'>>>;
}
