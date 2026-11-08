import { randomBytes } from 'node:crypto';
import { httpAdmissionFixture } from './http-admission.ts';
import { composePhotoServices } from './compose-photo-services.ts';
import { composeReportAnalysis } from './compose-report-analysis.ts';
import { composeAnalysisDelivery } from './compose-analysis-delivery.ts';
import { composeHttpPrivacy } from './compose-http-privacy.ts';
import { uuid, value } from './compose-partner-services.ts';
import { createLocalReportAnalysisRuntime } from '../../../packages/integrations/src/analysis-http-runtime.ts';
import { createAnalysisErasureRepository } from '../../../packages/db/src/repositories/analysis-lifecycle.ts';
import { createAnalysisPresentationRepository } from '../../../packages/db/src/repositories/analysis-presentation.ts';
import { createAnalysisPresentationService } from '../../../packages/application/src/analysis/analysis-presentation.ts';
import { createPhotoPresentationService } from '../../../packages/application/src/analysis/photo-presentation.ts';
import { createPhotoPresentationRepository } from '../../../packages/db/src/repositories/photo-presentation.ts';
import { photoPresentationRoutes } from '../../../packages/integrations/src/http/phase2-photo-presentation.ts';
import { fixtureReportServices } from '../http/report-services.ts';
import { analysisPhotoRoutes } from '../../../packages/integrations/src/http/phase2-analysis.ts';
import { analysisDeliveryRoutes } from '../../../packages/integrations/src/http/phase2-analysis-delivery.ts';
import { analysisPresentationRoutes } from '../../../packages/integrations/src/http/phase2-presentation.ts';
import { ownerReportWebRoutes } from '../../../packages/integrations/src/http/phase2-owner-web.ts';
import { publicOwnerRoutes } from '../../../packages/integrations/src/http/public-owner.ts';
import { validateP2Routes } from '../../../packages/integrations/src/http/phase2-response-contracts.ts';
import { createP2HttpAdmission } from '../../../packages/integrations/src/http/phase2-admission.ts';
import { createHttpApi, type HttpActor } from '../../../packages/integrations/src/http/core.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { ok, fail, id } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import { startWebPreview } from '../http/web-preview.ts';
// Fixed source identities and synthetic provider/identity/scanner ports. No network feed/model/mail.
export async function ownerWebFixture(webOrigin = 'http://127.0.0.1:3000') {
  let f = await httpAdmissionFixture();
  const previousBundle = f.bundleId;
  let api: Awaited<ReturnType<typeof listenLocalApi>> | undefined,
    delivery: Awaited<ReturnType<typeof composeAnalysisDelivery>> | undefined,
    photo: Awaited<ReturnType<typeof composePhotoServices>> | undefined,
    privacy: ReturnType<typeof composeHttpPrivacy> | undefined,
    cleanup: Promise<void> | undefined;
  const resources = () =>
    (cleanup ??= (async () => {
      try {
        privacy?.cleanup();
        await photo?.cleanup();
        await delivery?.cleanup();
      } finally {
        await f.cleanup();
      }
    })());
  try {
    delivery = await composeAnalysisDelivery(f);
    const engineBundle = uuid('bundle'),
      sourceIds: string[] = [];
    await f.admin.query(
      "INSERT INTO app.dataset_bundles(id,market,manifest_hash,status) VALUES($1,'US',$2,'staging')",
      [engineBundle, 'a'.repeat(64)],
    );
    for (const kind of ['fitment', 'catalog', 'recall', 'climate', 'market_rules']) {
      const source = uuid('dataset');
      sourceIds.push(source);
      await f.admin.query(
        "INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) SELECT $1,provider_id,license_id,$2,$1::uuid::text,$3,'staging',statement_timestamp()-interval '1 day',statement_timestamp(),0 FROM app.dataset_versions WHERE id=(SELECT dataset_version_id FROM app.bundle_members WHERE bundle_id=$4 LIMIT 1)",
        [source, kind, 'b'.repeat(64), f.bundleId],
      );
      await f.admin.query(
        "UPDATE app.dataset_versions SET status='published',published_at=clock_timestamp() WHERE id=$1",
        [source],
      );
      await f.admin.query(
        'INSERT INTO app.bundle_members(bundle_id,component_key,dataset_version_id) VALUES($1,$2,$3)',
        [engineBundle, kind, source],
      );
    }
    await f.admin.query(
      "UPDATE app.dataset_bundles SET status='published',published_at=clock_timestamp() WHERE id=$1",
      [engineBundle],
    );
    f = { ...f, bundleId: engineBundle };
    photo = await composePhotoServices(f);
    const analysis = await composeReportAnalysis(f),
      example = await analysis.example();
    const photoExample = await photo.example();
    // Fixed synthetic policy; each owner retains independent capture/history authorization.
    const photoPresentation = createPhotoPresentationService({
      ...photo.d,
      presentation: createPhotoPresentationRepository(photo.adapter),
      policyId: photoExample.policy,
    });
    privacy = composeHttpPrivacy(f, photo);
    const runtime = await createLocalReportAnalysisRuntime({
      mode: 'local-opt-in',
      scope: analysis.adapter,
      dependencies: analysis.d,
      rights: createAnalysisErasureRepository(analysis.adapter, photo.bucket, [photo.key]),
    });
    const reports = fixtureReportServices(f, { current: true, localSourceIds: sourceIds }),
      presentation = createAnalysisPresentationService({
        ...analysis.d,
        access: (keys, report, version) => reports.reports.readOwner(keys, report, version),
        presentation: createAnalysisPresentationRepository(analysis.adapter),
        policyId: example.policy,
      });
    await f.admin.query(
      "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,100000,100000,100000,2,'active',$2 FROM app.ai_policy_versions WHERE id=$1",
      [example.policy, f.staff],
    );
    const created = value(
      await reports.reports.create(example.keys, 'owner-web-' + uuid('command'), {
        market: 'US',
        regionKey: 'SYNTHETIC_US',
        configurationId: null,
        wheelPackage: null,
        sizes: { front: '225/45R18', rear: '255/40R18' },
        strategy: 'year_round',
        winterUse: 'none',
        replace: ['front_left', 'front_right', 'rear_left', 'rear_right'],
        priorities: ['wet'],
        budget: null,
      }),
    );
    const token = randomBytes(32).toString('base64url'),
      csrf = randomBytes(32).toString('hex'),
      actors = new Map<string, HttpActor>([[token, { keys: example.keys, csrf }]]);
    const photoToken = randomBytes(32).toString('base64url');
    actors.set(photoToken, { keys: photoExample.keys, csrf });
    const stranger = await f.owner(),
      strangerToken = randomBytes(32).toString('base64url');
    actors.set(strangerToken, { keys: [stranger.token], csrf });
    const secret = randomBytes(32),
      admission = createP2HttpAdmission(f.serviceAdapter('tt_p2_partner_service'));
    api = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        routes: validateP2Routes([
          ...analysisPhotoRoutes({
            analysis: runtime,
            photos: photo!.service,
            privacy: privacy!.service,
            admission,
            secret,
          }),
          ...analysisDeliveryRoutes({ delivery: delivery!.service, admission, secret }),
          ...analysisPresentationRoutes(presentation),
          ...photoPresentationRoutes(photoPresentation),
          ...ownerReportWebRoutes({ delivery: delivery!.service, policy: delivery!.contactPolicy }),
          ...publicOwnerRoutes({
            reports: reports.reports,
            shareKeys: () => [],
            lookup: async () =>
              ok({ coverage: 'unavailable', source: null, items: [], next: null }),
            content: async () => ok({}),
            download: async () => fail(failure('not_found')),
          }).filter((r) =>
            ['readReport', 'createReport', 'lookupReference'].includes(r.operationId),
          ),
        ]),
        security: {
          authenticate: async (r) =>
            actors.get(r.headers.get('authorization')?.slice(7) ?? '') ?? null,
          quota: async () => ({ allowed: true }),
        },
      }),
    );
    const web = await startWebPreview(webOrigin, 'dev', 'unsupported', {
      fixture: { cleanup: resources },
      api: { origin: api.origin, shutdown: () => api!.close() },
      env: { LOCAL_P2_OWNER_UI: 'enabled', LOCAL_P2_API_ORIGIN: api.origin },
    });
    return {
      f,
      photo,
      privacy,
      analysis,
      runtime,
      presentation,
      delivery,
      reports,
      example,
      photoExample,
      photoPresentation,
      photoToken,
      report: value(id('report', created.report_id)),
      previousBundle,
      token,
      csrf,
      strangerToken,
      actors,
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
