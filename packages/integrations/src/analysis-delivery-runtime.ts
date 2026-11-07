import { createContactRuntime } from './contact-runtime.ts';
import { createDeliveryFiles, deliveryChecksum } from './delivery-files.ts';
import { createAnalysisDeliveryServices } from '../../application/src/analysis/analysis-delivery.ts';
import { createAnalysisDeliveryRepository } from '../../db/src/repositories/analysis-lifecycle.ts';
import { createDeliveryRuntime } from './delivery-runtime.ts';
import { createDeliveryWorkRepository } from '../../db/src/repositories/delivery-work.ts';
import { createDeliveryRepository } from '../../db/src/repositories/delivery.ts';
import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReportRepository } from '../../db/src/repositories/reports.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
// Explicit opt-in: reuse P1 role/key/reservation admission, then replace only presentation composition.
export async function createAnalysisDeliveryRuntime(
  o: Parameters<typeof createDeliveryRuntime>[0],
) {
  await createDeliveryRuntime(o);
  const s = o.privateScope,
    contacts = await createContactRuntime({
      scope: s,
      crypto: o.crypto,
      encryption: o.encryption,
      policy: o.contactPolicy,
      now: o.now,
    });
  return createAnalysisDeliveryServices({
    analysis: createAnalysisDeliveryRepository(s),
    uow: s.unitOfWork,
    owners: createOwnerRepository(s),
    reports: createReportRepository(s),
    contacts,
    delivery: createDeliveryRepository(s),
    work: createDeliveryWorkRepository(s, o.contactPolicy, o.crypto.lookupVersions),
    reliability: createReliabilityRepository(s),
    crypto: o.crypto,
    encryption: o.encryption,
    files: createDeliveryFiles({
      scope: o.assetScope,
      objects: o.objects,
      bucket: o.bucket,
      keyVersion: o.keyVersion,
    }),
    renderer: o.renderer,
    provider: o.provider,
    policy: o.policy,
    checksum: deliveryChecksum,
    now: o.now,
  });
}
