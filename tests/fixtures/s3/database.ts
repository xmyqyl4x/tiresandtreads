import { vi } from 'vitest';
import { privateFixture, uid, time } from '../private/database.ts';
import { engineFixture } from '../engine/base.ts';
import { ok, type Result } from '../../../packages/domain/src/values/core.ts';
import { createReportServices } from '../../../packages/application/src/services/reports.ts';
import { createReportAccessRepository } from '../../../packages/db/src/repositories/report-services.ts';
import { createCommandRepository } from '../../../packages/db/src/repositories/jobs.ts';
import { createReportCrypto } from '../../../packages/integrations/src/report-crypto.ts';
import { createContactCrypto } from '../../../packages/integrations/src/contact-crypto.ts';
import { createContactRuntime } from '../../../packages/integrations/src/contact-runtime.ts';
import { createDeliveryRuntime } from '../../../packages/integrations/src/delivery-runtime.ts';
import { createPrivacyRuntime } from '../../../packages/integrations/src/privacy-runtime.ts';
import { createPrivacyCrypto } from '../../../packages/integrations/src/privacy-crypto.ts';
import { createMailEventsRuntime } from '../../../packages/integrations/src/mail-events-runtime.ts';
import { createFixtureReportRenderer } from '../../../packages/integrations/src/delivery-renderer.ts';
import { deliveryChecksum } from '../../../packages/integrations/src/delivery-files.ts';
import type { ContactPolicy } from '../../../packages/application/src/ports/contact-services.ts';
import type { PrivateObjects } from '../../../packages/application/src/ports/assets.ts';
import type { SignedPrivacyRecord } from '../../../packages/application/src/ports/privacy-services.ts';
export { privateFixture, uid, time };
export function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
export async function s3Fixture(f: Awaited<ReturnType<typeof privateFixture>>) {
  const encrypted = new Map<string, Uint8Array>(),
    bytes = new Map<string, Uint8Array>(),
    journal = new Map<string, SignedPrivacyRecord>();
  const encryption = {
    async encrypt(b: Uint8Array, purpose: string, id: string) {
      encrypted.set(purpose + id, new Uint8Array(b));
      return { keyVersion: 'fixture', hex: deliveryChecksum(b) };
    },
    async decrypt(_envelope: unknown, purpose: string, id: string) {
      const b = encrypted.get(purpose + id);
      if (!b) throw Error('Fixture envelope missing');
      return new Uint8Array(b);
    },
  };
  const crypto = createContactCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(4) },
    { 'test-hmac-v1': new Uint8Array(32).fill(5) },
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
    contacts = await createContactRuntime({
      scope: f.scope,
      crypto,
      encryption,
      policy: contactPolicy,
      now: () => time(),
    });
  const reportCrypto = createReportCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(41) },
    new Uint8Array(32).fill(87),
  );
  const reports = createReportServices({
    uow: f.scope.unitOfWork,
    owners: f.owners,
    reports: f.reports,
    capabilities: f.caps,
    access: createReportAccessRepository(f.scope),
    commands: createCommandRepository(f.scope),
    crypto: reportCrypto,
    encryption,
    now: () => time(),
    evidence: {
      async prepare(_input, asOf) {
        const e = engineFixture();
        e.snapshot.bundleId = f.bundleId;
        e.snapshot.policy.id = f.ruleId;
        e.snapshot.asOf = asOf;
        e.snapshot.recall.checkedAt = asOf;
        return ok({ snapshot: e.snapshot, prices: [], products: [] });
      },
      current: async () => ok(true),
      overlay: async (_version, asOf) =>
        ok({ checkedAt: asOf, status: 'review_required', matched: [], unresolved: true }),
    },
  });
  const objects: PrivateObjects = {
    async put(a, b) {
      bytes.set(a.id, new Uint8Array(b));
      return 'fixture-v1';
    },
    async get(a) {
      const b = bytes.get(a.id);
      if (!b) throw Error('Fixture object absent');
      return new Uint8Array(b);
    },
    async erase(a) {
      bytes.delete(a.id);
    },
  };
  const template = await f.template(),
    hash = (
      await f.admin.query('SELECT renderer_hash FROM email.template_versions WHERE id=$1', [
        template,
      ])
    ).rows[0].renderer_hash;
  const send = vi.fn(async () => ({ outcome: 'accepted' as const, messageId: uid('message') }));
  const delivery = await createDeliveryRuntime({
    privateScope: f.scope,
    assetScope: f.adapter('tt_asset_runtime'),
    crypto,
    encryption,
    contactPolicy,
    policy: {
      version: 'fixture-v1',
      sender: 'Fixture <fixture@example.invalid>',
      templateId: template,
      fixture: true,
    },
    renderer: createFixtureReportRenderer(hash),
    provider: { name: 'fixture', fixture: true, send },
    objects,
    bucket: 'fixture-private',
    keyVersion: 'fixture-kms',
    now: () => time(),
  });
  const privacy = await createPrivacyRuntime({
    scope: f.adapter('tt_privacy_runtime'),
    crypto: createPrivacyCrypto('p1', { p1: new Uint8Array(32).fill(13) }),
    contacts: crypto,
    encryption,
    policyVersion: 's3-fixture',
    assetBucket: 'fixture-private',
    assetKeyVersions: ['fixture-kms'],
    now: () => time(),
    journal: {
      async append(k, r) {
        journal.set(k, r);
      },
    },
    objects,
    mail: { verify: async () => {}, erase: async () => 'not_stored' },
  });
  const mail = await createMailEventsRuntime({
    scope: f.scope,
    lookupVersions: crypto.lookupVersions,
    retrieve: async () => null,
  });
  return {
    reports,
    reportCrypto,
    contacts,
    crypto,
    contactPolicy,
    privacy,
    mail,
    delivery,
    send,
    journal,
  };
}
