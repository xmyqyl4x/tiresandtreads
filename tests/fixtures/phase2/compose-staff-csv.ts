import type { Result } from '../../../packages/domain/src/values/core.ts';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
import { createStaffCsvRuntime } from '../../../packages/integrations/src/staff-csv-runtime.ts';
import { createStaffCsvFiles } from '../../../packages/integrations/src/staff-csv-files.ts';
import { createPrivateObjects } from '../../../packages/integrations/src/storage.ts';
import { createContactCrypto } from '../../../packages/integrations/src/contact-crypto.ts';
import { staffCsvMappings } from '../../../packages/integrations/src/staff-csv-mappings.ts';
import { uuid } from './compose-partner-services.ts';
import type { staffCsvFixture } from './staff-csv-services.ts';
export function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r.error));
  return r.value as Extract<R, { ok: true }>['value'];
}
export async function composeStaffCsv(f: Awaited<ReturnType<typeof staffCsvFixture>>) {
  if (process.env.TEST_STORAGE_ENDPOINT !== 'http://moto:5000')
    throw Error('Owned local storage fixture required');
  const credentials = { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    s3 = new S3Client({
      endpoint: 'http://moto:5000',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
      maxAttempts: 1,
    }),
    kms = new KMSClient({
      endpoint: 'http://moto:5000',
      region: 'us-east-1',
      credentials,
      maxAttempts: 1,
    }),
    bucket = 'csv-private-' + uuid('bucket'),
    pools: pg.Pool[] = [];
  const adapter = (role: Parameters<typeof f.connectionUrl>[0]) => {
    const p = new pg.Pool({
      connectionString: f.connectionUrl(role),
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    pools.push(p);
    return createTransactions(p, { transactionMs: 15000, statementMs: 8000, lockMs: 3000 });
  };
  const staff = f.analysisAdapter('tt_p2_csv_staff'),
    ingest = adapter('tt_ingest_runtime'),
    publish = adapter('tt_publish_runtime'),
    assets = adapter('tt_asset_runtime');
  let created = false;
  async function cleanup() {
    try {
      if (created) {
        const all = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket }));
        for (const v of [...(all.Versions ?? []), ...(all.DeleteMarkers ?? [])]) {
          if (!v.VersionId || !v.Key?.startsWith('assets/'))
            throw Error('Owned CSV cleanup refused');
          await s3.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: v.Key, VersionId: v.VersionId }),
          );
        }
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
        created = false;
      }
    } finally {
      await Promise.all(pools.map((p) => p.end()));
      s3.destroy();
      kms.destroy();
    }
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    created = true;
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    const key = (
      await kms.send(new CreateKeyCommand({ Description: 'Owned synthetic CSV workflow proof' }))
    ).KeyMetadata!.Arn!;
    const objects = createPrivateObjects(s3, bucket, key),
      files = createStaffCsvFiles({ scope: assets, objects, bucket, keyVersion: key }),
      base = createContactCrypto(
        'local',
        { local: randomBytes(32) },
        { local: randomBytes(32) },
        randomBytes(32),
      ),
      crypto = {
        id: base.id,
        hash: base.hash,
        sha256: (b: Uint8Array) => createHash('sha256').update(b).digest('hex'),
      },
      options = {
        staff,
        ingest,
        publish,
        files,
        crypto,
        mappings: staffCsvMappings,
        parserRevision: createHash('sha1')
          .update(readFileSync('packages/domain/src/staff-csv.ts'))
          .digest('hex'),
        now: () => new Date().toISOString(),
      },
      service = await createStaffCsvRuntime(options);
    async function operator(permission: 'data.review' | 'data.publish') {
      const id = uuid('staff'),
        role = uuid('role');
      await f.admin.query(
        "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$1::uuid::text,'active',clock_timestamp())",
        [id],
      );
      await f.admin.query(
        "INSERT INTO admin.roles(id,code,permissions,policy_version) VALUES($1,'csv_'||replace($1::uuid::text,'-',''),$2,'synthetic-csv-v1')",
        [role, JSON.stringify([permission])],
      );
      await f.admin.query(
        'INSERT INTO admin.staff_role_assignments(staff_id,role_id) VALUES($1,$2)',
        [id, role],
      );
      return id;
    }
    const uploader = await operator('data.review'),
      reviewer = await operator('data.review'),
      publisher = await operator('data.publish');
    let version = 0;
    async function example(csv?: string) {
      const template = value(
          await service.createTemplate(uploader, {
            mapping: 'tire_models_v1',
            version: ++version,
            maxBytes: 16777216,
            maxRows: 100000,
            state: 'active',
          }),
        ),
        bytes = new TextEncoder().encode(
          csv ??
            'model_id,brand,model,category,seasonal_class,source_record_key\r\n' +
              uuid('tire_model') +
              ',Synthetic,CSV Touring,touring,all_season,synthetic-one\r\n',
        ),
        input = {
          command: 'upload-' + uuid('command'),
          effectiveAt: new Date(Date.now() - 10000).toISOString(),
          externalVersion: uuid('version'),
          licenseId: f.license,
          market: 'US',
          providerId: f.provider,
          templateId: template.id,
        };
      return { template, bytes, input };
    }
    async function upload(e: Awaited<ReturnType<typeof example>>) {
      const u = value(await service.upload(uploader, e.input, e.bytes));
      if (!u.id) throw Error('Expected registered intake');
      return u.id;
    }
    async function prepared() {
      const e = await example(),
        id = await upload(e);
      value(await service.validate(uploader, id));
      return { ...e, id };
    }
    async function reviewed() {
      const e = await prepared(),
        preview = value(
          await service.preview(reviewer, {
            intakeId: e.id,
            command: 'preview-' + uuid('command'),
          }),
        ),
        input = {
          previewId: preview.id,
          command: 'review-' + uuid('command'),
          decision: 'approved',
          reason: 'checks_passed',
        },
        review = value(await service.review(reviewer, input));
      return { ...e, preview, review, input };
    }
    return {
      service,
      files,
      options,
      staff,
      ingest,
      publish,
      assets,
      s3,
      bucket,
      key,
      crypto,
      uploader,
      reviewer,
      publisher,
      example,
      upload,
      prepared,
      reviewed,
      operator,
      cleanup,
    };
  } catch (e) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([e, cleanupError], 'CSV fixture setup and cleanup failed', {
        cause: cleanupError,
      });
    }
    throw e;
  }
}
