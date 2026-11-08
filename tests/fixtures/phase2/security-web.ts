import { operationsWebFixture } from './operations-web.ts';
import { composeInsights } from './compose-insights.ts';
import { composeStaffCsv } from './compose-staff-csv.ts';
import { createPartnerReviewRepository } from '../../../packages/db/src/repositories/partner-review.ts';
import { createPartnerReviewServices } from '../../../packages/application/src/partners/partner-review.ts';
import { partnerReviewRoutes } from '../../../packages/integrations/src/http/phase2-review.ts';
import { staffCsvRoutes } from '../../../packages/integrations/src/http/phase2-csv.ts';
import { partnerRoutes } from '../../../packages/integrations/src/http/phase2-partners.ts';
// One disposable chain and existing identity/services. No production composition or real providers.
export async function securityWebFixture(origin = 'http://127.0.0.1:3000') {
  let context:
    | {
        csv: Awaited<ReturnType<typeof composeStaffCsv>>;
        company: Awaited<
          ReturnType<Awaited<ReturnType<typeof operationsWebFixture>>['p']['company']>
        >;
        otherCompany: Awaited<
          ReturnType<Awaited<ReturnType<typeof operationsWebFixture>>['p']['company']>
        >;
        pending: Awaited<
          ReturnType<Awaited<ReturnType<typeof operationsWebFixture>>['p']['company']>
        >;
        uploader: string;
        reviewer: string;
        publisher: string;
      }
    | undefined;
  const base = await operationsWebFixture(origin, async (c) => {
    const csv = await composeStaffCsv(c.f);
    c.onCleanup(csv.cleanup);
    const insights = await composeInsights(c.f, c.p.sessions),
      review = createPartnerReviewServices({
        ...c.p.d,
        review: createPartnerReviewRepository(c.p.service),
      }),
      company = await c.p.company(),
      otherCompany = await c.p.company(),
      pending = await c.p.company(false);
    context = {
      csv,
      company,
      otherCompany,
      pending,
      uploader: c.p.session(csv.uploader, csv.uploader),
      reviewer: c.p.session(csv.reviewer, csv.reviewer),
      publisher: c.p.session(csv.publisher, csv.publisher),
    };
    return {
      routes: [
        ...partnerRoutes({
          onboarding: c.p.onboarding,
          offers: c.p.offers,
          coupons: c.p.coupons,
          insights: insights.service,
          admission: c.admission,
          secret: c.secret,
        }),
        ...staffCsvRoutes({ service: csv.service, admission: c.admission, secret: c.secret }),
        ...partnerReviewRoutes(review),
      ],
      security: (security) => security,
      env: { LOCAL_P2_UI: 'enabled', LOCAL_P2_STAFF_UI: 'enabled' },
    };
  });
  if (!context) {
    await base.cleanup();
    throw Error('Combined fixture composition missing');
  }
  return { ...base, ...context };
}
