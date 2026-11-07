import { createPrivacyRuntime } from './privacy-runtime.ts';
import { boundedIO } from './bounded-io.ts';
import {
  createAnalysisErasureServices,
  withAnalysisPrivacy,
} from '../../application/src/analysis/analysis-lifecycle.ts';
import { createAnalysisErasureRepository } from '../../db/src/repositories/analysis-lifecycle.ts';
import { createPrivacyServiceRepository } from '../../db/src/repositories/privacy-services.ts';
import { serviceWork } from '../../application/src/services/service-work.ts';
import { ok } from '../../domain/src/values/core.ts';
// Explicit opt-in. Independent AI-scope journal custody is separate from P1 rights records.
export async function createAnalysisPrivacyRuntime(
  o: Parameters<typeof createPrivacyRuntime>[0] & {
    readonly ownerScope: Parameters<typeof createPrivacyRuntime>[0]['scope'];
    readonly analysisJournal: Parameters<typeof createAnalysisErasureServices>[0]['journal'];
    readonly referenceEncryption: Parameters<typeof createAnalysisErasureServices>[0]['encryption'];
    readonly provider: Parameters<typeof createAnalysisErasureServices>[0]['provider'];
  },
) {
  const base = await createPrivacyRuntime(o),
    role = await o.ownerScope.unitOfWork.run(async (tx) =>
      ok((await o.ownerScope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
    );
  if (!role.ok || role.value !== 'tt_p2_analysis_service')
    throw Error('Invalid AI rights composition role');
  const repository = createAnalysisErasureRepository(o.scope, o.assetBucket, o.assetKeyVersions),
    owners = createAnalysisErasureRepository(o.ownerScope, o.assetBucket, o.assetKeyVersions),
    p1 = createPrivacyServiceRepository(o.scope, o.assetBucket, o.assetKeyVersions);
  const analysis = createAnalysisErasureServices({
    uow: o.scope.unitOfWork,
    ownerUow: o.ownerScope.unitOfWork,
    repository,
    owners,
    crypto: o.crypto,
    now: o.now,
    encryption: {
      encrypt: (...a) => boundedIO(() => o.referenceEncryption.encrypt(...a), 5000),
      decrypt: (...a) => boundedIO(() => o.referenceEncryption.decrypt(...a), 5000),
    },
    journal: { append: (...a) => boundedIO(() => o.analysisJournal.append(...a), 10000) },
    objects: { ...o.objects, erase: (a) => boundedIO(() => o.objects.erase(a), 10000) },
    mail: {
      verify: (i) => boundedIO(() => o.mail.verify(i), 5000),
      erase: (i) => boundedIO(() => o.mail.erase(i), 10000),
    },
    provider: { erase: (i) => boundedIO(() => o.provider.erase(i), 10000) },
  });
  const retry: typeof base.retry = (actor, id, evidence) =>
    serviceWork(o.scope.unitOfWork, async (tx) => {
      await p1.retry(tx, actor, id, evidence);
      await repository.retryRequest(tx, id);
      return ok(undefined);
    });
  return Object.freeze({ ...withAnalysisPrivacy(base, analysis, retry), analysis });
}
