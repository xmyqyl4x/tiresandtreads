import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { S3Client, CreateBucketCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import { contentFixture, uid } from '../content/database.ts';
import { hostSettings } from '../service-host/settings.ts';
import { localStaffFixture } from '../../../packages/integrations/src/http/local-fixtures.ts';
export async function composedApiFixture() {
  let directory = '';
  const f = await contentFixture();
  directory = await mkdtemp(join(tmpdir(), 'tt-api-host-'));
  const file = join(directory, 'settings.json');
  const settings = hostSettings(
    (r) => f.connectionUrl(r as Parameters<typeof f.connectionUrl>[0]),
    f.cmsConnectionUrl('tt_cms_runtime'),
  );
  settings.plan.external.push(
    ...['report', 'catalog', 'limiter', 'asset', 'staff'].map((lane) => ({
      name: 'local_http_' + lane,
      database: 'application',
      max: 1,
      replicas: 1,
    })),
  );
  settings.maintenance = { enabled: ['publication'], cycle: ['publication'] };
  for (const [purpose, id] of Object.entries(settings.policy.notices))
    await f.owner.query(
      "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,'synthetic','host',$3,now(),'synthetic-local-host')",
      [id, purpose, 'a'.repeat(64)],
    );
  await f.owner.query(
    "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,'host-fixture','1','en-US','report',$2,'published',now())",
    [settings.policy.templateId, settings.policy.rendererHash],
  );
  for (const kind of ['delete', 'restrict', 'opt_out', 'access', 'correct', 'export'])
    await f.owner.query(
      "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'hostfixture','host-fixture',$2,now())",
      ['rights:' + kind, { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 }],
    );
  await f.owner.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='operations_read'",
    [f.staff],
  );
  const endpoint = process.env.TEST_STORAGE_ENDPOINT!,
    credentials = { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' };
  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials,
    maxAttempts: 1,
  });
  const kms = new KMSClient({ endpoint, region: 'us-east-1', credentials, maxAttempts: 1 });
  const bucket = 'host-private-' + uid('bucket'),
    publicBucket = 'host-public-' + uid('bucket');
  for (const Bucket of [bucket, publicBucket]) {
    await s3.send(new CreateBucketCommand({ Bucket }));
    await s3.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
    );
  }
  const key = (await kms.send(new CreateKeyCommand({ Description: 'Synthetic local host' })))
    .KeyMetadata!.Arn!;
  const env = {
    LOCAL_PRODUCT_API: 'enabled',
    APP_ENV: 'test-local',
    PROVIDER_MODE: 'fixtures',
    SERVICE_HOST_CONFIG_FILE: file,
    SERVICE_HOST_JOURNAL_DIRECTORY: join(directory, 'journal'),
    STORAGE_ENDPOINT: endpoint,
    WORKFLOW_ENDPOINT: process.env.TEST_WORKFLOW_ENDPOINT!,
    PRIVATE_BUCKET: bucket,
    PUBLIC_BUCKET: publicBucket,
    KMS_KEY_ID: key,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'fixture-access',
    AWS_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  await f.owner.query(
    "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES('local_http','1',60,1000,true)",
  );
  const issued = localStaffFixture(
    new Uint8Array(Buffer.from(settings.keys.report.values['local-v1'], 'hex')),
    f.staff,
    new Date().toISOString(),
  );
  const staffFile = join(directory, 'staff.json');
  await writeFile(
    staffFile,
    JSON.stringify({ schemaVersion: 1, mode: 'synthetic-local', grants: [issued.grant] }),
    { mode: 0o600 },
  );
  await writeFile(file, JSON.stringify(settings), { mode: 0o600 });
  return {
    f,
    env: { ...env, LOCAL_STAFF_GRANTS_FILE: staffFile },
    settings,
    issued,
    async cleanup() {
      s3.destroy();
      kms.destroy();
      await f.cleanup();
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tt-api-host-'))
        throw Error('Unexpected cleanup');
      await rm(directory, { recursive: true, force: true });
    },
  };
}
