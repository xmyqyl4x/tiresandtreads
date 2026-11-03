import { localOperationRoutes } from './local-services.ts';
import { createConsentPolicyQuery } from '../../../application/src/queries/consent-policy.ts';
import { createContactServiceRepository } from '../../../db/src/repositories/contact-services.ts';
import { loadServiceHostSettings } from '../service-host-config.ts';
import { createLocalServiceHost } from '../service-host.ts';
import { createRuntimePool } from '../../../db/src/runtime-pool.ts';
import { createTransactions } from '../../../db/src/transactions.ts';
import { createCatalogRepository } from '../../../db/src/repositories/catalog.ts';
import { createReferenceQuery } from '../../../application/src/queries/reference.ts';
import { createReportCrypto } from '../report-crypto.ts';
import { createLocalHttpSecurity } from './security.ts';
import { createHttpApi } from './core.ts';
import { publicOwnerRoutes } from './public-owner.ts';
import { listenLocalApi } from './server.ts';
import { fail } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { S3Client } from '@aws-sdk/client-s3';
import { createAssetService } from '../../../application/src/services/assets.ts';
import { createAssetRepository } from '../../../db/src/repositories/assets.ts';
import { createCapabilityRepository } from '../../../db/src/repositories/capabilities.ts';
import { createPrivateObjects } from '../storage.ts';
import { ok } from '../../../domain/src/values/core.ts';

export async function createLocalPublicApi(env: Readonly<Record<string, string | undefined>>) {
  if (
    env.LOCAL_PRODUCT_API !== 'enabled' ||
    !['dev-local', 'stage-local', 'test-local'].includes(env.APP_ENV ?? '') ||
    env.PROVIDER_MODE !== 'fixtures'
  )
    throw Error('Local API activation refused');
  const settings = loadServiceHostSettings(env);
  const lanes = ['report', 'catalog', 'limiter', 'asset', 'staff'] as const;
  // The existing host reserves these extra HTTP connections before opening any lane.
  if (
    !lanes.every((lane) =>
      settings.plan.external.some(
        (x) =>
          x.name === 'local_http_' + lane &&
          x.database === 'application' &&
          x.max === 1 &&
          x.replicas === 1,
      ),
    )
  )
    throw Error('Local API connection budget missing');
  const host = await createLocalServiceHost(env);
  const pools = lanes.map((lane) =>
    createRuntimePool(settings.plan.urls[lane], 1, 4, 'tt-local-http:' + lane),
  );
  let server: Awaited<ReturnType<typeof listenLocalApi>> | undefined;
  let storage: S3Client | undefined;
  async function shutdown() {
    try {
      await server?.close();
    } finally {
      try {
        await Promise.all(pools.map((p) => p.drain()));
      } finally {
        try {
          await host.shutdown();
        } finally {
          storage?.destroy();
        }
      }
    }
  }
  try {
    const scopes = pools.map((p) =>
      createTransactions(p.pool, {
        admissionMs: 500,
        transactionMs: 2500,
        statementMs: 1000,
        lockMs: 250,
        idleMs: 1000,
      }),
    );
    const report = scopes[0]!,
      catalog = scopes[1]!,
      limiter = scopes[2]!,
      asset = scopes[3]!;
    const keyring = Object.fromEntries(
      Object.entries(settings.keys.report.values).map(([k, v]) => [
        k,
        new Uint8Array(Buffer.from(v, 'hex')),
      ]),
    );
    const crypto = createReportCrypto(
      settings.keys.report.current,
      keyring,
      new Uint8Array(Buffer.from(settings.keys.reportIdentity, 'hex')),
    );
    const security = createLocalHttpSecurity({
      owners: report,
      limiter,
      secret: keyring[settings.keys.report.current]!,
      keyVersion: settings.keys.report.current,
      retainedKeys: keyring,
    });
    const lookup = createReferenceQuery(catalog.unitOfWork, createCatalogRepository(catalog.query));
    storage = new S3Client({
      endpoint: env.STORAGE_ENDPOINT!,
      region: env.AWS_REGION!,
      forcePathStyle: true,
      credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
      maxAttempts: 1,
    });
    const assets = createAssetService({
      uow: asset.unitOfWork,
      assets: createAssetRepository(asset, env.PRIVATE_BUCKET!, env.KMS_KEY_ID!),
      authority: report.unitOfWork,
      capabilities: createCapabilityRepository(report),
      objects: createPrivateObjects(storage, env.PRIVATE_BUCKET!, env.KMS_KEY_ID!),
    });
    const extra = await localOperationRoutes({
      policy: createConsentPolicyQuery(
        report.unitOfWork,
        createContactServiceRepository(report, Object.keys(settings.keys.lookup)),
        settings.policy,
      ),
      services: host.services,
      staffScope: scopes[4]!,
      ownerSecurity: security.security,
      secret: keyring[settings.keys.report.current]!,
      crypto,
      env,
    });
    server = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        security: extra.security,
        routes: [
          ...security.sessions,
          ...extra.routes,
          ...publicOwnerRoutes({
            reports: host.services.reports,
            shareKeys: (token) => crypto.lookup('share', token),
            lookup,
            download: async (token) => {
              try {
                return ok(await assets.download(crypto.lookup('download', token)));
              } catch {
                return fail(failure('not_found'));
              }
            },
            content: (query) => {
              if ([...query.keys()].some((k) => !['path', 'locale', 'market'].includes(k)))
                return Promise.resolve(fail(failure('invalid_input')));
              return host.services.content.services.readPage(
                query.get('path') ?? '/',
                query.get('locale') ?? 'en-US',
                query.get('market') ?? 'US',
              );
            },
          }),
        ],
      }),
    );
    return {
      origin: server.origin,
      metadata: { mode: 'local-only', publicActivation: false, S3Accepted: false },
      shutdown,
    };
  } catch {
    await shutdown();
    throw Error('Local API unavailable');
  }
}
