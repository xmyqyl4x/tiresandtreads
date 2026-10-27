import pg from 'pg';
import { assertNoProviderData } from './local-provider-audit.ts';
import { lstat, readdir, mkdir, open, rename } from 'node:fs/promises';
import { S3Client, ListBucketsCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { KMSClient, ListKeysCommand } from '@aws-sdk/client-kms';
import { readProviderState, verifyProviderState, fixtureCredentials } from './local-host-state.ts';
import { prepareFixtureProvider } from './fixture-provider.ts';
const destination = '/state/provider-v2',
  file = destination + '/provider.json';
async function main() {
  const target = process.env.LOCAL_ENV;
  if (
    !['dev', 'stage'].includes(target ?? '') ||
    process.env.APP_ENV !== target + '-local' ||
    process.env.PROVIDER_MODE !== 'fixtures'
  )
    throw Error();
  await mkdir('/state/lock', { mode: 0o700 });
  try {
    const entries = await readdir('/state');
    if (entries.some((n) => !['current', 'lock', 'provider-v2'].includes(n)))
      throw Error('Interrupted custody setup requires review');
    if (entries.includes('provider-v2')) {
      await verifyProviderState(await readProviderState(file, target!), 'http://moto-durable:5000');
      console.log(JSON.stringify({ target, alreadyUpgraded: true, keyRotation: false }));
      return;
    }
    // A stock Moto key cannot be exported. Only a proved empty, synthetic provider may be retired.
    const previous = await readProviderState('/state/current/provider.json', target!);
    await verifyProviderState(previous, 'http://moto:5000');
    if ((await readdir('/journal')).length)
      throw Error('Existing privacy journal requires a separate migration');
    let checkedColumns = 0;
    for (const kind of ['app', 'cms']) {
      const role = `tt_${kind}_migrator`,
        password = process.env[`DB_PASSWORD_${role.toUpperCase()}`];
      if (!/^[a-f0-9]{64}$/.test(password ?? '')) throw Error();
      const client = new pg.Client({
        connectionString: `postgresql://${role}:${password}@postgres:5432/tt_${kind}`,
        connectionTimeoutMillis: 3000,
        statement_timeout: 3000,
        lock_timeout: 1000,
      });
      try {
        await client.connect();
        checkedColumns += await assertNoProviderData(client, previous.keyId);
      } finally {
        await client.end();
      }
    }
    const options = {
      endpoint: 'http://moto:5000',
      region: 'us-east-1',
      credentials: fixtureCredentials,
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 10000 },
    };
    const s3 = new S3Client({ ...options, forcePathStyle: true }),
      kms = new KMSClient(options);
    try {
      const keys = await kms.send(new ListKeysCommand({}));
      if (keys.Truncated || keys.Keys?.length !== 1 || keys.Keys[0]?.KeyArn !== previous.keyId)
        throw Error('Other fixture keys require a separate migration');
      const buckets = await s3.send(new ListBucketsCommand({}));
      const names = [...new Set(previous.objects.map((o) => o.bucket))];
      if (
        buckets.ContinuationToken ||
        buckets.Buckets?.length !== 2 ||
        buckets.Buckets.some((b) => !names.includes(b.Name!))
      )
        throw Error('Other fixture buckets require a separate migration');
      for (const Bucket of names) {
        const versions = await s3.send(new ListObjectVersionsCommand({ Bucket, MaxKeys: 100 }));
        const expected = previous.objects.filter((o) => o.bucket === Bucket);
        if (
          versions.IsTruncated ||
          versions.DeleteMarkers?.length ||
          versions.Versions?.length !== expected.length ||
          versions.Versions.some(
            (v) => !expected.some((e) => e.key === v.Key && e.version === v.VersionId),
          )
        )
          throw Error('Non-canary objects require a separate migration');
      }
    } finally {
      s3.destroy();
      kms.destroy();
    }
    const state = await prepareFixtureProvider(
      target as 'dev' | 'stage',
      'http://moto-durable:5000',
    );
    await mkdir('/state/provider-pending', { mode: 0o700 });
    const out = await open('/state/provider-pending/provider.json', 'wx', 0o600);
    try {
      await out.writeFile(JSON.stringify(state) + '\n');
      await out.chown(1000, 1000);
      await out.sync();
    } finally {
      await out.close();
    }
    const staged = await open('/state/provider-pending', 'r');
    try {
      await staged.chown(1000, 1000);
      await staged.sync();
    } finally {
      await staged.close();
    }
    await rename('/state/provider-pending', destination);
    const parent = await open('/state', 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    const settings = await lstat('/state/current/settings.json');
    if ((settings.mode & 0o077) !== 0) throw Error();
    console.log(
      JSON.stringify({
        target,
        upgraded: true,
        fixtureOnly: true,
        encryptedColumnsChecked: checkedColumns,
        encryptedValues: 0,
        oldKeyReferences: 0,
        retiredCanaryVersions: 4,
        newCanaryVersions: 4,
        legacyProviderUntouched: true,
        hostKeysUnchanged: true,
      }),
    );
  } finally {
    const { rmdir } = await import('node:fs/promises');
    await rmdir('/state/lock');
  }
}
main().catch(() => {
  console.error(
    'Provider upgrade refused; preserve both provider generations and inspect fixture/data custody. No stored data or keys were rewritten.',
  );
  process.exitCode = 1;
});
