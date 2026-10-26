import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { FixedMail } from '../../../domain/src/delivery-policy.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Contact, Owner, Send, Version } from './private-records.ts';
import type { JsonObject } from './catalog-records.ts';
export interface DeliveryDocument {
  readonly schemaVersion: 1;
  readonly fixture: boolean;
  readonly locale: string;
  readonly market: string;
  readonly sender: string;
  readonly policyVersion: string;
  readonly report: JsonObject;
  readonly comparison: JsonObject | null;
  readonly template: Readonly<{ id: Id<'template'>; version: string; rendererHash: string }>;
  readonly learning: readonly Readonly<{ path: string; title: string; expiresAt: string }>[];
}
export interface FrozenDelivery {
  readonly schemaVersion: 1;
  readonly from: string;
  readonly recipient: string;
  readonly mail: FixedMail;
}
export interface DeliveryLease {
  readonly id: Id<'send'>;
  readonly token: Id<'lease'>;
  readonly generation: Revision;
  readonly document: DeliveryDocument;
  readonly send: Send;
  readonly contact: Contact;
  readonly firstAttemptAt: Instant | null;
  readonly attempts: number;
  readonly failures: number;
  readonly payloadId: Id<'asset'> | null;
  readonly payloadHash: string | null;
}
export interface DeliveryWorkRepository {
  presentation(
    tx: Tx,
    reportId: Id<'report'>,
  ): Promise<Readonly<{ locale: string; market: string }>>;
  capture(
    tx: Tx,
    input: Readonly<{
      send: Send;
      owner: Owner;
      verificationId: Id<'verification'>;
      offersId: Id<'verification'> | null;
      document: DeliveryDocument;
    }>,
  ): Promise<void>;
  template(
    tx: Tx,
    id: Id<'template'>,
    locale: string,
  ): Promise<DeliveryDocument['template'] | null>;
  learning(
    tx: Tx,
    version: Version,
    locale: string,
    market: string,
  ): Promise<DeliveryDocument['learning']>;
  acquire(tx: Tx, id: Id<'send'>): Promise<DeliveryLease | null>;
  fence(tx: Tx, l: DeliveryLease): Promise<void>;
  permission(tx: Tx, l: DeliveryLease): Promise<Revision>;
  freeze(
    tx: Tx,
    l: DeliveryLease,
    payloadId: Id<'asset'>,
    pdfId: Id<'asset'>,
    hash: string,
  ): Promise<void>;
  attempt(tx: Tx, l: DeliveryLease): Promise<void>;
  release(tx: Tx, l: DeliveryLease, code: string | null): Promise<void>;
  stop(tx: Tx, l: DeliveryLease, code: string): Promise<void>;
  recover(
    tx: Tx,
    l: DeliveryLease,
  ): Promise<Readonly<{ attemptId: Id<'send_attempt'>; revision: Revision }> | null>;
  invalidate(tx: Tx, id: Id<'send'>, includeOffers: boolean): Promise<void>;
  pending(tx: Tx): Promise<readonly Id<'send'>[]>;
}
export interface DeliveryFiles {
  put(id: Id<'asset'>, purpose: 'report_pdf' | 'email_payload', bytes: Uint8Array): Promise<void>;
  get(id: Id<'asset'>): Promise<Uint8Array>;
}
export interface ReportRenderer {
  readonly hash: string;
  readonly fixture: boolean;
  render(document: DeliveryDocument): Promise<FixedMail>;
}
export interface MailProvider {
  readonly fixture: boolean;
  readonly name: 'resend' | 'fixture';
  send(
    key: string,
    payload: FrozenDelivery,
  ): Promise<
    Readonly<{
      outcome: 'accepted' | 'definitive_rejection' | 'uncertain';
      messageId: string | null;
    }>
  >;
}
export interface DeliveryPolicy {
  readonly version: string;
  readonly sender: string;
  readonly templateId: Id<'template'>;
  readonly fixture: boolean;
}
