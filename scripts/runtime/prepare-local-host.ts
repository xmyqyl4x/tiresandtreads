import {
  mkdir,
  readFile,
  writeFile,
  rename,
  chown,
  chmod,
  rmdir,
  readdir,
  lstat,
  open,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand, EncryptCommand } from '@aws-sdk/client-kms';
import {
  localHostSettings,
  digest,
  fixtureCredentials,
  readProviderState,
  verifyProviderState,
  type LocalProviderState,
} from './local-host-state.ts';
import { readServiceHostSettings } from '../../packages/config/src/service-host-settings.ts';
import { pendingMigrations, loadSources } from '../database/manifest.ts';
import { readHistory } from '../database/migrate.ts';

async function main() {
  const target = process.env.LOCAL_ENV,
    check = process.argv[2] === 'check';
  if (
    !['dev', 'stage'].includes(target ?? '') ||
    process.env.APP_ENV !== target + '-local' ||
    process.env.PROVIDER_MODE !== 'fixtures' ||
    (process.argv[2] && !check)
  )
    throw Error();
  // No inherited URL, target path or native database override is accepted by this operator.
  const dir = '/state/current',
    endpoint = 'http://moto:5000';
  await mkdir('/state/lock', { mode: 0o700 });
  const client = new pg.Client({
    connectionString: `postgresql://tt_app_migrator:${process.env.DB_PASSWORD_TT_APP_MIGRATOR}@postgres:5432/tt_app`,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    lock_timeout: 1000,
  });
  try {
    await client.connect();
    if (pendingMigrations(loadSources('app'), await readHistory(client)).length) throw Error();
    const files = await readdir('/state');
    let settings;
    if (files.includes('current')) {
      if (files.some((f) => !['current', 'lock'].includes(f))) throw Error('Incomplete setup');
      const info = await lstat(dir + '/settings.json');
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536 || info.mode & 0o077)
        throw Error();
      settings = readServiceHostSettings(
        JSON.parse(await readFile(dir + '/settings.json', 'utf8')),
      );
      const expected = localHostSettings(target!, process.env);
      if (
        JSON.stringify(settings.plan) !== JSON.stringify(expected.plan) ||
        settings.policy.version !== expected.policy.version ||
        JSON.stringify(settings.maintenance) !== JSON.stringify(expected.maintenance)
      )
        throw Error('Retained configuration differs; do not rotate');
      await verifyProviderState(await readProviderState(dir + '/provider.json', target!), endpoint);
    } else {
      if (check || files.some((f) => f !== 'lock'))
        throw Error('Prepare or inspect incomplete setup');
      settings = localHostSettings(target!, process.env);
      const options = {
        endpoint,
        region: 'us-east-1',
        credentials: fixtureCredentials,
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 2000, requestTimeout: 10000 },
      };
      const s3 = new S3Client({ ...options, forcePathStyle: true }),
        kms = new KMSClient(options);
      try {
        // Never adopt or overwrite existing provider buckets when the private manifest is missing.
        for (const kind of ['private', 'public']) {
          try {
            await s3.send(new HeadBucketCommand({ Bucket: `local-host-${kind}-${target}` }));
            throw Error('Existing bucket requires custody review');
          } catch (e) {
            if (!(
              e &&
              typeof e === 'object' &&
              '$metadata' in e &&
              (e.$metadata as { httpStatusCode?: number }).httpStatusCode === 404
            ))
              throw e;
          }
        }
        const keyId = (
          await kms.send(
            new CreateKeyCommand({ Description: `Synthetic retained local host ${target}` }),
          )
        ).KeyMetadata!.Arn!;
        const plaintext = randomBytes(32),
          ciphertext = (await kms.send(new EncryptCommand({ KeyId: keyId, Plaintext: plaintext })))
            .CiphertextBlob!;
        const objects: LocalProviderState['objects'] = [];
        for (const kind of ['private', 'public']) {
          const Bucket = `local-host-${kind}-${target}`;
          await s3.send(new CreateBucketCommand({ Bucket }));
          await s3.send(
            new PutBucketVersioningCommand({
              Bucket,
              VersioningConfiguration: { Status: 'Enabled' },
            }),
          );
          for (let n = 0; n < 2; n++) {
            const Body = Buffer.from(`Synthetic provider canary ${target} ${kind} ${n}`),
              Key = 'fixture/provider-canary' as const;
            const r = await s3.send(new PutObjectCommand({ Bucket, Key, Body }));
            if (!r.VersionId) throw Error();
            objects.push({ bucket: Bucket, key: Key, version: r.VersionId, sha256: digest(Body) });
          }
        }
        const state = {
          schemaVersion: 1 as const,
          target: target as 'dev' | 'stage',
          keyId,
          ciphertext: Buffer.from(ciphertext).toString('base64'),
          plaintextHash: digest(plaintext),
          objects,
        };
        await verifyProviderState(state, endpoint);
        await mkdir('/state/pending', { mode: 0o700 });
        for (const [name, data] of [
          ['settings', settings],
          ['provider', state],
        ] as const) {
          const path = `/state/pending/${name}.json`;
          await writeFile(path, JSON.stringify(data) + '\n', { flag: 'wx', mode: 0o600 });
          await chown(path, 1000, 1000);
          const handle = await open(path, 'r');
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
        await chown('/state/pending', 1000, 1000);
        const staged = await open('/state/pending', 'r');
        try {
          await staged.sync();
        } finally {
          await staged.close();
        }
        await rename('/state/pending', dir);
        const stateDirectory = await open('/state', 'r');
        try {
          await stateDirectory.sync();
        } finally {
          await stateDirectory.close();
        }
      } finally {
        s3.destroy();
        kms.destroy();
      }
    }
    if (!check) {
      // Narrow, explicit synthetic fixture preparation; no existing notice/template is updated.
      await client.query('BEGIN');
      try {
        for (const [purpose, id] of Object.entries(settings.policy.notices)) {
          const hash = digest(`Synthetic ${settings.policy.version} ${purpose}`);
          await client.query(
            "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,$3,'local-fixture-v1',$4,now(),'synthetic-local-host') ON CONFLICT DO NOTHING",
            [id, purpose, settings.policy.version, hash],
          );
          const r = await client.query(
            "SELECT 1 FROM privacy.notices WHERE id=$1 AND purpose=$2 AND market_policy=$3 AND version='local-fixture-v1' AND content_hash=$4 AND content_ref='synthetic-local-host' AND published_at<=now()",
            [id, purpose, settings.policy.version, hash],
          );
          if (r.rowCount !== 1) throw Error('Conflicting synthetic policy');
        }
        await client.query(
          "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,$2,'local-fixture-v1','en-US','report',$3,'published',now()) ON CONFLICT DO NOTHING",
          [settings.policy.templateId, settings.policy.version, settings.policy.rendererHash],
        );
        const r = await client.query(
          "SELECT 1 FROM email.template_versions WHERE id=$1 AND template_key=$2 AND renderer_hash=$3 AND status='published' AND purpose='report' AND locale='en-US' AND version='local-fixture-v1'",
          [settings.policy.templateId, settings.policy.version, settings.policy.rendererHash],
        );
        if (r.rowCount !== 1) throw Error('Conflicting synthetic template');
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      await mkdir('/journal', { recursive: true, mode: 0o700 });
      await chmod('/journal', 0o700);
      await chown('/journal', 1000, 1000);
    }
    console.log(
      JSON.stringify({
        target,
        prepared: !check,
        providerVerified: true,
        rotation: false,
        maintenanceEnabled: settings.maintenance.enabled,
        productApis: false,
      }),
    );
  } finally {
    await client.end();
    await rmdir('/state/lock');
  }
}
main().catch(() => {
  console.error(
    'Local host preparation refused; retain private state and inspect migrations, fixture custody or interrupted setup. No reset performed.',
  );
  process.exitCode = 1;
});
