import type { Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure, TransactionContext as Tx } from './transactions.ts';
export const maintenanceActions = [
  'callbacks',
  'publication',
  'privacy',
  'analytics',
  'quotas',
  'retention',
  'assets',
  'sources',
  'delivery',
  'privacy_verification',
] as const;
export type MaintenanceAction = (typeof maintenanceActions)[number];
export type MaintenanceBindings = Readonly<
  Record<
    MaintenanceAction,
    () => Promise<Result<{ readonly processed: number }, ApplicationFailure>>
  >
>;
export interface ServiceHealthRow {
  readonly code: string;
  readonly queued: number;
  readonly oldestAt: string | null;
  readonly sampledAt: string;
  readonly capacity: number | null;
}
export interface ServiceHealthRepository {
  snapshot(tx: Tx): Promise<readonly ServiceHealthRow[]>;
}
