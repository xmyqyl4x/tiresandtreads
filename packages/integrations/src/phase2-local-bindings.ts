import type { createAnalysisErasureServices } from '../../application/src/analysis/analysis-lifecycle.ts';
import { createPilotRepository } from '../../db/src/repositories/pilot-delivery.ts';
import { createPartnerOnboardingRepository } from '../../db/src/repositories/partner-onboarding.ts';
import { createPartnerModerationRepository } from '../../db/src/repositories/partner-moderation.ts';
import { createPartnerServiceAssets } from '../../db/src/repositories/partner-service-assets.ts';
import { createPartnerCouponRepository } from '../../db/src/repositories/partner-coupons.ts';
import { createPartnerReviewRepository } from '../../db/src/repositories/partner-review.ts';
import { createPartnerInsightsRepository } from '../../db/src/repositories/partner-insights.ts';
import { createJobRepository } from '../../db/src/repositories/jobs.ts';
import { createReportAnalysisRepository } from '../../db/src/repositories/report-analysis.ts';
import { createAIScopeRepository } from '../../db/src/repositories/analysis-scope.ts';
import { createAIRequestRepository } from '../../db/src/repositories/analysis-requests.ts';
import { createAIArtifactRepository } from '../../db/src/repositories/analysis-artifacts.ts';
import { createAIReuseRepository } from '../../db/src/repositories/analysis-reuse.ts';
import { createAIBudgetRepository } from '../../db/src/repositories/analysis-budgets.ts';
import { createAIAttachmentRepository } from '../../db/src/repositories/analysis-attachments.ts';
import { createAnalysisExecutionSupport } from '../../db/src/repositories/analysis-execution.ts';
import {
  createAnalysisErasureRepository,
  createAnalysisDeliveryRepository,
} from '../../db/src/repositories/analysis-lifecycle.ts';
import { createGenericAnalysisRepository } from '../../db/src/repositories/generic-analysis.ts';
import { createPhotoServiceRepository } from '../../db/src/repositories/photo-services.ts';
import { createPhotoAssetRepository } from '../../db/src/repositories/photo-assets.ts';
import { createPhotoWorkerRepository } from '../../db/src/repositories/photo-worker.ts';
import { createPhotoOwnerRepository } from '../../db/src/repositories/photo-owners.ts';
import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReportRepository } from '../../db/src/repositories/reports.ts';
import { createDeliveryRepository } from '../../db/src/repositories/delivery.ts';
import { createDeliveryWorkRepository } from '../../db/src/repositories/delivery-work.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
import { createAnalysisOperationsRepository } from '../../db/src/repositories/analysis-operations.ts';
import { deriveLocalPhase2Keys } from './local-encrypted-objects.ts';
import { createPartnerCrypto } from './partner-crypto.ts';
import { createReportCrypto } from './report-crypto.ts';
import { createContactCrypto } from './contact-crypto.ts';
import { createPrivacyCrypto } from './privacy-crypto.ts';
import { createInsightsTokens } from './insights-tokens.ts';
import { createPartnerFiles } from './partner-files.ts';
import { couponCsv } from './partner-csv.ts';
import { partnerPreview } from './partner-preview.ts';
import { createStaffCsvFiles } from './staff-csv-files.ts';
import { staffCsvMappings } from './staff-csv-mappings.ts';
import { createContactRuntime } from './contact-runtime.ts';
import { createDeliveryFiles, deliveryChecksum } from './delivery-files.ts';
import { withFreshAnalysisScopes } from '../../application/src/analysis/analysis-lifecycle.ts';
import { createLocalEnvelopeEncryption } from './local-envelope-encryption.ts';
import type { Phase2LocalBindings } from './phase2-local-services.ts';
import type { Phase2LocalHostOptions } from './phase2-local-host.ts';
type Context = Parameters<Phase2LocalHostOptions['bind']>[0];
export interface Phase2LocalPorts {
  readonly pilot: Pick<Phase2LocalBindings['pilot'], 'policy' | 'renderer' | 'provider'>;
  readonly bucket: string;
  readonly authority: Phase2LocalBindings['partner']['authority'];
  readonly partnerPolicy: Phase2LocalBindings['partner']['policy'];
  readonly contactPolicy: Parameters<typeof createContactRuntime>[0]['policy'];
  readonly delivery: Pick<Phase2LocalBindings['delivery'], 'policy' | 'renderer' | 'provider'>;
  readonly report: Pick<Phase2LocalBindings['report'], 'provider' | 'noticeVersion'>;
  readonly photo: Pick<
    Phase2LocalBindings['photo'],
    'provider' | 'scanner' | 'codec' | 'noticeVersion'
  >;
  readonly generic: Pick<Phase2LocalBindings['generic'], 'provider'>;
  readonly erasure: Pick<
    Parameters<typeof createAnalysisErasureServices>[0],
    'journal' | 'mail' | 'provider'
  >;
  readonly privacy: Pick<Phase2LocalBindings['privacy'], 'journal' | 'policyVersion'>;
  readonly csvParserRevision: string;
}
// No source/identity/model/scanner acceptance is inferred from caller-supplied local ports.
export async function bindPhase2LocalServices(
  c: Context,
  ports: Phase2LocalPorts,
): Promise<Phase2LocalBindings> {
  const { scopes: s, material: m, objects } = c,
    now = () => new Date().toISOString(),
    clock = { now: () => Date.now() },
    crypto = createPartnerCrypto(m.current, deriveLocalPhase2Keys(m, 'partner'), m.lookup),
    reportCrypto = createReportCrypto(m.current, deriveLocalPhase2Keys(m, 'report'), m.lookup),
    contactCrypto = createContactCrypto(
      m.current,
      deriveLocalPhase2Keys(m, 'contact'),
      { local_lookup: m.lookup },
      m.lookup,
    ),
    encryption = createLocalEnvelopeEncryption(m),
    bucket = ports.bucket,
    key = m.current,
    support = createAnalysisExecutionSupport(s.analysis),
    rights = createAnalysisErasureRepository(s.analysis, bucket, Object.keys(m.keys));
  if (ports.partnerPolicy.assetBucket !== bucket || ports.partnerPolicy.assetKeyVersion !== key)
    throw Error('Local asset policy mismatch');
  const common = {
    uow: s.analysis.unitOfWork,
    scopes: withFreshAnalysisScopes(createAIScopeRepository(s.analysis), rights, () =>
      reportCrypto.id('ai_scope'),
    ),
    requests: createAIRequestRepository(s.analysis),
    artifacts: createAIArtifactRepository(s.analysis),
    reuse: createAIReuseRepository(s.analysis),
    budgets: createAIBudgetRepository(s.analysis),
    jobs: createJobRepository(s.analysis),
    crypto: reportCrypto,
    now,
    ...support,
  };
  const partner = (scope: typeof s.partner, worker = false) => ({
    uow: scope.unitOfWork,
    onboarding: createPartnerOnboardingRepository(scope),
    authority: ports.authority,
    clock,
    crypto,
    policy: ports.partnerPolicy,
    assets: createPartnerServiceAssets(scope, bucket, key, !worker),
    objects,
    files: createPartnerFiles(),
    offers: createPartnerModerationRepository(scope),
    preview: partnerPreview,
    coupons: createPartnerCouponRepository(scope),
    jobs: createJobRepository(scope),
    csv: { rows: couponCsv },
    review: createPartnerReviewRepository(scope),
  });
  const contacts = await createContactRuntime({
    scope: s.private,
    crypto: contactCrypto,
    encryption,
    policy: ports.contactPolicy,
    now,
  });
  return {
    pilot: {
      uow: s.pilot.unitOfWork,
      repository: createPilotRepository(s.pilot),
      crypto,
      encryption,
      files: createDeliveryFiles({ scope: s.asset, objects, bucket, keyVersion: key }),
      ...ports.pilot,
    },
    partner: partner(s.partner),
    couponWorker: partner(s.coupon, true),
    insights: {
      uow: s.insights.unitOfWork,
      repository: createPartnerInsightsRepository(s.insights, crypto.digest),
      authority: ports.authority,
      clock,
      crypto,
      encryption,
      tokens: createInsightsTokens(m.lookup),
    },
    report: {
      ...common,
      ...ports.report,
      repository: createReportAnalysisRepository(s.analysis),
      attachments: createAIAttachmentRepository(s.analysis),
    },
    generic: {
      ...common,
      ...ports.generic,
      repository: createGenericAnalysisRepository(s.analysis),
    },
    photo: {
      ...common,
      ...createAnalysisExecutionSupport(s.analysis, { photoJobs: true }),
      ...ports.photo,
      repository: createPhotoServiceRepository(s.analysis, bucket, key),
      assets: createPhotoAssetRepository(s.analysis, bucket, key),
      worker: createPhotoWorkerRepository(s.analysis),
      owners: createPhotoOwnerRepository(s.analysis),
      objects,
      hashBytes: deliveryChecksum,
    },
    delivery: {
      uow: s.private.unitOfWork,
      owners: createOwnerRepository(s.private),
      reports: createReportRepository(s.private),
      contacts,
      delivery: createDeliveryRepository(s.private),
      work: createDeliveryWorkRepository(
        s.private,
        ports.contactPolicy,
        contactCrypto.lookupVersions,
      ),
      reliability: createReliabilityRepository(s.private),
      crypto: contactCrypto,
      encryption,
      files: createDeliveryFiles({ scope: s.asset, objects, bucket, keyVersion: key }),
      analysis: createAnalysisDeliveryRepository(s.private),
      checksum: deliveryChecksum,
      now,
      ...ports.delivery,
    },
    privacy: {
      scope: s.privacy,
      ownerScope: s.analysis,
      contacts: contactCrypto,
      crypto: createPrivacyCrypto(m.current, deriveLocalPhase2Keys(m, 'privacy-journal')),
      encryption,
      referenceEncryption: encryption,
      objects,
      now,
      assetBucket: bucket,
      assetKeyVersions: Object.keys(m.keys),
      analysisJournal: ports.erasure.journal,
      mail: ports.erasure.mail,
      provider: ports.erasure.provider,
      ...ports.privacy,
    },
    operations: {
      uow: s.analysis.unitOfWork,
      authority: ports.authority,
      clock,
      repository: createAnalysisOperationsRepository(s.analysis),
      digest: crypto.digest,
    },
    csv: {
      staff: s.staff,
      ingest: s.ingest,
      publish: s.publish,
      files: createStaffCsvFiles({ scope: s.asset, objects, bucket, keyVersion: key }),
      crypto: { id: contactCrypto.id, hash: contactCrypto.hash, sha256: deliveryChecksum },
      mappings: staffCsvMappings,
      parserRevision: ports.csvParserRevision,
      now,
    },
  };
}
