import { randomBytes } from 'node:crypto';
import { httpAdmissionFixture } from './http-admission.ts';
import { composePartnerServices } from './compose-partner-services.ts';
import { composeInsights } from './compose-insights.ts';
import { createP2HttpAdmission } from '../../../packages/integrations/src/http/phase2-admission.ts';
import { partnerRoutes } from '../../../packages/integrations/src/http/phase2-partners.ts';
import { withPartnerSessions } from '../../../packages/integrations/src/http/partner-security.ts';
import { validateP2Routes } from '../../../packages/integrations/src/http/phase2-response-contracts.ts';
import { createHttpApi } from '../../../packages/integrations/src/http/core.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { ok, fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import { startWebPreview } from '../http/web-preview.ts';
export async function partnerWebFixture(webOrigin = 'http://127.0.0.1:3000') {
  const f = await httpAdmissionFixture();
  let api: Awaited<ReturnType<typeof listenLocalApi>> | undefined;
  try {
    const p = await composePartnerServices(f),
      insights = await composeInsights(f, p.sessions),
      secret = randomBytes(32),
      admission = createP2HttpAdmission(p.service);
    api = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        routes: validateP2Routes(
          partnerRoutes({
            onboarding: p.onboarding,
            offers: p.offers,
            coupons: p.coupons,
            insights: insights.service,
            admission,
            secret,
          }),
        ),
        security: withPartnerSessions(
          { authenticate: async () => null, quota: async () => ({ allowed: true }) },
          {
            verify: async (h) => {
              const a = p.sessions.get(h);
              return a ? ok(a) : fail(failure('forbidden'));
            },
          },
          secret,
        ),
      }),
    );
    const company = await p.company(),
      stranger = p.session(),
      newPartner = p.session();
    const web = await startWebPreview(webOrigin, 'dev', 'unsupported', {
      fixture: { cleanup: () => f.cleanup() },
      api: { origin: api.origin, shutdown: () => api!.close() },
      env: { LOCAL_P2_UI: 'enabled', LOCAL_P2_API_ORIGIN: api.origin },
    });
    return { f, p, insights, company, stranger, newPartner, web, cleanup: () => web.cleanup() };
  } catch (e) {
    await api?.close();
    await f.cleanup();
    throw e;
  }
}
