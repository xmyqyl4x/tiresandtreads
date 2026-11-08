import { randomBytes } from 'node:crypto';
import { KMSClient } from '@aws-sdk/client-kms';
import type { httpAdmissionFixture } from './http-admission.ts';
import type { composePhotoServices } from './compose-photo-services.ts';
import { createAnalysisErasureServices } from '../../../packages/application/src/analysis/analysis-lifecycle.ts';
import { createAnalysisErasureRepository } from '../../../packages/db/src/repositories/analysis-lifecycle.ts';
import { createEnvelopeEncryption } from '../../../packages/integrations/src/storage.ts';
import { createAnalysisReferenceEncryption } from '../../../packages/integrations/src/analysis-reference-encryption.ts';
import { createPrivacyCrypto } from '../../../packages/integrations/src/privacy-crypto.ts';
import type { SignedPrivacyRecord } from '../../../packages/application/src/ports/privacy-services.ts';
export function composeHttpPrivacy(
  f: Awaited<ReturnType<typeof httpAdmissionFixture>>,
  photo: Awaited<ReturnType<typeof composePhotoServices>>,
) {
  const kms = new KMSClient({
      endpoint: 'http://moto:5000',
      region: 'us-east-1',
      credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
      maxAttempts: 1,
    }),
    scope = f.privacyAdapter(),
    crypto = createPrivacyCrypto('local-http-v1', { 'local-http-v1': randomBytes(32) }),
    journal = new Map<string, SignedPrivacyRecord>();
  const service = createAnalysisErasureServices({
    uow: scope.unitOfWork,
    ownerUow: photo.adapter.unitOfWork,
    repository: createAnalysisErasureRepository(scope, photo.bucket, [photo.key]),
    owners: createAnalysisErasureRepository(photo.adapter, photo.bucket, [photo.key]),
    crypto,
    now: () => new Date().toISOString(),
    encryption: createAnalysisReferenceEncryption(photo.key, {
      [photo.key]: createEnvelopeEncryption(kms, photo.key),
    }),
    objects: photo.objects,
    journal: {
      async append(key, record) {
        if (journal.size >= 100 && !journal.has(key)) throw Error('Synthetic journal cap');
        journal.set(key, record);
      },
    },
    mail: {
      async verify() {
        throw Error('Actual notifications held');
      },
      async erase() {
        return 'not_stored';
      },
    },
    provider: {
      async erase() {
        return 'not_stored';
      },
    },
  });
  return { service, journal, cleanup: () => kms.destroy() };
}
