import { randomBytes } from 'node:crypto';
import { httpAdmissionFixture } from './http-admission.ts';
import { composePartnerServices } from './compose-partner-services.ts';
import { composeInsights } from './compose-insights.ts';
import { composeStaffCsv } from './compose-staff-csv.ts';
import { createPartnerReviewRepository } from '../../../packages/db/src/repositories/partner-review.ts';
import { createPartnerReviewServices } from '../../../packages/application/src/partners/partner-review.ts';
import { partnerReviewRoutes } from '../../../packages/integrations/src/http/phase2-review.ts';
import { staffCsvRoutes } from '../../../packages/integrations/src/http/phase2-csv.ts';
import { createP2HttpAdmission } from '../../../packages/integrations/src/http/phase2-admission.ts';
import { partnerRoutes } from '../../../packages/integrations/src/http/phase2-partners.ts';
import { withPartnerSessions } from '../../../packages/integrations/src/http/partner-security.ts';
import { validateP2Routes } from '../../../packages/integrations/src/http/phase2-response-contracts.ts';
import { createHttpApi } from '../../../packages/integrations/src/http/core.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { ok, fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import { startWebPreview } from '../http/web-preview.ts';
export async function staffWebFixture(webOrigin = 'http://127.0.0.1:3000') {
  const f = await httpAdmissionFixture();
  let api: Awaited<ReturnType<typeof listenLocalApi>> | undefined,
    csv: Awaited<ReturnType<typeof composeStaffCsv>> | undefined,
    cleanup: Promise<void> | undefined;
  const resources = () =>
    (cleanup ??= (async () => {
      try {
        await csv?.cleanup();
      } finally {
        await f.cleanup();
      }
    })());
  try {
    const p = await composePartnerServices(f),
      insights = await composeInsights(f, p.sessions);
    csv = await composeStaffCsv(f);
    const uploader = p.session(csv.uploader, csv.uploader),
      reviewer = p.session(csv.reviewer, csv.reviewer),
      publisher = p.session(csv.publisher, csv.publisher),
      review = createPartnerReviewServices({
        ...p.d,
        review: createPartnerReviewRepository(p.service),
      }),
      secret = randomBytes(32),
      admission = createP2HttpAdmission(p.service);
    api = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        routes: validateP2Routes([
          ...partnerRoutes({
            onboarding: p.onboarding,
            offers: p.offers,
            coupons: p.coupons,
            insights: insights.service,
            admission,
            secret,
          }),
          ...staffCsvRoutes({ service: csv!.service, admission, secret }),
          ...partnerReviewRoutes(review),
        ]),
        security: withPartnerSessions(
          { authenticate: async () => null, quota: async () => ({ allowed: true }) },
          {
            verify: async (h) => {
              const v = p.sessions.get(h);
              return v ? ok(v) : fail(failure('forbidden'));
            },
          },
          secret,
        ),
      }),
    );
    const company = await p.company(),
      pending = await p.company(false),
      example = await csv.example();
    const web = await startWebPreview(webOrigin, 'dev', 'unsupported', {
      fixture: { cleanup: resources },
      api: { origin: api.origin, shutdown: () => api!.close() },
      env: { LOCAL_P2_STAFF_UI: 'enabled', LOCAL_P2_API_ORIGIN: api.origin },
    });
    return {
      f,
      p,
      insights,
      csv,
      review,
      company,
      pending,
      example,
      uploader,
      reviewer,
      publisher,
      web,
      cleanup: () => web.cleanup(),
    };
  } catch (e) {
    try {
      await api?.close();
    } finally {
      await resources();
    }
    throw e;
  }
}
