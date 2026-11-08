import pg from 'pg';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
import { vi } from 'vitest';
import { uid, time } from '../private/database.ts';
import { createContactCrypto } from '../../../packages/integrations/src/contact-crypto.ts';
import { createContactRuntime } from '../../../packages/integrations/src/contact-runtime.ts';
import { createDeliveryWorkRepository } from '../../../packages/db/src/repositories/delivery-work.ts';
import {
  createDeliveryFiles,
  deliveryChecksum,
} from '../../../packages/integrations/src/delivery-files.ts';
import { createFixtureReportRenderer } from '../../../packages/integrations/src/delivery-renderer.ts';
import type {
  ContactPolicy,
  ContactRequest,
} from '../../../packages/application/src/ports/contact-services.ts';
import type { PrivateObjects } from '../../../packages/application/src/ports/assets.ts';
import type { MailProvider } from '../../../packages/application/src/ports/delivery-services.ts';
import type { ReportRenderer } from '../../../packages/application/src/ports/delivery-services.ts';
import type { JsonObject } from '../../../packages/application/src/ports/catalog-records.ts';
import { type Result } from '../../../packages/domain/src/values/core.ts';
import type { analysisLifecycleFixture } from './analysis-lifecycle.ts';
import { createAnalysisDeliveryServices } from '../../../packages/application/src/analysis/analysis-delivery.ts';
import { createAnalysisDeliveryRepository } from '../../../packages/db/src/repositories/analysis-lifecycle.ts';
import { createAnalysisReportRenderer } from '../../../packages/integrations/src/analysis-delivery-renderer.ts';
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
function output(f: Awaited<ReturnType<typeof analysisLifecycleFixture>>): JsonObject {
  return {
    purpose: 'technical_evaluation',
    issuanceAuthorized: false,
    result: {
      asOf: time(),
      versions: {
        engine: 'fixture',
        schema: 1,
        policy: 'fixture',
        scoring: 'fixture',
        bundleId: f.bundleId,
        datasets: [],
        ruleVersionId: f.ruleId,
      },
      picks: [],
      decisions: [],
    },
    prices: [],
    products: [],
  };
}
export async function composeAnalysisDelivery(
  f: Awaited<ReturnType<typeof analysisLifecycleFixture>>,
  reportOutput: JsonObject = output(f),
  existing?: { owner: Awaited<ReturnType<typeof f.owner>>; report: string },
  options?: { baseRenderer: ReportRenderer },
) {
  const crypto = createContactCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(4) },
    { l1: new Uint8Array(32).fill(5) },
    new Uint8Array(32).fill(6),
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
    (notices as Record<string, string>)[purpose] = await f.notice(purpose);
  const contactPolicy = { version: 'synthetic', notices },
    encrypted = new Map<string, Uint8Array>();
  const encryption = {
    encrypt: vi.fn(async (bytes: Uint8Array, purpose: string, id: string) => {
      encrypted.set(purpose + id, bytes);
      return { keyVersion: 'fixture', hex: deliveryChecksum(bytes) };
    }),
    decrypt: vi.fn(async (_e: unknown, purpose: string, id: string) =>
      encrypted.get(purpose + id)!,
    ),
  };
  const contacts = await createContactRuntime({
    scope: f.scope,
    crypto,
    encryption,
    policy: contactPolicy,
    now: () => time(),
  });
  const templateId = await f.template(),
    hash = (
      await f.admin.query('SELECT renderer_hash FROM email.template_versions WHERE id=$1', [
        templateId,
      ])
    ).rows[0].renderer_hash;
  const fixture = createAnalysisReportRenderer(
      options?.baseRenderer ?? createFixtureReportRenderer('d'.repeat(64)),
      hash,
    ),
    renderer = { ...fixture, render: vi.fn(fixture.render) };
  const objectsData = new Map<string, Uint8Array>();
  const objects: PrivateObjects = {
    put: vi.fn(async (a, b) => {
      const old = objectsData.get(a.id);
      if (old && deliveryChecksum(old) !== deliveryChecksum(b)) throw Error('Conflicting bytes');
      objectsData.set(a.id, new Uint8Array(b));
      return 'fixture-v1';
    }),
    get: vi.fn(async (a) => new Uint8Array(objectsData.get(a.id)!)),
    erase: async (a) => {
      objectsData.delete(a.id);
    },
  };
  const pool = new pg.Pool({ connectionString: f.connectionUrl('tt_asset_runtime'), max: 2 }),
    assetScope = createTransactions(pool),
    files = createDeliveryFiles({
      scope: assetScope,
      objects,
      bucket: 'fixture-private',
      keyVersion: 'fixture-kms',
    });
  const messageId = uid('message'),
    provider = {
      name: 'fixture' as const,
      fixture: true,
      send: vi.fn<MailProvider['send']>(async () => ({
        outcome: 'accepted' as 'accepted' | 'uncertain' | 'definitive_rejection',
        messageId: messageId as string | null,
      })),
    };
  const policy = {
    version: 'fixture-v1',
    sender: 'Tires & Tread <fixture@example.invalid>',
    templateId,
    fixture: true,
  };
  const work = createDeliveryWorkRepository(f.scope, contactPolicy, crypto.lookupVersions),
    deps = {
      uow: f.scope.unitOfWork,
      owners: f.owners,
      reports: f.reports,
      contacts,
      delivery: f.delivery,
      work,
      reliability: f.reliability,
      crypto,
      encryption,
      files,
      renderer,
      provider,
      policy,
      checksum: deliveryChecksum,
      now: () => time(),
    };
  const service = createAnalysisDeliveryServices({
      ...deps,
      analysis: createAnalysisDeliveryRepository(f.scope),
    }),
    owner = existing?.owner ?? (await f.owner()),
    report = existing
      ? {
          head: {
            id: existing.report as import('../../../packages/domain/src/values/core.ts').Id<'report'>,
          },
        }
      : await f.report(owner.identity, reportOutput),
    email = uid('email') + '@example.invalid';
  const input: ContactRequest = {
    email,
    report: { id: report.head.id, version: 1 },
    offers: false,
    notices: { report: notices.report },
  };
  async function request(
    command = uid('command'),
    body = {
      ...input,
      analysis: {
        attachmentRevision: null as string | null,
        fallback: 'unavailable' as string | null,
      },
    },
  ) {
    return value(await service.request([owner.token], command, body));
  }
  async function due(id: string) {
    // Fixture-only clock fast-forward. Production identity guards are re-enabled before any service call.
    await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
    try {
      await f.admin.query(
        "UPDATE email.email_sends SET created_at=now()-interval '2 minutes',cancel_deadline=now()-interval '1 minute',send_after=now()-interval '1 minute' WHERE id=$1",
        [id],
      );
    } finally {
      await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
    }
    await f.admin.query(
      "UPDATE email.delivery_work SET next_attempt_at=now()-interval '1 second' WHERE send_id=$1",
      [id],
    );
  }
  async function row(id: string) {
    return (
      await f.admin.query(
        'SELECT s.*,d.document,w.first_attempt_at,w.failures,w.payload_asset_id AS frozen_asset,w.pdf_asset_id,w.lease_token FROM email.email_sends s JOIN email.delivery_snapshots d ON d.send_id=s.id JOIN email.delivery_work w ON w.send_id=s.id WHERE s.id=$1',
        [id],
      )
    ).rows[0];
  }
  return {
    cleanup: () => pool.end(),
    deps,
    service,
    work,
    owner,
    report,
    input,
    email,
    request,
    due,
    row,
    provider,
    renderer,
    contacts,
    encryption,
    encrypted,
    objects,
    objectsData,
    files,
    policy,
    crypto,
    contactPolicy,
    assetScope,
  };
}
