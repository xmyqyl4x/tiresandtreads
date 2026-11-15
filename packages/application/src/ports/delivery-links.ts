import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type { KeyDigest, Owner, Send } from './private-records.ts';
import type { TransactionContext } from './transactions.ts';

export interface CapturedDeliveryLinks {
  readonly schemaVersion: 1;
  readonly sendId: Id<'send'>;
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly comparisonRevision: string | null;
  readonly expiresAt: Instant;
  readonly share: Readonly<{ id: Id<'report_capability'>; key: KeyDigest }>;
  readonly reportPreferences: Readonly<{ id: Id<'verification'>; key: KeyDigest }>;
  readonly offersConfirmation: Readonly<{ id: Id<'verification'>; key: KeyDigest }> | null;
}
export interface DeliveryLinkCapture {
  capture(
    tx: TransactionContext,
    input: Readonly<{
      owner: Owner;
      send: Send;
      reportExpiresAt: Instant;
      verificationId: Id<'verification'>;
      offersVerificationId: Id<'verification'> | null;
    }>,
  ): Promise<CapturedDeliveryLinks>;
}
