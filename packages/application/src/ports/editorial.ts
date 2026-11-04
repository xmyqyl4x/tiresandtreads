import type {
  EditorialActor,
  EditorialDocument,
  EditorialRole,
} from '../../../domain/src/editorial.ts';
export interface EditorialVersion {
  readonly id: string;
  readonly document: EditorialDocument;
}
export interface EditorialTransaction {
  read(): Promise<EditorialDocument | null>;
  save(document: EditorialDocument): Promise<void>;
  versions(): Promise<readonly EditorialVersion[]>;
}
export interface EditorialStore {
  list(): Promise<readonly EditorialDocument[]>;
  atomic<T>(id: string, work: (tx: EditorialTransaction) => Promise<T>): Promise<T>;
}
export interface EditorialAuthorization {
  require(credential: string, role: EditorialRole | 'read'): Promise<EditorialActor>;
}
