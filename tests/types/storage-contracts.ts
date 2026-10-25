import type {
  AppReportsRow,
  AnalyticsEventsInsert,
  PrivacyContactsRow,
} from '../../packages/db/src/models/application.generated.ts';
import type { Id } from '../../packages/domain/src/values/index.ts';
import type { PublicFact } from '../../packages/application/src/ports/catalog.ts';
declare const report: AppReportsRow;
const revision: bigint = report.revision;
const expiry: Date = report.expires_at;
const version: number | null = report.current_version;
// @ts-expect-error PostgreSQL bigint cannot silently become a lossy number
const lossy: number = report.revision;
// @ts-expect-error unvalidated storage UUID strings cannot become branded domain identities
const reportId: Id<'report'> = report.id;
// @ts-expect-error generated UTC receipt day is not an insertable event field
const generatedDay: keyof AnalyticsEventsInsert = 'event_day';
declare const contact: PrivacyContactsRow;
const ciphertext: Buffer = contact.encrypted_email;
declare const fact: PublicFact<'adviceFacts'>;
// @ts-expect-error the public catalog contract omits the private reviewer identity
const reviewer = fact.reviewedBy;
void [revision, expiry, version, lossy, reportId, generatedDay, ciphertext, reviewer];
