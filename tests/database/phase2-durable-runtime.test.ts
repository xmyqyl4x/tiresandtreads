import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { deriveLocalPhase2Keys } from '../../packages/integrations/src/local-encrypted-objects.ts';
import { seedDurableCouponImport } from '../fixtures/phase2/durable-coupon.ts';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { durableHostOptions } from '../fixtures/phase2/durable-host.ts';
import { createPhase2LocalHost } from '../../packages/integrations/src/phase2-local-host.ts';
import { composeDurablePilot } from '../fixtures/phase2/durable-pilot.ts';
import { createLocalEnvelopeEncryption } from '../../packages/integrations/src/local-envelope-encryption.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import { startDurableChild } from '../fixtures/phase2/durable-child-control.ts';
import { it, expect } from 'vitest';
import { durablePhase2Fixture } from '../fixtures/phase2/durable-fixture.ts';
import { value, uuid, rev } from '../fixtures/phase2/compose-partner-services.ts';
import { openDurableHost } from '../fixtures/phase2/durable-host.ts';
import {
  createLocalEncryptedObjects,
  readLocalPhase2Material,
} from '../../packages/integrations/src/local-encrypted-objects.ts';
it('reconstructs the complete local service composition, retained encrypted assets/keys and pending SQL jobs', async () => {
  const fixture = await durablePhase2Fixture(),
    { f, r, g, csv, configFile, materialFile, objectsDirectory } = fixture;
  let host: Awaited<ReturnType<typeof openDurableHost>> | undefined;
  try {
    host = await openDurableHost(configFile);
    expect(await host.readiness()).toBe(true);
    expect(host.metadata.connections).toBe(11);
    expect(host.metadata.activation).toBe(false);
    expect(Object.keys(host.services).sort()).toEqual([
      'coupons',
      'csv',
      'delivery',
      'erasure',
      'generic',
      'insights',
      'offers',
      'onboarding',
      'operations',
      'photo',
      'pilot',
      'privacy',
      'report',
      'review',
    ]);
    const { h, org, source, input, queued } = await seedDurableCouponImport(fixture, host);
    const e = await r.example();
    await f.admin.query(
      "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,100000,10000,1000,2,'active',$2 FROM app.ai_policy_versions WHERE id=$1",
      [e.policy, f.staff],
    );
    const request = value(await host.services.report.request(e.keys, e.input));
    expect(request.state).toBe('pending');
    const generic = await g.example(),
      genericRequest = value(await host.services.generic.read(generic.input));
    const before = (
      await f.admin.query(
        'SELECT output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [e.report],
      )
    ).rows;
    await host.shutdown();
    expect(await host.readiness()).toBe(false);
    await expect(host.services.report.request(e.keys, e.input)).rejects.toThrow();
    const originalMaterial = await readFile(materialFile),
      materialJson = JSON.parse(originalMaterial.toString('utf8'));
    try {
      await writeFile(materialFile, '{}');
      await expect(openDurableHost(configFile)).rejects.toThrow();
      await writeFile(
        materialFile,
        JSON.stringify({ ...materialJson, keys: { v1: '9'.repeat(64) } }),
      );
      await expect(openDurableHost(configFile)).rejects.toThrow();
    } finally {
      await writeFile(materialFile, originalMaterial);
    }
    const profile = fixture.config.policy;
    try {
      fixture.config.policy = { ...profile, assetKeyVersion: 'v2' };
      await fixture.save();
      await writeFile(
        materialFile,
        JSON.stringify({
          ...materialJson,
          current: 'v2',
          keys: { ...materialJson.keys, v2: '8'.repeat(64) },
        }),
      );
      await expect(openDurableHost(configFile)).rejects.toThrow();
    } finally {
      fixture.config.policy = profile;
      await fixture.save();
      await writeFile(materialFile, originalMaterial);
    }
    const wrongRole = await durableHostOptions(configFile),
      badUrl = new URL(wrongRole.urls.partner);
    badUrl.username = 'tt_app_migrator';
    await expect(
      createPhase2LocalHost({
        ...wrongRole,
        urls: { ...wrongRole.urls, partner: badUrl.toString() },
      }),
    ).rejects.toThrow('database refused');
    await expect(
      createPhase2LocalHost({ ...wrongRole, otherConnections: 100, reserve: 100 }),
    ).rejects.toThrow();
    await expect(
      createPhase2LocalHost({ ...wrongRole, mode: 'disabled' as never }),
    ).rejects.toThrow('configuration refused');
    const probed = (
      await f.admin.query(
        "SELECT id FROM app.object_assets WHERE bucket=$1 AND state='ready' ORDER BY key_version,id LIMIT 1",
        [fixture.config.policy.assetBucket],
      )
    ).rows[0]!.id;
    const missing = join(objectsDirectory, probed + '.sealed'),
      held = join(fixture.root, 'held.sealed');
    await rename(missing, held);
    try {
      const unexpected = await openDurableHost(configFile).catch(() => null);
      await unexpected?.shutdown();
      expect(unexpected).toBeNull();
    } finally {
      await rename(held, missing);
    }
    host = await openDurableHost(configFile);
    expect(await host.readiness()).toBe(true);
    expect(value(await host.services.coupons.queue(h, org, input)).id).toBe(queued.id);
    expect(value(await host.services.report.request(e.keys, e.input)).id).toBe(request.id);
    const tick = await host.tick();
    expect(tick.attemptedJobs).toBeGreaterThanOrEqual(3);
    expect(value(await host.services.coupons.status(h, org, queued.id))).toMatchObject({
      state: 'ready',
      accepted: 2,
      duplicates: 1,
    });
    expect(value(await host.services.report.status(e.keys, request.id)).state).toBe('available');
    expect(value(await host.services.generic.read(generic.input)).state).toBe('available');
    expect(
      (
        await f.admin.query(
          'SELECT output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
          [e.report],
        )
      ).rows,
    ).toEqual(before);
    const location = (
      await f.admin.query(
        'SELECT object_version,sha256,size_bytes::int,mime_type FROM app.object_assets WHERE id=$1',
        [source.id],
      )
    ).rows[0]!;
    const objects = await createLocalEncryptedObjects(
      objectsDirectory,
      await readLocalPhase2Material(materialFile),
    );
    expect(
      new TextDecoder().decode(
        await objects.get({
          id: source.id,
          revision: rev(),
          key: 'assets/' + source.id,
          mime: location.mime_type,
          sha256: location.sha256,
          size: location.size_bytes,
          version: location.object_version,
          state: 'ready',
        }),
      ),
    ).toContain('RETAINED1');
    const template = value(
      await host.services.csv.createTemplate(csv.uploader, {
        mapping: 'tire_models_v1',
        version: 1,
        maxBytes: 16777216,
        maxRows: 100000,
        state: 'active',
      }),
    );
    expect(template.state).toBe('active');
    expect(value(await host.services.erasure.pending())).toEqual([]);
    console.log(
      'P2_DURABLE_RUNTIME_EVIDENCE ' +
        JSON.stringify({
          actualPostgreSQL: true,
          services: 14,
          restrictedPools: 11,
          actualMigrationCount: (
            await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')
          ).rows[0]!.n,
          retainedEncryptedObjects: true,
          retainedKeyMaterial: true,
          pendingJobsRecovered: true,
          sameCommandReconciliation: true,
          immutableReportPreserved: true,
          serviceReconstruction: true,
          startupRefusals: 7,
          actualChildRestart: false,
          independentlyDurableCustody: false,
          defaultMigrationsPromoted: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
    void genericRequest;
  } finally {
    await host?.shutdown();
    await fixture.cleanup();
  }
}, 180000);

it('recovers an owned worker cold restart without replaying an uncertain provider attempt or releasing its cost hold', async () => {
  const fixture = await durablePhase2Fixture(),
    { f, p, r, g, configFile, config, save } = fixture;
  let host: Awaited<ReturnType<typeof openDurableHost>> | undefined,
    child: ReturnType<typeof startDurableChild> | undefined;
  try {
    const h = p.session();
    await save();
    host = await openDurableHost(configFile);
    const org = value(
      await host.services.onboarding.register(h, {
        key: uuid('command'),
        legalName: 'Restart synthetic retailer',
        market: 'US',
      }),
    ).id;
    value(
      await host.services.onboarding.upload(
        h,
        org,
        'agreement',
        'application/json',
        p.docs.pilot_terms,
      ),
    );
    const e = await r.example();
    await f.admin.query(
      "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,100000,10000,1000,2,'active',$2 FROM app.ai_policy_versions WHERE id=$1",
      [e.policy, f.staff],
    );
    const pending = value(await host.services.report.request(e.keys, e.input)),
      generic = await g.example(),
      genericRequest = value(await host.services.generic.read(generic.input));
    const privacyOwner = await f.owner(),
      privacyRequestedAt = Date.now(),
      privacyRequest = value(
        await host.services.privacy.requestOwner(
          [privacyOwner.token],
          'delete',
          'synthetic',
          'restart-delete-' + uuid('command'),
        ),
      );
    await host.shutdown();
    config.holdReport = true;
    await save();
    child = startDurableChild(configFile);
    const first = await child.wait('ready');
    expect(typeof first.pid).toBe('number');
    expect(first.metadata).toMatchObject({ verifiedObjectKeyVersions: 1, connections: 11 });
    child.command('tick');
    await child.wait('provider-started');
    const started = (
      await f.admin.query('SELECT id,state FROM app.ai_attempts WHERE request_id=$1', [pending.id])
    ).rows;
    expect(started).toHaveLength(1);
    expect(started[0]!.state).toBe('started');
    const held = (
      await f.admin.query(
        'SELECT reserved_minor::text,state FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY id',
        [started[0]!.id],
      )
    ).rows;
    expect(held).toHaveLength(3);
    expect(held.every((x) => x.state === 'reserved')).toBe(true);
    expect(child.child.kill('SIGKILL')).toBe(true);
    expect((await child.exit).signal).toBe('SIGKILL');
    child = undefined;
    // Actual lease time passes; no private lifecycle mutation or production clock override.
    await new Promise((resolve) => setTimeout(resolve, 31000));
    child = startDurableChild(configFile);
    const second = await child.wait('ready');
    expect(second.pid).not.toBe(first.pid);
    expect(second.metadata).toMatchObject({ verifiedObjectKeyVersions: 1 });
    child.command('tick');
    await child.wait('ticked');
    expect(child.events.some((e) => e.state === 'provider-started')).toBe(false);
    expect(
      (await f.admin.query('SELECT id FROM app.ai_attempts WHERE request_id=$1', [pending.id]))
        .rows,
    ).toHaveLength(1);
    const retained = (
      await f.admin.query(
        'SELECT reserved_minor::text,state,settled_minor::text FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY id',
        [started[0]!.id],
      )
    ).rows;
    expect(retained.map((x) => x.reserved_minor)).toEqual(held.map((x) => x.reserved_minor));
    expect(
      retained.every(
        (x) => ['reserved', 'uncertain'].includes(x.state) && x.settled_minor === null,
      ),
    ).toBe(true);
    expect(
      (
        await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [
          genericRequest.id,
        ])
      ).rows[0]!.state,
    ).toBe('accepted');
    child.command('stop');
    await child.wait('stopped');
    expect((await child.exit).code).toBe(0);
    child = undefined;
    host = await openDurableHost(configFile);
    const remaining = Math.max(0, 46000 - (Date.now() - privacyRequestedAt));
    if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
    let privacyState = value(await host.services.privacy.status(privacyRequest.proof)).status;
    for (let pass = 0; pass < 20 && privacyState !== 'completed'; pass++) {
      await host.tick();
      privacyState = value(await host.services.privacy.status(privacyRequest.proof)).status;
    }
    expect(privacyState).toBe('completed');
    const replay = value(await host.services.report.request(e.keys, e.input));
    expect(replay.id).toBe(pending.id);
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int n FROM app.ai_report_commands WHERE request_id=$1',
          [pending.id],
        )
      ).rows[0]!.n,
    ).toBe(1);
    console.log(
      'P2_DURABLE_COLD_RESTART_EVIDENCE ' +
        JSON.stringify({
          actualPostgreSQL: true,
          actualChildProcesses: 2,
          ownedAbruptExit: true,
          actualColdRestart: true,
          retainedObjectKeyProbe: true,
          actualLeaseExpiryWait: true,
          pendingGenericRecovered: true,
          p1PrivacyRecoveredAcrossRestart: true,
          uncertainReportNotRedispatched: true,
          costHoldsPreserved: true,
          explicitSameCommandReconciliation: true,
          independentlyDurableCustody: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await child?.cleanup();
    await host?.shutdown();
    await fixture.cleanup();
  }
}, 180000);

it('gives captured pilot sends one worker owner, preserves uncertain frozen bytes and never falls back to P1 dispatch', async () => {
  const fixture = await durablePhase2Fixture(),
    { f, config, configFile, save, materialFile } = fixture;
  let host: Awaited<ReturnType<typeof openDurableHost>> | undefined;
  let largeRenderedPdfChars = 0;
  async function openPilotHost() {
    const options = await durableHostOptions(configFile);
    return createPhase2LocalHost({
      ...options,
      async bind(context) {
        const bound = await options.bind(context),
          renderer = bound.pilot.renderer;
        return {
          ...bound,
          pilot: {
            ...bound.pilot,
            renderer: {
              ...renderer,
              async render(...args: Parameters<typeof renderer.render>) {
                const mail = await renderer.render(...args);
                if (!mail.pdf) throw Error('Synthetic pilot report required');
                const pdf = Buffer.concat([
                  Buffer.from(mail.pdf, 'base64'),
                  Buffer.from('\n% SYNTHETIC LOCAL PADDING ' + 'P'.repeat(1200000) + '\n'),
                ]).toString('base64');
                largeRenderedPdfChars = pdf.length;
                return { ...mail, pdf };
              },
            },
          },
        };
      },
    });
  }
  try {
    const seeded = await composeDurablePilot(f),
      message = await seeded.message({ capture: false, offers: false }),
      material = await readLocalPhase2Material(materialFile),
      encryption = createLocalEnvelopeEncryption(material);
    config.pilotPolicy = { ...seeded.policy, creditUnits: seeded.policy.creditUnits.toString() };
    config.pilotRendererHash = 'a'.repeat(64);
    await save();
    value(
      await f.scope.unitOfWork.run(async (tx) => {
        const contact = await f.privacy.contact(tx, message.contact.value.id);
        if (!contact) throw Error('Missing synthetic contact');
        const bytes = await seeded.encryption.decrypt(
            contact.envelope,
            'contact_email',
            contact.id,
          ),
          box = await encryption.encrypt(bytes, 'contact_email', contact.id);
        await f.privacy.rotateContact(tx, contact.id, contact.revision, box);
        return ok(undefined);
      }),
    );
    // Synthetic fixture contact joins the retained runtime lookup ring; no production key migration is inferred.
    const localContacts = createContactCrypto(
        material.current,
        deriveLocalPhase2Keys(material, 'contact'),
        { local_lookup: material.lookup },
        material.lookup,
      ),
      lookup = localContacts.emailKeys(
        'synthetic-' + message.contact.value.id + '@example.invalid',
      )[0]!;
    await f.admin.query(
      "INSERT INTO privacy.contact_lookups(key_version,email_hmac,contact_id) VALUES($1,decode($2,'hex'),$3)",
      [lookup.keyVersion, lookup.digest, message.contact.value.id],
    );
    host = await openPilotHost();
    value(await host.services.pilot.request([message.owner.token], message.send, message.request));
    // Inject a synthetic stale competing queue only after the existing capture correctly transfers ownership.
    await f.admin.query(
      'INSERT INTO email.delivery_work(send_id,next_attempt_at) VALUES($1,clock_timestamp())',
      [message.send],
    );
    await host.tick();
    expect(largeRenderedPdfChars).toBeGreaterThan(1048576);
    const first = (
      await f.admin.query(
        'SELECT state,payload_hash,payload_asset_id FROM partners.pilot_work WHERE send_id=$1',
        [message.send],
      )
    ).rows[0]!;
    expect(first.state).toBe('uncertain');
    expect(first.payload_asset_id).toBeTruthy();
    expect(
      (
        await f.admin.query(
          'SELECT lease_generation::text,first_attempt_at,failures FROM email.delivery_work WHERE send_id=$1',
          [message.send],
        )
      ).rows[0],
    ).toEqual({ lease_generation: '0', first_attempt_at: null, failures: 0 });
    await host.shutdown();
    host = await openPilotHost();
    await host.tick();
    expect(
      (
        await f.admin.query(
          'SELECT state,payload_hash,payload_asset_id FROM partners.pilot_work WHERE send_id=$1',
          [message.send],
        )
      ).rows[0],
    ).toEqual(first);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM email.send_attempts WHERE send_id=$1', [
          message.send,
        ])
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await f.admin.query(
          'SELECT lease_generation::text FROM email.delivery_work WHERE send_id=$1',
          [message.send],
        )
      ).rows[0]!.lease_generation,
    ).toBe('0');
    console.log(
      'P2_LOCAL_PILOT_OWNERSHIP_EVIDENCE ' +
        JSON.stringify({
          actualPostgreSQL: true,
          composedPilot: true,
          competingP1Queue: true,
          singleRecordedAttempt: true,
          uncertainFrozenBytesPreserved: true,
          p1FallbackRefused: true,
          encryptedPayloadRetained: true,
          largePilotPayloadOverOneMiB: true,
          actualProviderAccepted: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await host?.shutdown();
    await fixture.cleanup();
  }
}, 180000);

it('dispatches bounded synthetic privacy verification notifications and retries pending work after restart', async () => {
  const fixture = await durablePhase2Fixture(),
    { configFile } = fixture,
    calls: Readonly<{ key: string; address: string; proof: string }>[] = [];
  let host: Awaited<ReturnType<typeof openDurableHost>> | undefined,
    failOnce = true;
  async function openNotificationHost() {
    const options = await durableHostOptions(configFile);
    return createPhase2LocalHost({
      ...options,
      async bind(context) {
        const bound = await options.bind(context);
        return {
          ...bound,
          privacy: {
            ...bound.privacy,
            mail: {
              ...bound.privacy.mail,
              async verify(input: Parameters<typeof bound.privacy.mail.verify>[0]) {
                calls.push(input);
                if (failOnce) {
                  failOnce = false;
                  throw Error('Synthetic transient verification failure');
                }
                await bound.privacy.mail.verify(input);
              },
            },
          },
        };
      },
    });
  }
  try {
    host = await openNotificationHost();
    for (let i = 0; i < 5; i++)
      value(
        await host.services.privacy.requestEmail(
          'synthetic-rights-' + i + '@example.invalid',
          'restrict',
          'synthetic',
        ),
      );
    expect(value(await host.services.privacy.notifications(8))).toHaveLength(5);
    expect(value(await host.services.privacy.ready(4))).toEqual([]);
    const first = await host.tick();
    expect(calls).toHaveLength(4);
    expect(first.deferred).toBeGreaterThan(0);
    expect(value(await host.services.privacy.notifications(8))).toHaveLength(2);
    await host.shutdown();
    host = await openNotificationHost();
    await host.tick();
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map((x) => x.key)).size).toBe(5);
    expect(calls.filter((x) => x.key === calls[0]!.key)).toEqual([calls[0], calls[0]]);
    expect(value(await host.services.privacy.notifications(8))).toEqual([]);
    expect(value(await host.services.privacy.confirm(calls[0]!.proof))).toEqual({ verified: true });
    await host.tick();
    expect(calls).toHaveLength(6);
    console.log(
      'P2_LOCAL_PRIVACY_NOTIFICATION_EVIDENCE ' +
        JSON.stringify({
          actualPostgreSQL: true,
          perTickBound: 4,
          syntheticRequests: 5,
          capturedAttempts: 6,
          transientRetry: true,
          retainedProofAfterRestart: true,
          confirmed: true,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await host?.shutdown();
    await fixture.cleanup();
  }
}, 180000);
