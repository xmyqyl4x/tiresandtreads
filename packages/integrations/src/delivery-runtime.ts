import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  ContactCrypto,
  ContactEncryption,
  ContactPolicy,
} from '../../application/src/ports/contact-services.ts';
import type {
  DeliveryPolicy,
  ReportRenderer,
  MailProvider,
} from '../../application/src/ports/delivery-services.ts';
import type { PrivateObjects } from '../../application/src/ports/assets.ts';
import { createContactRuntime } from './contact-runtime.ts';
import { createDeliveryFiles, deliveryChecksum } from './delivery-files.ts';
import { createDeliveryServices } from '../../application/src/services/delivery.ts';
import { createDeliveryWorkRepository } from '../../db/src/repositories/delivery-work.ts';
import { createDeliveryRepository } from '../../db/src/repositories/delivery.ts';
import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReportRepository } from '../../db/src/repositories/reports.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
import { ok } from '../../domain/src/values/core.ts';
type Scope = ReturnType<typeof createTransactions>;
export async function createDeliveryRuntime(o: {
  readonly privateScope: Scope;
  readonly assetScope: Scope;
  readonly crypto: ContactCrypto;
  readonly encryption: ContactEncryption;
  readonly contactPolicy: ContactPolicy;
  readonly policy: DeliveryPolicy;
  readonly renderer: ReportRenderer;
  readonly provider: MailProvider;
  readonly objects: PrivateObjects;
  readonly bucket: string;
  readonly keyVersion: string;
  readonly now: () => string;
}) {
  for (const [scope, role] of [
    [o.privateScope, 'tt_private_runtime'],
    [o.assetScope, 'tt_asset_runtime'],
  ] as const) {
    const r = await scope.unitOfWork.run(async (tx) =>
      ok((await scope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
    );
    if (!r.ok || r.value !== role) throw Error('Invalid delivery runtime role');
  }
  const s = o.privateScope,
    contacts = await createContactRuntime({
      scope: s,
      crypto: o.crypto,
      encryption: o.encryption,
      policy: o.contactPolicy,
      now: o.now,
    });
  return createDeliveryServices({
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
