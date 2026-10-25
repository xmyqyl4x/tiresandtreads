import type { Id, Revision } from '../../../domain/src/values/index.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Owner, Send } from './private-records.ts';
import type { ConsentPurpose } from '../../../domain/src/entities/consent.ts';
export interface ScheduleSend {
  readonly id: Id<'send'>;
  readonly owner: Owner;
  readonly contactId: Id<'contact'>;
  readonly kind: 'report' | 'confirmation' | 'offers' | 'lifecycle';
  readonly reportId: Id<'report'> | null;
  readonly reportVersion: number | null;
  readonly comparisonRevision: Revision | null;
  readonly templateId: Id<'template'>;
  readonly provider: string;
  readonly providerKey: string;
  readonly delaySeconds: number;
  readonly policyVersion: string;
  readonly noticeId: Id<'notice'> | null;
  readonly purposes: readonly ConsentPurpose[];
}
export interface DeliveryRepository {
  schedule(tx: Tx, input: ScheduleSend): Promise<Send>;
  owned(tx: Tx, owner: Owner, id: Id<'send'>): Promise<Send | null>;
  cancel(tx: Tx, owner: Owner, id: Id<'send'>, expected: Revision): Promise<Send>;
  claim(
    tx: Tx,
    input: Readonly<{
      id: Id<'send'>;
      expected: Revision;
      recipientSubjectId: Id<'subject'>;
      permissionRevision: Revision;
      purpose: ConsentPurpose;
      scope: string;
      payloadAssetId: Id<'asset'>;
      payloadHash: string;
    }>,
  ): Promise<Readonly<{ send: Send; attemptId: Id<'send_attempt'> }>>;
  finish(
    tx: Tx,
    input: Readonly<{
      id: Id<'send'>;
      attemptId: Id<'send_attempt'>;
      expected: Revision;
      outcome: 'accepted' | 'definitive_rejection' | 'uncertain';
      providerMessageId: string | null;
      errorCode: string | null;
    }>,
  ): Promise<Send>;
  receipt(
    tx: Tx,
    id: Id<'send'>,
  ): Promise<Readonly<{
    outcome: string;
    provider: string;
    providerKeyDigest: string;
    payloadDigest: string | null;
  }> | null>;
}
