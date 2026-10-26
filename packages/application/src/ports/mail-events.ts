import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type { KeyDigest } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export interface MailObservation {
  readonly eventId: string;
  readonly digest: string;
  readonly messageId: string | null;
  readonly deliveryKey: string | null;
  readonly type:
    | 'sent'
    | 'delivered'
    | 'delayed'
    | 'bounced'
    | 'complained'
    | 'opened'
    | 'clicked'
    | 'unsupported';
  readonly classification: 'unknown' | 'machine' | 'suspected_human' | 'hard' | 'soft';
  readonly occurredAt: Instant;
  readonly receivedAt: Instant;
}
export interface MailEventsRepository {
  receive(tx: Tx, event: MailObservation): Promise<Id<'inbox'>>;
  apply(tx: Tx, id: Id<'inbox'>): Promise<'processed' | 'pending' | 'quarantined'>;
  pending(tx: Tx): Promise<readonly Id<'inbox'>[]>;
  status(
    tx: Tx,
    id: Id<'send'>,
  ): Promise<
    Readonly<{
      state: string;
      messageId: string | null;
      delivered: boolean;
      bounced: boolean;
      complained: boolean;
    }>
  >;
  reconciled(tx: Tx, id: Id<'send'>, messageId: string, event: string): Promise<void>;
}
export interface EmailLink {
  readonly id: Id<'email_link'>;
  readonly sendId: Id<'send'>;
  readonly slot: string;
  readonly purpose: 'education' | 'feedback';
  readonly destination: string;
  readonly key: KeyDigest;
  readonly expiresAt: Instant;
}
export interface EmailLinkRepository {
  issue(tx: Tx, input: EmailLink): Promise<void>;
  resolve(tx: Tx, id: Id<'email_link'>, key: KeyDigest): Promise<EmailLink | null>;
  feedback(tx: Tx, link: EmailLink, value: 'yes' | 'no'): Promise<void>;
  revoke(tx: Tx, id: Id<'email_link'>): Promise<void>;
}
export interface EmailLinkCrypto {
  issue(
    sendId: Id<'send'>,
    slot: string,
  ): Readonly<{ id: Id<'email_link'>; raw: string; key: KeyDigest }>;
  parse(raw: string): Readonly<{ id: Id<'email_link'>; key: KeyDigest }> | null;
}
