import { createDeliveryFiles } from '../../../packages/integrations/src/delivery-files.ts';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { vi } from 'vitest';
import type { pilotFixture } from './pilot-services.ts';
import { composePartnerServices, uuid, value, time, rev } from './compose-partner-services.ts';
import { success } from '../catalog/database.ts';
import { createPilotRepository } from '../../../packages/db/src/repositories/pilot-delivery.ts';
import { createPilotDeliveryServices } from '../../../packages/application/src/partners/pilot-delivery.ts';
import { createPilotRenderer } from '../../../packages/integrations/src/pilot-renderer.ts';
import { createFixtureReportRenderer } from '../../../packages/integrations/src/delivery-renderer.ts';
import { createContactServiceRepository } from '../../../packages/db/src/repositories/contact-services.ts';
import type { ContactEncryption } from '../../../packages/application/src/ports/contact-services.ts';
import type {
  PilotPolicy,
  PilotProvider,
  PilotRequest,
  PilotContext,
} from '../../../packages/application/src/ports/pilot-delivery.ts';
export async function composePilot(f: Awaited<ReturnType<typeof pilotFixture>>) {
  const partners = await composePartnerServices(f),
    scope = f.pilotAdapter(),
    repository = createPilotRepository(scope),
    key = randomBytes(32);
  const encryption: ContactEncryption = {
    async encrypt(bytes, purpose, id) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(purpose + '\0' + id));
      const body = Buffer.concat([c.update(bytes), c.final()]);
      return {
        keyVersion: 'local-aes-double',
        hex: Buffer.concat([iv, c.getAuthTag(), body]).toString('hex'),
      };
    },
    async decrypt(box, purpose, id) {
      const b = Buffer.from(box.hex, 'hex'),
        d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAAD(Buffer.from(purpose + '\0' + id));
      d.setAuthTag(b.subarray(12, 28));
      return new Uint8Array(Buffer.concat([d.update(b.subarray(28)), d.final()]));
    },
  };
  const offersNotice = await f.notice('offers'),
    reportNotice = await f.notice('report'),
    policy: PilotPolicy = {
      version: 'local-pilot-v1',
      consentPolicy: 'synthetic',
      offersNotice,
      reportNotice,
      timeZone: 'UTC',
      provider: 'fixture',
      fixture: true,
      creditUnits: 1n,
    };
  const provider = {
    name: 'fixture',
    fixture: true,
    send: vi.fn<PilotProvider['send']>(async () => ({
      outcome: 'accepted',
      messageId: uuid('message'),
    })),
  };
  const hooks: { render?: (c: PilotContext) => Promise<void> } = {};
  const base = createPilotRenderer({
    report: {
      ...createFixtureReportRenderer('a'.repeat(64)),
      async render(document) {
        const mail = await createFixtureReportRenderer('a'.repeat(64)).render(document);
        return { ...mail, html: '<!doctype html><html><body>' + mail.html + '</body></html>' };
      },
    },
    fixture: true,
    preferences: (id) => 'https://preview.example.invalid/unsubscribe?cap=' + id,
    senderName: 'Synthetic Tires',
    postalAddress: ['SYNTHETIC ADDRESS'],
  });
  const renderer = {
    fixture: true,
    render: vi.fn(async (...args: Parameters<typeof base.render>) => {
      await hooks.render?.(args[0]);
      return base.render(...args);
    }),
  };
  const privateBytes = new Map<string, Uint8Array>();
  const files = createDeliveryFiles({
    scope: f.assetAdapter,
    bucket: 'synthetic-pilot-private',
    keyVersion: 'local-aes-double',
    objects: {
      async put(a, b) {
        privateBytes.set(a.id, new Uint8Array(b));
        return 'synthetic-v1';
      },
      async get(a) {
        return new Uint8Array(privateBytes.get(a.id)!);
      },
      async erase(a) {
        privateBytes.delete(a.id);
      },
    },
  });
  const deps = {
      uow: scope.unitOfWork,
      repository,
      policy,
      crypto: partners.crypto,
      encryption,
      files,
      renderer,
      provider,
    },
    service = createPilotDeliveryServices(deps);
  const catalog = await f.run(),
    model = uuid('tire_model'),
    sku = uuid('tire_sku');
  await f.stage(catalog, 'tireModels', [
    {
      id: model,
      sourceRecordKey: model,
      brand: 'Synthetic',
      model: 'Local',
      category: 'touring',
      seasonalClass: 'all_season',
    },
  ]);
  await f.stage(
    catalog,
    'tireSkus',
    [
      {
        id: sku,
        sourceRecordKey: sku,
        modelId: model,
        manufacturerSku: 'LOCAL',
        sizeCode: '225/55R17',
        construction: 'radial',
        rimInches: '17',
        loadIndex: 100,
        speedRank: 10,
        loadRange: null,
        xl: false,
        runFlat: false,
        status: 'active',
      },
    ],
    2n,
  );
  const frontPublication = await f.candidate(catalog, 2n);
  await success(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, frontPublication));
  const rearCatalog = await f.run(),
    rearModel = uuid('tire_model'),
    rearSku = uuid('tire_sku'),
    rearLicense = uuid('license');
  await f.admin.query(
    'INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at) SELECT $1,provider_id,market,rights,effective_at,reviewed_at FROM app.data_licenses WHERE id=$2',
    [rearLicense, f.license],
  );
  await f.admin.query(
    "UPDATE app.dataset_versions SET license_id=$2 WHERE id=$1 AND status='staging'",
    [rearCatalog.datasetId, rearLicense],
  );
  await f.stage(rearCatalog, 'tireModels', [
    {
      id: rearModel,
      sourceRecordKey: rearModel,
      brand: 'Synthetic',
      model: 'Local Rear',
      category: 'touring',
      seasonalClass: 'all_season',
    },
  ]);
  await f.stage(
    rearCatalog,
    'tireSkus',
    [
      {
        id: rearSku,
        sourceRecordKey: rearSku,
        modelId: rearModel,
        manufacturerSku: 'LOCAL-REAR',
        sizeCode: '245/50R18',
        construction: 'radial',
        rimInches: '18',
        loadIndex: 100,
        speedRank: 10,
        loadRange: null,
        xl: false,
        runFlat: false,
        status: 'active',
      },
    ],
    2n,
  );
  const publication = {
    ...(await f.candidate(rearCatalog, 2n, [
      { key: 'catalog', datasetId: catalog.datasetId },
      { key: 'rear-catalog', datasetId: rearCatalog.datasetId },
    ])),
    expectedHead: { bundleId: frontPublication.bundleId, revision: rev() },
  };
  await success(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, publication));
  const contacts = createContactServiceRepository(f.scope, ['test-hmac-v1']);
  async function consent(
    person: ReturnType<typeof uuid<'subject'>>,
    purpose: 'report' | 'offers',
    target: string,
    notice: ReturnType<typeof uuid<'notice'>>,
    action: 'grant' | 'confirm' | 'withdraw',
  ) {
    return success(f.scope.unitOfWork, async (tx) => {
      const p = await f.privacy.permission(tx, person, purpose, target);
      return f.privacy.consent(tx, {
        id: uuid('consent_event'),
        subjectId: person,
        purpose,
        scope: target,
        expectedRevision: p.revision,
        action,
        noticeId: notice,
        policyVersion: 'synthetic',
        method: 'synthetic',
        expiresAt: null,
      });
    });
  }
  async function message(
    options: {
      contact?: Awaited<ReturnType<typeof f.contact>>;
      report?: boolean;
      due?: boolean;
      offers?: boolean;
      adult?: boolean;
      pendingReport?: boolean;
      quantity?: number;
      axles?: 'staggered' | 'single-absent' | 'single-null';
    } = {},
  ) {
    const owner = await f.owner(),
      contact = options.contact ?? (await f.contact()),
      item = uuid('plan');
    const box = await encryption.encrypt(
      new TextEncoder().encode('synthetic-' + contact.value.id + '@example.invalid'),
      'contact_email',
      contact.value.id,
    );
    await success(f.scope.unitOfWork, async (tx) => {
      const c = (await f.privacy.contact(tx, contact.value.id))!;
      const rotated = await f.privacy.rotateContact(tx, c.id, c.revision, box);
      if (!rotated.verifiedAt) await f.privacy.confirmContact(tx, c.id, rotated.revision);
    });
    const output = {
      result: {
        picks: [item],
        decisions: [{ id: item, status: 'eligible', reasons: [], scoreBp: 5000 }],
      },
      evidence: {
        plans: [
          {
            id: item,
            front: { id: sku },
            ...(options.axles === 'single-absent'
              ? {}
              : {
                  rear:
                    options.axles === 'single-null'
                      ? null
                      : { id: options.axles === 'staggered' ? rearSku : sku },
                }),
          },
        ],
      },
      prices: [{ planId: item, quantity: 4, totalMinor: '80000', currency: 'USD' }],
    };
    const report = await f.report(owner.identity, output);
    // A new immutable version uses the actually published synthetic catalog bundle.
    const version = {
      ...report.version,
      version: 2,
      baseVersion: 1,
      bundleId: publication.bundleId,
    };
    await success(f.scope.unitOfWork, (tx) =>
      f.reports.publish(tx, owner.identity, report.head.revision, version, [
        { key: item, skuId: sku, kind: 'picked', rank: 1, snapshot: output.result.decisions[0]! },
      ]),
    );
    const reportScope = `report:${report.head.id}:2`,
      grant = await consent(contact.value.subjectId, 'report', reportScope, reportNotice, 'grant'),
      challenge = uuid('verification');
    await success(f.scope.unitOfWork, (tx) =>
      contacts.createIntent(tx, {
        id: challenge,
        contactId: contact.value.id,
        subjectId: contact.value.subjectId,
        ownerId: owner.identity.subjectId,
        purpose: 'report',
        scope: reportScope,
        noticeId: reportNotice,
        policyVersion: 'synthetic',
        eventId: grant.eventId!,
        key: { keyVersion: 'test-hmac-v1', digest: partners.crypto.digest(challenge) },
        expiresAt: time(86400000),
      }),
    );
    const permission = options.pendingReport
      ? grant
      : await consent(contact.value.subjectId, 'report', reportScope, reportNotice, 'confirm');
    if (options.offers !== false) {
      const existing = await success(f.scope.unitOfWork, (tx) =>
        f.privacy.permission(tx, contact.value.subjectId, 'offers', 'offers'),
      );
      if (existing.status !== 'confirmed') {
        await consent(contact.value.subjectId, 'offers', 'offers', offersNotice, 'grant');
        await consent(contact.value.subjectId, 'offers', 'offers', offersNotice, 'confirm');
      }
    }
    const send = uuid('send'),
      template = await f.template(options.report === false ? 'offers' : 'report'),
      document = {
        schemaVersion: 1,
        fixture: true,
        locale: 'en-US',
        market: 'US',
        sender: 'Synthetic <synthetic@example.invalid>',
        policyVersion: policy.version,
        report: { ...output, reportId: report.head.id, version: 2 },
        comparison: null,
        template: { id: template, version: '1', rendererHash: 'a'.repeat(64) },
        learning: [],
      };
    await f.admin.query(
      `INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,report_id,report_version,template_id,created_at,updated_at,send_after,cancel_deadline,provider_key,provider,requested_purposes,dispatch_policy_version)
  VALUES($1,$2,$3,$4,$5,2,$6,statement_timestamp()-interval '2 minutes',clock_timestamp(),CASE WHEN $7 THEN statement_timestamp()-interval '1 second' ELSE statement_timestamp()+interval '1 minute' END,CASE WHEN $7 THEN statement_timestamp()-interval '1 second' ELSE statement_timestamp()+interval '1 minute' END,$8,'fixture',$9::jsonb,$10)`,
      [
        send,
        options.report === false ? 'offers' : 'report',
        contact.value.id,
        owner.identity.subjectId,
        report.head.id,
        template,
        options.due !== false,
        'pilot:' + send,
        JSON.stringify(options.report === false ? ['offers'] : ['report', 'offers']),
        policy.version,
      ],
    );
    await f.admin.query(
      'INSERT INTO email.delivery_snapshots(send_id,verification_id,permission_event_id,document) VALUES($1,$2,$3,$4::jsonb)',
      [send, challenge, permission.eventId, JSON.stringify(document)],
    );
    const request: PilotRequest = {
      includeOffers: options.offers !== false,
      itemKey: item,
      adult: options.adult !== false,
      quantity: options.quantity ?? 4,
      region: 'CA',
      postal: '90001',
      latitude: 34,
      longitude: -118,
    };
    value(await service.request([owner.token], send, request));
    return { send, owner, contact, report, reportScope, request, document, challenge };
  }
  async function offer(
    mode: 'shared' | 'unique' | 'generated' = 'shared',
    limit = 100n,
    daySeconds: number | null = null,
  ) {
    const company = await partners.company(),
      id = await partners.published(company.org, company.handle);
    let pool = uuid('coupon_pool');
    if (mode === 'unique') {
      const imported = await partners.csvPool(
        company.org,
        company.handle,
        id,
        'code\nLOCAL-UNIQUE',
      );
      pool = imported.pool;
      const lease = value(await partners.consumer.lease(imported.queued.jobId));
      if (!lease) throw Error('Synthetic import lease required');
      value(await partners.consumer.process(lease));
    } else
      value(
        await partners.coupons.pool(company.handle, company.org, {
          id: pool,
          offerId: id,
          version: 1,
          mode,
          assetId: null,
          prefix: mode === 'generated' ? 'LOCAL' : null,
          sharedCode: mode === 'shared' ? 'LOCAL-SHARED' : null,
        }),
      );
    for (const kind of ['total', 'day', 'budget'])
      await f.admin.query(
        "INSERT INTO partners.offer_cap_windows(org_id,offer_id,kind,policy_version,window_start,window_end,limit_units,currency_code) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 minute',clock_timestamp()+CASE WHEN $3='day' AND $7::integer IS NOT NULL THEN make_interval(secs=>$7) ELSE interval '1 day' END,$5,$6)",
        [
          company.org,
          id,
          kind,
          policy.version,
          limit.toString(),
          kind === 'budget' ? 'USD' : null,
          daySeconds,
        ],
      );
    return { ...company, id, pool };
  }
  const fresh = () => {
    const adapter = f.pilotAdapter();
    return createPilotDeliveryServices({
      ...deps,
      uow: adapter.unitOfWork,
      repository: createPilotRepository(adapter),
    });
  };
  return {
    service,
    repository,
    scope,
    deps,
    policy,
    provider,
    renderer,
    encryption,
    hooks,
    partners,
    message,
    offer,
    consent,
    fresh,
    catalog,
    publication,
    sku,
    model,
    rearSku,
    rearLicense,
  };
}
