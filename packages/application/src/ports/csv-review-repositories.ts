import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type {
  CsvTemplate,
  CsvWorkflow,
  CsvReview,
} from '../../../domain/src/entities/csv-review.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Page, PageRequest } from './pagination.ts';
import type { AssetLocation } from './assets.ts';
export interface CsvReviewRepository {
  template(tx: Tx, actor: Id<'staff'>, id: Id<'csv_template'>): Promise<CsvTemplate | null>;
  createTemplate(tx: Tx, actor: Id<'staff'>, input: CsvTemplate): Promise<CsvTemplate>;
  retire(tx: Tx, actor: Id<'staff'>, id: Id<'csv_template'>): Promise<void>;
  intake(
    tx: Tx,
    actor: Id<'staff'>,
    input: Readonly<{
      id: Id<'csv_intake'>;
      templateId: Id<'csv_template'>;
      runId: Id<'import_run'>;
      jobId: Id<'job'>;
      providerId: Id<'provider'>;
      licenseId: Id<'license'>;
      market: string;
      assetId: Id<'asset'>;
      rawHash: string;
      packetHash: string;
      expiresAt: Instant;
    }>,
  ): Promise<void>;
  workflows(tx: Tx, actor: Id<'staff'>, page: PageRequest): Promise<Page<CsvWorkflow>>;
  review(tx: Tx, actor: Id<'staff'>, input: CsvReview): Promise<CsvReview>;
  approval(tx: Tx, actor: Id<'staff'>, intakeId: Id<'csv_intake'>): Promise<CsvReview | null>;
  evidence(
    tx: Tx,
    actor: Id<'staff'>,
    intakeId: Id<'csv_intake'>,
  ): Promise<
    readonly Readonly<{
      kind: 'diff' | 'validation';
      artifactId: Id<'import_artifact'>;
      asset: AssetLocation;
    }>[]
  >;
}
