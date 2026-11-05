import type {
  ReportRenderer,
  FrozenDelivery,
} from '../../../packages/application/src/ports/delivery-services.ts';
import { createConsentPolicyQuery } from '../../../packages/application/src/queries/consent-policy.ts';
import { createContactServiceRepository } from '../../../packages/db/src/repositories/contact-services.ts';
import { privateFixture, uid, time, success } from '../private/database.ts';
import { createContactCrypto } from '../../../packages/integrations/src/contact-crypto.ts';
import { createContactRuntime } from '../../../packages/integrations/src/contact-runtime.ts';
import { createDeliveryRuntime } from '../../../packages/integrations/src/delivery-runtime.ts';
import { createFixtureReportRenderer } from '../../../packages/integrations/src/delivery-renderer.ts';
import { createPrivacyRuntime } from '../../../packages/integrations/src/privacy-runtime.ts';
import { createPrivacyCrypto } from '../../../packages/integrations/src/privacy-crypto.ts';
import { createCommercialRuntime } from '../../../packages/integrations/src/commercial-runtime.ts';
import { createImportServices } from '../../../packages/integrations/src/import-runtime.ts';
import { createOperationsServices } from '../../../packages/application/src/services/analytics.ts';
import { createOperationsRepository } from '../../../packages/db/src/repositories/operations.ts';
import { createHealthRepository } from '../../../packages/db/src/repositories/analytics-maintenance.ts';
import { createStaffRepository } from '../../../packages/db/src/repositories/staff-services.ts';
import { createLocalHttpSecurity } from '../../../packages/integrations/src/http/security.ts';
import {
  withLocalStaffSessions,
  type LocalStaffGrant,
} from '../../../packages/integrations/src/http/staff-security.ts';
import { localStaffFixture } from '../../../packages/integrations/src/http/local-fixtures.ts';
import { createHttpApi } from '../../../packages/integrations/src/http/core.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { consentRoutes } from '../../../packages/integrations/src/http/consent.ts';
import type { HttpRoute } from '../../../packages/integrations/src/http/core.ts';
import type { HttpSecurity } from '../../../packages/integrations/src/http/core.ts';
import { staffRoutes } from '../../../packages/integrations/src/http/staff.ts';
import { registeredImportArtifact } from '../../../packages/integrations/src/http/local-files.ts';
import { ok, fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import type { ContactPolicy } from '../../../packages/application/src/ports/contact-services.ts';
import type { SignedPrivacyRecord } from '../../../packages/application/src/ports/privacy-services.ts';
import type { createLocalServiceHost } from '../../../packages/integrations/src/service-host.ts';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
export async function operationsApiFixture(
  extend?: (context: {
    readonly db: Awaited<ReturnType<typeof privateFixture>>;
    readonly services: Awaited<ReturnType<typeof createLocalServiceHost>>['services'];
    readonly crypto: ReturnType<typeof createContactCrypto>;
    readonly policy: ContactPolicy;
    readonly security: HttpSecurity;
  }) => Promise<readonly HttpRoute[]>,
  mailProof?: { renderer(hash: string): ReportRenderer },
) {
  const db = await privateFixture();
  const observations: { operationId: string; method: string; status: number }[] = [];
  let observationsTruncated = false;
  let server: Awaited<ReturnType<typeof listenLocalApi>> | undefined, directory: string | undefined;
  try {
    await db.admin.query(
      "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES('local_http','1',60,1000,true)",
    );
    const crypto = createContactCrypto(
      't1',
      { t1: new Uint8Array(32).fill(14) },
      { 'test-hmac-v1': new Uint8Array(32).fill(15) },
      new Uint8Array(32).fill(16),
    );
    const notices = {} as ContactPolicy['notices'];
    for (const purpose of [
      'report',
      'offers',
      'analytics',
      'ads',
      'targeted_ads',
      'necessary',
    ] as const)
      (notices as Record<string, string>)[purpose] = await db.notice(purpose);
    const contactPolicy = { version: 'synthetic', notices },
      encryption = {
        encrypt: async (bytes: Uint8Array) => ({
          keyVersion: 'synthetic',
          hex: Buffer.from(bytes).toString('hex'),
        }),
        decrypt: async (value: { hex: string }) => new Uint8Array(Buffer.from(value.hex, 'hex')),
      };
    const contacts = await createContactRuntime({
      scope: db.scope,
      crypto,
      encryption,
      policy: contactPolicy,
      now: () => time(),
    });
    const objectsData = new Map<string, Uint8Array>(),
      objects = {
        put: async (a: { id: string }, bytes: Uint8Array) => {
          objectsData.set(a.id, bytes);
          return 'fixture';
        },
        get: async (a: { id: string }) => objectsData.get(a.id)!,
        erase: async (a: { id: string }) => {
          objectsData.delete(a.id);
        },
      };
    const templateId = await db.template(),
      hash = (
        await db.admin.query('SELECT renderer_hash FROM email.template_versions WHERE id=$1', [
          templateId,
        ])
      ).rows[0].renderer_hash as string;
    let providerCalls = 0;
    const syntheticMail: FrozenDelivery[] = [];
    const delivery = await createDeliveryRuntime({
      privateScope: db.scope,
      assetScope: db.adapter('tt_asset_runtime'),
      crypto,
      encryption,
      contactPolicy,
      policy: {
        version: 'synthetic',
        sender: 'Tires <fixture@example.invalid>',
        templateId,
        fixture: true,
      },
      renderer: mailProof?.renderer(hash) ?? createFixtureReportRenderer(hash),
      provider: {
        name: 'fixture',
        fixture: true,
        send: async (_key, payload) => {
          providerCalls++;
          if (mailProof) {
            if (!payload.recipient.endsWith('@example.invalid') || syntheticMail.length >= 20)
              throw Error('Synthetic sink refused');
            syntheticMail.push(structuredClone(payload));
            return { outcome: 'accepted', messageId: uid('synthetic_message') };
          }
          return { outcome: 'definitive_rejection', messageId: null };
        },
      },
      objects,
      bucket: 'synthetic-private',
      keyVersion: 'fixture-kms',
      now: () => time(),
    });
    for (const kind of ['delete', 'restrict', 'opt_out', 'access', 'export', 'correct'])
      await db.admin.query(
        "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'synthetic','p25',$2,now())",
        [
          'rights:' + kind,
          { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 },
        ],
      );
    const journal = new Map<string, SignedPrivacyRecord>(),
      inbox: { address: string; proof: string }[] = [];
    const privacy = await createPrivacyRuntime({
      scope: db.adapter('tt_privacy_runtime'),
      crypto: createPrivacyCrypto('p1', { p1: new Uint8Array(32).fill(13) }),
      contacts: crypto,
      encryption,
      journal: {
        append: async (key, record) => {
          journal.set(key, record);
        },
      },
      mail: {
        verify: async (value) => {
          inbox.push(value);
        },
        erase: async () => 'erased',
      },
      objects,
      assetBucket: 'synthetic-private',
      assetKeyVersions: ['fixture-kms'],
      policyVersion: 'p25',
      now: () => time(),
    });
    const staffScope = db.adapter('tt_staff_service_runtime'),
      commercial = await createCommercialRuntime({
        scopes: {
          staff: staffScope,
          commercial: db.adapter('tt_commercial_runtime'),
          public: db.adapter('tt_public_runtime'),
        },
        mail: {
          reconcile: async () => ok({ status: 'manual_review' }),
          replay: async () => ok('processed'),
        },
        privacy,
        now: () => time(),
      });
    const operationScope = db.adapter('tt_operations_runtime'),
      operations = createOperationsServices({
        uow: operationScope.unitOfWork,
        operations: createOperationsRepository(operationScope),
        health: createHealthRepository(operationScope),
      });
    const imports = createImportServices(db.ingestScope, db.publishScope);
    // CMS publication is separately covered by the paired-CMS/full-runtime tests. This fixture never simulates a successful CMS publication.
    const unavailable = async () => fail(failure('unavailable', true));
    const services = {
      contacts,
      delivery,
      privacy,
      imports,
      staff: commercial.staff,
      commercial: commercial.commercial,
      operations,
      content: {
        services: { enqueue: unavailable, audit: unavailable, searchMetrics: unavailable },
      },
    } as unknown as Awaited<ReturnType<typeof createLocalServiceHost>>['services'];
    const ownerSecurity = createLocalHttpSecurity({
        owners: db.scope,
        limiter: db.adapter('tt_limiter_runtime'),
        secret: new Uint8Array(32).fill(99),
        keyVersion: 'http-v1',
      }),
      secret = new Uint8Array(32).fill(77),
      grants: LocalStaffGrant[] = [];
    const security = {
      authenticate: (r: Request) =>
        withLocalStaffSessions(ownerSecurity.security, grants, secret).authenticate(r),
      quota: ownerSecurity.security.quota,
    };
    const staffRepo = createStaffRepository(staffScope);
    directory = await mkdtemp(join(tmpdir(), 'tt-http-operations-'));
    const extra = (await extend?.({ db, services, crypto, policy: contactPolicy, security })) ?? [];
    server = await listenLocalApi((origin) =>
      createHttpApi({
        origin,
        security,
        observe: (record) => {
          if (observations.length >= 1000) {
            observationsTruncated = true;
            return;
          }
          observations.push({
            operationId: record.operationId,
            method: record.method,
            status: record.status,
          });
        },
        routes: [
          ...ownerSecurity.sessions,
          ...extra,
          ...consentRoutes({
            contacts,
            delivery,
            privacy,
            policy: createConsentPolicyQuery(
              db.scope.unitOfWork,
              createContactServiceRepository(db.scope, crypto.lookupVersions),
              contactPolicy,
            ),
          }),
          ...staffRoutes({
            services,
            authorize: (actor, permission) =>
              staffScope.unitOfWork.run(async (tx) => {
                await staffRepo.authorize(tx, actor, permission);
                return ok(null);
              }),
            artifact: (id) => registeredImportArtifact(directory!, id),
            commandId: (actor, key) => crypto.id('command', actor + ':' + key),
          }),
        ],
      }),
    );
    const listener = server;
    async function session() {
      const r = await fetch(listener.origin + '/api/v1/sessions', {
        method: 'POST',
        headers: { origin: listener.origin, 'content-type': 'application/json' },
        body: '{}',
      });
      if (r.status !== 200) throw Error('Fixture session failed');
      const body = (await r.json()) as { data: { csrf: string } };
      return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, csrf: body.data.csrf };
    }
    async function call(
      path: string,
      who?: { cookie?: string; csrf: string; bearer?: string },
      body?: unknown,
      key = 'synthetic_command_001',
      method?: 'POST' | 'DELETE',
    ) {
      return fetch(listener.origin + '/api/v1' + path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          origin: listener.origin,
          'content-type': 'application/json',
          'idempotency-key': key,
          ...(who
            ? {
                'x-csrf-token': who.csrf,
                ...(who.cookie ? { cookie: who.cookie } : {}),
                ...(who.bearer ? { authorization: 'Bearer ' + who.bearer } : {}),
              }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function staff(role: string) {
      const id = uid('staff');
      await db.admin.query(
        "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
        [id, id],
      );
      await db.admin.query(
        'INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code=$2',
        [id, role],
      );
      const issued = localStaffFixture(secret, id, new Date().toISOString());
      grants.push(issued.grant);
      return { id, bearer: issued.bearer, csrf: issued.csrf };
    }
    async function ownerIdentity(who: { cookie: string; csrf: string }) {
      const actor = await security.authenticate(
        new Request(listener.origin, { headers: { cookie: who.cookie } }),
      );
      if (!actor) throw Error('Missing owner');
      const owner = await success(db.scope.unitOfWork, (tx) => db.owners.resolve(tx, actor.keys));
      if (!owner) throw Error('Missing owner');
      return owner;
    }
    async function report(who: { cookie: string; csrf: string }) {
      const owner = await ownerIdentity(who);
      return db.report(owner, {
        purpose: 'technical_evaluation',
        issuanceAuthorized: false,
        result: {
          asOf: time(),
          versions: {
            engine: 'fixture',
            schema: 1,
            policy: 'fixture',
            scoring: 'fixture',
            bundleId: db.bundleId,
            datasets: [],
            ruleVersionId: db.ruleId,
          },
          picks: [],
          decisions: [],
        },
        prices: [],
        products: [],
      });
    }
    async function artifact() {
      const id = uid('artifact'),
        data = '',
        manifest = {
          id: uid('dataset'),
          providerId: db.provider,
          licenseId: db.license,
          kind: 'catalog',
          externalVersion: uid('version'),
          checksum: createHash('sha256').update(data).digest('hex'),
          effectiveAt: time(),
          fetchedAt: time(),
          upstreamRunKey: uid('run'),
          schemaVersion: '1',
          mappingVersion: '1',
          semantics: 'complete_snapshot',
          expectedRows: 0,
          expectedBytes: 0,
        };
      await writeFile(join(directory!, id + '.manifest.json'), JSON.stringify(manifest), {
        mode: 0o600,
      });
      await writeFile(join(directory!, id + '.ndjson'), data, { mode: 0o600 });
      return id;
    }
    return {
      db,
      observations,
      get observationsTruncated() {
        return observationsTruncated;
      },
      server: listener,
      ownerIdentity,
      services,
      notices,
      contacts,
      delivery,
      privacy,
      journal,
      inbox,
      providerCalls: () => providerCalls,
      syntheticMail,
      objectsData,
      session,
      call,
      staff,
      report,
      artifact,
      async cleanup() {
        try {
          await listener.close();
        } finally {
          try {
            await removeOwnedDirectory(directory!);
          } finally {
            await db.cleanup();
          }
        }
      },
    };
  } catch (error) {
    await server?.close();
    if (directory && resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tt-http-operations-'))
      await rm(directory, { recursive: true, force: true });
    await db.cleanup();
    throw error;
  }
}

async function removeOwnedDirectory(directory: string) {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tt-http-operations-'))
    throw Error('Unexpected cleanup');
  await rm(directory, { recursive: true, force: true });
}
