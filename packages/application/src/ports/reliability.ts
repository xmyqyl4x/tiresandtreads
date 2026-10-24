import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export interface OutboxEvent {
  readonly eventId: Id<'event'>;
  readonly aggregateId: Id<'aggregate'>;
  readonly aggregateKind: string;
  readonly type: string;
  readonly version: number;
  readonly payload: Readonly<{
    resource_id: string;
    resource_kind: string;
    version?: number;
    revision?: string;
  }>;
}
export interface OutboxLease {
  readonly id: Id<'outbox'>;
  readonly token: Id<'lease'>;
  readonly generation: bigint;
  readonly eventId: Id<'event'>;
}
export interface Inbox {
  readonly id: Id<'inbox'>;
  readonly revision: Revision;
  readonly state: 'pending' | 'processing' | 'processed' | 'quarantined' | 'failed';
}
export interface ReliabilityRepository {
  append(tx: Tx, event: OutboxEvent): Promise<Id<'outbox'>>;
  lease(tx: Tx, worker: string, seconds: number): Promise<OutboxLease | null>;
  acknowledge(tx: Tx, lease: OutboxLease): Promise<void>;
  receive(
    tx: Tx,
    input: Readonly<{
      provider: string;
      eventId: string;
      digest: string;
      assetId: Id<'asset'> | null;
      receivedAt: Instant;
      verifiedAt: Instant;
    }>,
  ): Promise<Inbox>;
  process(
    tx: Tx,
    id: Id<'inbox'>,
    expected: Revision,
    state: 'processing' | 'processed' | 'quarantined' | 'failed',
  ): Promise<Inbox>;
}
