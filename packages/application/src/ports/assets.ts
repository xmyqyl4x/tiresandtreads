import type { Id, Revision } from '../../../domain/src/values/index.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export interface AssetLocation {
  readonly id: Id<'asset'>;
  readonly revision: Revision;
  readonly key: string;
  readonly mime: string;
  readonly sha256: string;
  readonly size: number;
  readonly version: string | null;
  readonly state: 'pending' | 'ready' | 'quarantined' | 'deleting' | 'deleted';
}
export interface AssetInput {
  readonly id: Id<'asset'>;
  readonly purpose: 'report_pdf' | 'import_source' | 'email_payload';
  readonly mime: 'application/pdf' | 'application/json' | 'text/csv';
  readonly sha256: string;
  readonly size: number;
}
export interface AssetRepository {
  register(tx: Tx, input: AssetInput): Promise<AssetLocation>;
  get(tx: Tx, id: Id<'asset'>): Promise<AssetLocation | null>;
  ready(tx: Tx, asset: AssetLocation, version: string): Promise<void>;
  deleting(tx: Tx, id: Id<'asset'>): Promise<AssetLocation>;
  deleted(tx: Tx, asset: AssetLocation): Promise<void>;
  cleanup(tx: Tx): Promise<readonly Id<'asset'>[]>;
}
export interface PrivateObjects {
  put(asset: AssetLocation, bytes: Uint8Array): Promise<string>;
  get(asset: AssetLocation): Promise<Uint8Array>;
  erase(asset: AssetLocation): Promise<void>;
}
