import { S3Client } from '@aws-sdk/client-s3';
import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { loadServiceHostSettings } from './service-host-config.ts';
import { createServiceHostPools } from './service-host-pools.ts';
import { readWorkerConfig } from '../../config/src/worker.ts';
import { createRuntime } from './runtime.ts';
import { createContactCrypto } from './contact-crypto.ts';
import { createReportCrypto } from './report-crypto.ts';
import { createPrivacyCrypto } from './privacy-crypto.ts';
import { createCollectionCrypto, createQuotaCrypto } from './analytics-crypto.ts';
import { createEmailLinkCrypto } from './email-link-crypto.ts';
import { createFilePrivacyJournal } from './privacy-journal.ts';
import { createPrivateObjects } from './storage.ts';
import { createPublicSnapshots } from './public-snapshots.ts';
import { createReportRuntime } from './report-runtime.ts';
import { createContactRuntime } from './contact-runtime.ts';
import { createDeliveryRuntime } from './delivery-runtime.ts';
import { createFixtureReportRenderer } from './delivery-renderer.ts';
import { createPrivacyRuntime } from './privacy-runtime.ts';
import { createMailEventsRuntime, createEmailActionsRuntime } from './mail-events-runtime.ts';
import { createAnalyticsRuntime } from './analytics-runtime.ts';
import { createContentRuntime } from './content-runtime.ts';
import { createCommercialRuntime } from './commercial-runtime.ts';
import { createImportServices } from './import-runtime.ts';
import { createServiceMaintenanceRuntime } from './service-maintenance-runtime.ts';
import { createServiceHealth } from '../../application/src/services/service-health.ts';
import { createServiceHealthRepository } from '../../db/src/repositories/service-health.ts';
import { createOperationsRepository } from '../../db/src/repositories/operations.ts';
import { id, ok, fail } from '../../domain/src/values/core.ts';
import { failure } from '../../application/src/ports/transactions.ts';

// Local composition only. Provider activation and product HTTP routes require later gates.
export async function createLocalServiceHost(env: Readonly<Record<string, string | undefined>>) {
  const settings = loadServiceHostSettings(env),
    journalDirectory = env.SERVICE_HOST_JOURNAL_DIRECTORY;
  if (!journalDirectory || !isAbsolute(journalDirectory))
    throw Error('Local service host configuration unavailable');
  const raw = {
    ...env,
    PRIVATE_DATABASE_URL: settings.plan.urls.worker.replace(/^postgres:/i, 'postgresql:'),
    ASSET_DATABASE_URL: settings.plan.urls.asset.replace(/^postgres:/i, 'postgresql:'),
  };
  readWorkerConfig(raw);
  const pools = await createServiceHostPools(settings.plan),
    s = pools.scopes;
  let stopping = false,
    shutdown: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();
  let probing: Promise<boolean> | undefined;
  async function activity<T>(work: () => Promise<T>): Promise<T> {
    if (stopping) throw Error('Service host stopping');
    const task = Promise.resolve().then(work);
    active.add(task);
    try {
      return await task;
    } finally {
      active.delete(task);
    }
  }
  function guarded<T extends object>(object: T): T {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(object).map(([k, v]) => [
          k,
          typeof v === 'function'
            ? (...args: unknown[]) => {
                if (stopping) throw Error('Service host stopping');
                const result = Reflect.apply(v, object, args);
                if (!(result instanceof Promise)) return result;
                return activity(() => result);
              }
            : v && typeof v === 'object'
              ? guarded(v)
              : v,
        ]),
      ),
    ) as T;
  }
  let core: Awaited<ReturnType<typeof createRuntime>> | undefined;
  let storage: S3Client | undefined;
  async function stop() {
    stopping = true;
    core?.quiesce();
    return (shutdown ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...active]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        try {
          await core?.shutdown();
        } finally {
          await pools.shutdown();
          storage?.destroy();
        }
      }
    })());
  }
  try {
    let maintenance: ReturnType<typeof createServiceMaintenanceRuntime> | undefined = undefined;
    core = await createRuntime(
      raw,
      () => ({}),
      { record() {} },
      {
        privateScope: s.worker,
        assetScope: s.asset,
        requiredConnections: pools.budget.required,
        activity,
        maintenance: () =>
          activity(async () => {
            if (!maintenance) throw Error('Service host not ready');
            return maintenance.cycle(settings.maintenance.cycle);
          }),
      },
    );
    // Runtime validates local endpoints and explicit fixture credentials before constructing these clients.
    storage = new S3Client({
      endpoint: env.STORAGE_ENDPOINT!,
      region: env.AWS_REGION!,
      forcePathStyle: true,
      credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
      maxAttempts: 1,
    });
    const objects = createPrivateObjects(storage, env.PRIVATE_BUCKET!, env.KMS_KEY_ID!),
      snapshots = createPublicSnapshots(storage, env.PUBLIC_BUCKET!),
      bytes = (v: string) => new Uint8Array(Buffer.from(v, 'hex')),
      ring = (v: Readonly<Record<string, string>>) =>
        Object.fromEntries(Object.entries(v).map(([k, b]) => [k, bytes(b)])),
      k = settings.keys,
      contactCrypto = createContactCrypto(
        k.token.current,
        ring(k.token.values),
        ring(k.lookup),
        bytes(k.contactIdentity),
      ),
      reportCrypto = createReportCrypto(
        k.report.current,
        ring(k.report.values),
        bytes(k.reportIdentity),
      ),
      privacyCrypto = createPrivacyCrypto(k.privacy.current, ring(k.privacy.values)),
      now = () => new Date().toISOString();
    const notices = Object.fromEntries(
      Object.entries(settings.policy.notices).map(([p, v]) => {
        const parsed = id('notice', v);
        if (!parsed.ok) throw Error();
        return [p, parsed.value];
      }),
    ) as Parameters<typeof createContactRuntime>[0]['policy']['notices'];
    const template = id('template', settings.policy.templateId);
    if (!template.ok) throw Error();
    const checked = await s.report.unitOfWork.run(async (tx) => {
      const n = await s.report.query(
        tx,
        'SELECT id,purpose FROM privacy.notices WHERE id=ANY($1::uuid[]) AND market_policy=$2 AND published_at<=clock_timestamp()',
        [Object.values(notices), settings.policy.version],
      );
      const t = await s.report.query(
        tx,
        "SELECT 1 FROM email.template_versions WHERE id=$1 AND renderer_hash=$2 AND status='published' AND purpose='report' AND locale='en-US'",
        [template.value, settings.policy.rendererHash],
      );
      return ok(
        n.rows.length === 6 &&
          Object.entries(notices).every(([purpose, identifier]) =>
            n.rows.some((r) => r.id === identifier && r.purpose === purpose),
          ) &&
          t.rows.length === 1,
      );
    });
    if (!checked.ok || !checked.value) throw Error('Service host policy unavailable');
    await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
    const journal = createFilePrivacyJournal(journalDirectory, privacyCrypto);
    // Reads and verifies the persisted journal before readiness; never reseeds it or rotates keys.
    await journal.capture(now());
    const contactPolicy = { version: settings.policy.version, notices },
      contacts = await createContactRuntime({
        scope: s.report,
        crypto: contactCrypto,
        encryption: core.encryption,
        policy: contactPolicy,
        now,
      }),
      reports = await createReportRuntime({
        privateScope: s.report,
        catalogScope: s.catalog,
        sourceScope: s.report_source,
        crypto: reportCrypto,
        encryption: core.encryption,
        now,
      }),
      delivery = await createDeliveryRuntime({
        privateScope: s.worker,
        assetScope: s.asset,
        crypto: contactCrypto,
        encryption: core.encryption,
        contactPolicy,
        policy: {
          version: settings.policy.version,
          templateId: template.value,
          sender: 'Local fixture <local@example.invalid>',
          fixture: true,
        },
        renderer: createFixtureReportRenderer(settings.policy.rendererHash),
        provider: {
          name: 'fixture',
          fixture: true,
          send: async () => {
            throw Error('Local mail unavailable');
          },
        },
        objects,
        bucket: env.PRIVATE_BUCKET!,
        keyVersion: env.KMS_KEY_ID!,
        now,
      }),
      privacy = await createPrivacyRuntime({
        scope: s.privacy,
        crypto: privacyCrypto,
        contacts: contactCrypto,
        encryption: core.encryption,
        journal,
        mail: {
          verify: async () => {
            throw Error('Local mail unavailable');
          },
          erase: async () => 'unsupported',
        },
        objects,
        assetBucket: env.PRIVATE_BUCKET!,
        assetKeyVersions: [env.KMS_KEY_ID!],
        policyVersion: settings.policy.privacyVersion,
        now,
      }),
      mail = await createMailEventsRuntime({
        scope: s.worker,
        lookupVersions: contactCrypto.lookupVersions,
        retrieve: async () => {
          throw Error('Local mail unavailable');
        },
      }),
      actions = createEmailActionsRuntime({
        scope: s.report,
        contacts,
        crypto: createEmailLinkCrypto(k.token.current, ring(k.token.values), contactCrypto),
        origin: settings.origin,
      }),
      analytics = await createAnalyticsRuntime({
        scopes: {
          report: s.report,
          collector: s.collector,
          aggregate: s.aggregate,
          limiter: s.limiter,
          operations: s.operations,
        },
        crypto: createCollectionCrypto(
          k.collection.current,
          ring(k.collection.values),
          bytes(k.collectionIdentity),
        ),
        quotaCrypto: createQuotaCrypto(ring(k.lookup)),
        enabled: false,
        policy: settings.policy.version,
        noticeId: notices.analytics,
        now,
      }),
      content = await createContentRuntime({
        appScope: s.content,
        publicScope: s.public,
        cmsScope: s.cms,
        snapshots,
        crawler: {
          observe: async () => {
            throw Error('Local crawl unavailable');
          },
        },
        search: {
          enabled: false,
          daily: async () => {
            throw Error('Local search unavailable');
          },
          notify: async () => 'disabled',
        },
        origin: settings.origin,
        production: false,
        now,
      }),
      commercial = await createCommercialRuntime({
        scopes: { staff: s.staff, commercial: s.commercial, public: s.public },
        mail,
        privacy,
        externalActivationApproved: false,
        now,
      }),
      imports = createImportServices(s.ingest, s.publish, {
        pull: async () => fail(failure('unavailable')),
      }),
      health = createServiceHealth({
        uow: s.operations.unitOfWork,
        health: createServiceHealthRepository(s.operations),
        operations: createOperationsRepository(s.operations),
      });
    maintenance = createServiceMaintenanceRuntime({
      delivery,
      privacy,
      mail,
      analytics: analytics.analytics,
      admission: analytics.admission,
      content: content.services,
      sources: imports.sourceRefresh,
      jurisdiction: settings.policy.jurisdiction,
      enabled: settings.maintenance.enabled,
    });
    const services = guarded({
      reports,
      contacts,
      delivery,
      privacy,
      mail,
      actions,
      ...analytics,
      content,
      ...commercial,
      imports,
      health,
      maintenance,
    });
    const durable = core;
    return {
      metadata: Object.freeze({
        mode: 'local-fixtures',
        environment: env.APP_ENV,
        revision: env.SOURCE_REVISION ?? 'working',
        connections: pools.budget,
        productApis: false,
        reportIssuanceApproved: false,
        externalMail: false,
        analyticsCollection: false,
        externalAdvertising: false,
        maintenanceEnabled: Object.freeze([...settings.maintenance.enabled]),
        retentionDryRun: true,
      }),
      services,
      ready() {
        return (probing ??= activity(async () => {
          const results = await Promise.all(
            [s.operations, s.cms].map((scope) =>
              scope.unitOfWork.run(async (tx) => {
                await scope.query(tx, 'SELECT 1');
                return ok(null);
              }),
            ),
          );
          return !stopping && results.every((r) => r.ok);
        }).finally(() => {
          probing = undefined;
        }));
      },
      workflows: core.workflows,
      // SQL-only jobs remain explicitly registered; no arbitrary product handler map is invented.
      durable: guarded({
        enqueue: durable.enqueue,
        tick: durable.tick,
        command: durable.command,
        receiveVerified: durable.receiveVerified,
      }),
      shutdown: stop,
    };
  } catch {
    await stop();
    throw Error('Local service host unavailable');
  }
}
