import { createPilotDeliveryServices } from '../../application/src/partners/pilot-delivery.ts';
import { createPartnerOnboardingServices } from '../../application/src/partners/partner-onboarding.ts';
import { createPartnerOfferServices } from '../../application/src/partners/partner-offers.ts';
import { createPartnerCouponServices } from '../../application/src/partners/partner-coupons.ts';
import { createPartnerReviewServices } from '../../application/src/partners/partner-review.ts';
import { createPartnerInsightsServices } from '../../application/src/partners/partner-insights.ts';
import { createReportAnalysisServices } from '../../application/src/analysis/report-analysis.ts';
import { createGenericAnalysisServices } from '../../application/src/analysis/generic-analysis.ts';
import { createPhotoServices } from '../../application/src/analysis/photo-services.ts';
import { createAnalysisDeliveryServices } from '../../application/src/analysis/analysis-delivery.ts';
import { createAnalysisPrivacyRuntime } from './analysis-privacy-runtime.ts';
import { createAnalysisOperationsService } from '../../application/src/analysis/analysis-operations.ts';
import { createStaffCsvRuntime } from './staff-csv-runtime.ts';
type Input<F extends (...args: never[]) => unknown> = Parameters<F>[0];
export interface Phase2LocalBindings {
  readonly pilot: Input<typeof createPilotDeliveryServices>;
  readonly partner: Input<typeof createPartnerOnboardingServices> &
    Input<typeof createPartnerOfferServices> &
    Input<typeof createPartnerCouponServices> &
    Input<typeof createPartnerReviewServices>;
  readonly couponWorker: Input<typeof createPartnerCouponServices>;
  readonly insights: Input<typeof createPartnerInsightsServices>;
  readonly report: Input<typeof createReportAnalysisServices>;
  readonly generic: Input<typeof createGenericAnalysisServices>;
  readonly photo: Input<typeof createPhotoServices>;
  readonly delivery: Input<typeof createAnalysisDeliveryServices>;
  readonly privacy: Input<typeof createAnalysisPrivacyRuntime>;
  readonly operations: Omit<Input<typeof createAnalysisOperationsService>, 'execute'>;
  readonly csv: Input<typeof createStaffCsvRuntime>;
}
// All use cases remain in application services. The local host supplies checked scopes and retained ports.
export async function composePhase2LocalServices(b: Phase2LocalBindings) {
  const report = createReportAnalysisServices(b.report),
    generic = createGenericAnalysisServices(b.generic),
    photo = createPhotoServices(b.photo);
  const combined = await createAnalysisPrivacyRuntime(b.privacy),
    erasure = combined.analysis,
    privacy = Object.fromEntries(
      Object.entries(combined).filter(([key]) => !['analysis', 'retentionAssets'].includes(key)),
    ) as Omit<typeof combined, 'analysis' | 'retentionAssets'>;
  const execute: Input<typeof createAnalysisOperationsService>['execute'] = (task, request) =>
    task === 'report_analysis'
      ? report.execute(request as Parameters<typeof report.execute>[0])
      : task === 'photo_extraction'
        ? photo.execute(request as Parameters<typeof photo.execute>[0])
        : generic.execute(request as Parameters<typeof generic.execute>[0]);
  return {
    pilot: createPilotDeliveryServices(b.pilot),
    onboarding: createPartnerOnboardingServices(b.partner),
    offers: createPartnerOfferServices(b.partner),
    coupons: createPartnerCouponServices(b.partner),
    couponWorker: createPartnerCouponServices(b.couponWorker),
    review: createPartnerReviewServices(b.partner),
    insights: createPartnerInsightsServices(b.insights),
    report,
    generic,
    photo,
    delivery: createAnalysisDeliveryServices(b.delivery),
    erasure,
    privacy,
    operations: createAnalysisOperationsService({ ...b.operations, execute }),
    csv: await createStaffCsvRuntime(b.csv),
  };
}
