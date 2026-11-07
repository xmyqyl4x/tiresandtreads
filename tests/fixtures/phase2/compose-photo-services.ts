import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import type { photoServiceFixture } from './photo-services.ts';
import { composeReportAnalysis } from './compose-report-analysis.ts';
import { uuid } from './compose-partner-services.ts';
import { createPhotoServices } from '../../../packages/application/src/analysis/photo-services.ts';
import { createPhotoServiceRepository } from '../../../packages/db/src/repositories/photo-services.ts';
import { createPhotoAssetRepository } from '../../../packages/db/src/repositories/photo-assets.ts';
import { createPhotoOwnerRepository } from '../../../packages/db/src/repositories/photo-owners.ts';
import { createPhotoWorkerRepository } from '../../../packages/db/src/repositories/photo-worker.ts';
import { createAnalysisExecutionSupport } from '../../../packages/db/src/repositories/analysis-execution.ts';
import { createPrivateObjects } from '../../../packages/integrations/src/storage.ts';
import { createIsolatedPhotoCodec } from '../../../packages/integrations/src/photo-codec.ts';
import { createPhotoScanner } from '../../../packages/integrations/src/photo-scanner.ts';
import { createPhotoExtractionProvider } from '../../../packages/integrations/src/photo-provider.ts';
import type { PhotoExtractionTransport } from '../../../packages/application/src/ports/photo-services.ts';
export async function composePhotoServices(f: Awaited<ReturnType<typeof photoServiceFixture>>) {
  const endpoint = process.env.TEST_STORAGE_ENDPOINT;
  if (endpoint !== 'http://moto:5000') throw Error('Owned isolated Moto fixture required');
  const credentials = { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
      maxAttempts: 1,
    }),
    kms = new KMSClient({ endpoint, region: 'us-east-1', credentials, maxAttempts: 1 }),
    bucket = 'photo-private-' + uuid('bucket');
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    }),
  );
  const key = (await kms.send(new CreateKeyCommand({ Description: 'Owned synthetic photo proof' })))
    .KeyMetadata!.Arn!;
  const report = await composeReportAnalysis(f),
    adapter = report.adapter,
    objects = createPrivateObjects(s3, bucket, key),
    assets = createPhotoAssetRepository(adapter, bucket, key),
    repository = createPhotoServiceRepository(adapter, bucket, key),
    calls: Parameters<PhotoExtractionTransport['send']>[0][] = [];
  const defaultBehavior: PhotoExtractionTransport['send'] = async () => ({
    state: 'complete',
    output: {
      schema: 1,
      fields: [
        {
          field: 'tire_size',
          rawText: '225/65R17',
          value: '225/65R17',
          quality: 'clear',
          unknownReason: null,
          region: { x: 0, y: 0, w: 1, h: 1 },
        },
        {
          field: 'dot_tin',
          rawText: 'DOT ABC123',
          value: 'DOT ABC123',
          quality: 'clear',
          unknownReason: null,
          region: null,
        },
      ],
    },
    providerRequestId: 'synthetic-only',
    inputTokens: 100n,
    outputTokens: 30n,
    costMinor: 5n,
  });
  let behavior = defaultBehavior,
    scan: 'clean' | 'unsafe' | 'unavailable' = 'clean';
  const d = {
    ...report.d,
    ...createAnalysisExecutionSupport(adapter, { photoJobs: true }),
    repository,
    assets,
    objects,
    owners: createPhotoOwnerRepository(adapter),
    worker: createPhotoWorkerRepository(adapter),
    hashBytes: (b: Uint8Array) => createHash('sha256').update(b).digest('hex'),
    codec: createIsolatedPhotoCodec(),
    scanner: createPhotoScanner({
      async scan() {
        return scan;
      },
    }),
    provider: createPhotoExtractionProvider({
      async send(input) {
        calls.push(input);
        return behavior(input);
      },
    }),
    noticeVersion: 'photo-processing-v1',
  };
  const service = createPhotoServices(d);
  async function example(limits = { daily: 12, bytes: 41943040, active: 4 }) {
    const owner = await f.owner(),
      policy = uuid('ai_policy'),
      hash = randomBytes(32).toString('hex');
    await f.admin.query(
      "INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,reviewed_by,reviewed_at) VALUES($1,'photo_extraction','synthetic','no-provider-call','photo-local-v1','photo-selection-v1','photo-fields-v1','photo-c14n-v1',$2,'active',$3,clock_timestamp())",
      [policy, hash, f.staff],
    );
    await f.admin.query(
      "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) VALUES($1,$2,1048576,1024,100,100,100000,10000,1000,2,'active',$3)",
      [policy, hash, f.staff],
    );
    await f.admin.query(
      "INSERT INTO app.photo_upload_plans(policy_id,max_daily_uploads,max_daily_bytes,max_active_uploads,max_daily_captures,status,reviewed_by) VALUES($1,$2,$3,$4,4,'active',$5)",
      [policy, limits.daily, limits.bytes, limits.active, f.staff],
    );
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#aaaaaa' },
    })
      .jpeg()
      .toBuffer();
    const capture = await service.capture([owner.token], {
      key: 'capture-' + uuid('command'),
      policyId: policy,
    });
    if (!capture.ok) throw Error('Synthetic capture admission failed');
    return {
      owner,
      policy,
      keys: [owner.token],
      bytes,
      input: {
        allowed: true,
        batchId: capture.value.batchId,
        key: 'synthetic-' + uuid('command'),
        mime: 'image/jpeg' as const,
        noticeVersion: d.noticeVersion,
        policyId: policy,
        sha256: d.hashBytes(bytes),
        size: bytes.length,
      },
    };
  }
  async function cleanup() {
    try {
      const all = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket }));
      const ids = new Set(
        [...(all.Versions ?? []), ...(all.DeleteMarkers ?? [])].map((v) => v.Key),
      );
      for (const path of ids) {
        const id = path?.slice(7);
        if (id)
          await objects.erase({
            id: id as import('../../../packages/domain/src/values/core.ts').Id<'asset'>,
            revision: 1n as import('../../../packages/domain/src/values/core.ts').Revision,
            key: path!,
            mime: 'image/jpeg',
            sha256: '0'.repeat(64),
            size: 0,
            version: null,
            state: 'deleting',
          });
      }
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    } finally {
      s3.destroy();
      kms.destroy();
    }
  }
  return {
    service,
    d,
    adapter,
    assets,
    repository,
    objects,
    calls,
    bucket,
    s3,
    example,
    cleanup,
    setScan(v: typeof scan) {
      scan = v;
    },
    setBehavior(fn: typeof behavior) {
      behavior = fn;
    },
    reset() {
      scan = 'clean';
      behavior = defaultBehavior;
    },
  };
}
