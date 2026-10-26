import type { Id, Revision } from '../../../domain/src/values/index.ts';
import type { OutboxEvent, OutboxLease } from './reliability.ts';
import type { TransactionContext as Tx } from './transactions.ts';

export interface JobInput {
  readonly type: string;
  readonly businessKey: string;
  readonly version: number;
  readonly resourceId: Id<'resource'>;
}
export interface JobLease {
  readonly id: Id<'job'>;
  readonly token: Id<'lease'>;
  readonly generation: Revision;
  readonly input: JobInput;
}
export interface JobRepository {
  register(tx: Tx, input: JobInput): Promise<Id<'job'>>;
  lease(tx: Tx, id: Id<'job'>): Promise<JobLease | null>;
  fence(tx: Tx, lease: JobLease): Promise<void>;
  complete(tx: Tx, lease: JobLease): Promise<void>;
  fail(tx: Tx, lease: JobLease): Promise<void>;
  reconcile(tx: Tx): Promise<readonly Id<'job'>[]>;
}
export interface RelayRepository {
  lease(tx: Tx): Promise<(OutboxLease & { readonly event: OutboxEvent }) | null>;
  acknowledge(tx: Tx, lease: OutboxLease): Promise<void>;
  fail(tx: Tx, lease: OutboxLease): Promise<void>;
  reconcile(tx: Tx): Promise<number>;
}
export interface EventPublisher {
  // Resolves only after provider receipt; stable eventId survives uncertain acknowledgements.
  publish(event: OutboxEvent): Promise<void>;
}
export interface CommandIdentity {
  readonly actorHash: string;
  readonly operation: string;
  readonly keyHash: string;
  readonly bodyHash: string;
  readonly canonicalVersion: number;
}
export interface CommandResponse {
  readonly schema_version: 1;
  readonly resource_id: Id<'resource'>;
  readonly status: 'created' | 'accepted';
  readonly report_id?: Id<'report'>;
  readonly report_version?: number;
  readonly result_revision?: string;
  readonly token_key_version?: string;
  readonly expires_at?: string;
}
export interface CommandRepository {
  lookup(tx: Tx, input: CommandIdentity): Promise<CommandResponse | null>;
  claim(tx: Tx, input: CommandIdentity): Promise<CommandResponse | null>;
  complete(tx: Tx, input: CommandIdentity, response: CommandResponse): Promise<void>;
}
export type TelemetryEvent =
  'relay_published' | 'relay_deferred' | 'job_completed' | 'job_deferred';
export interface Telemetry {
  // No exception, payload, ID, URL, key, connection string or arbitrary labels cross this port.
  record(event: TelemetryEvent): void;
}
