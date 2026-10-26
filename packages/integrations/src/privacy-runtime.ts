import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  PrivacyCrypto,
  PrivacyJournal,
  PrivacyMail,
} from '../../application/src/ports/privacy-services.ts';
import type {
  ContactCrypto,
  ContactEncryption,
} from '../../application/src/ports/contact-services.ts';
import type { PrivateObjects } from '../../application/src/ports/assets.ts';
import { createPrivacyServices } from '../../application/src/services/privacy.ts';
import { createPrivacyServiceRepository } from '../../db/src/repositories/privacy-services.ts';
import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
import { ok } from '../../domain/src/values/core.ts';
import { boundedIO } from './bounded-io.ts';
import { createAssetRepository } from '../../db/src/repositories/assets.ts';
import { createCapabilityRepository } from '../../db/src/repositories/capabilities.ts';
import {
  createAssetService,
  createAssetRetentionService,
} from '../../application/src/services/assets.ts';
export async function createPrivacyRuntime(o: {
  readonly scope: ReturnType<typeof createTransactions>;
  readonly crypto: PrivacyCrypto;
  readonly contacts: Pick<ContactCrypto, 'emailKeys' | 'lookupVersions'>;
  readonly encryption: ContactEncryption;
  readonly journal: PrivacyJournal;
  readonly mail: PrivacyMail;
  readonly objects: PrivateObjects;
  readonly assetBucket: string;
  readonly assetKeyVersions: readonly string[];
  readonly policyVersion: string;
  readonly now: () => string;
}) {
  const role = await o.scope.unitOfWork.run(async (tx) =>
    ok((await o.scope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
  );
  if (!role.ok || role.value !== 'tt_privacy_runtime') throw Error('Invalid privacy runtime role');
  const covered = await o.scope.unitOfWork.run(async (tx) =>
    ok(
      (
        await o.scope.query(
          tx,
          `SELECT 1 FROM privacy.deletion_markers WHERE NOT(key_version=ANY($1::text[])) UNION ALL SELECT 1 FROM privacy.suppression_tombstones WHERE NOT(key_version=ANY($2::text[])) UNION ALL SELECT 1 FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE w.proof_hash IS NOT NULL AND r.due_at+interval '30 days'>clock_timestamp() AND NOT(w.proof_key_version=ANY($1::text[])) LIMIT 1`,
          [o.crypto.versions, o.contacts.lookupVersions],
        )
      ).rows.length === 0,
    ),
  );
  if (!covered.ok || !covered.value) throw Error('Invalid privacy key coverage');
  const objects: PrivateObjects = {
    ...o.objects,
    erase: (a) => boundedIO(() => o.objects.erase(a), 10000),
  };
  const services = createPrivacyServices({
    ...o,
    objects,
    mail: {
      verify: (i) => boundedIO(() => o.mail.verify(i), 5000),
      erase: (i) => boundedIO(() => o.mail.erase(i), 10000),
    },
    journal: { append: (key, record) => boundedIO(() => o.journal.append(key, record), 10000) },
    uow: o.scope.unitOfWork,
    repo: createPrivacyServiceRepository(o.scope, o.assetBucket, o.assetKeyVersions),
    owners: createOwnerRepository(o.scope),
    reliability: createReliabilityRepository(o.scope),
  });
  return {
    ...services,
    retentionAssets: createAssetRetentionService(
      o.assetKeyVersions.map((key) =>
        createAssetService({
          uow: o.scope.unitOfWork,
          authority: o.scope.unitOfWork,
          assets: createAssetRepository(o.scope, o.assetBucket, key),
          capabilities: createCapabilityRepository(o.scope),
          objects,
        }),
      ),
    ),
  };
}
