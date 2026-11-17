import { createOwnerRepository } from '../../packages/db/src/repositories/owners.ts';
import { createPrivacyRepository } from '../../packages/db/src/repositories/privacy.ts';
import { it, expect } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { durablePhase2Fixture } from '../fixtures/phase2/durable-fixture.ts';
import { durableHostOptions, openDurableHost } from '../fixtures/phase2/durable-host.ts';
import { seedDurableCouponImport } from '../fixtures/phase2/durable-coupon.ts';
import { composePhotoServices } from '../fixtures/phase2/compose-photo-services.ts';
import { repositorySeeds } from '../fixtures/phase2/seed-partner-repositories.ts';
import { value, uuid, time } from '../fixtures/phase2/compose-partner-services.ts';
import {
  createPhase2LocalHost,
  type Phase2LocalScopes,
} from '../../packages/integrations/src/phase2-local-host.ts';
import { composePhase2LocalServices } from '../../packages/integrations/src/phase2-local-services.ts';
import {
  createLocalEncryptedObjects,
  readLocalPhase2Material,
  deriveLocalPhase2Keys,
} from '../../packages/integrations/src/local-encrypted-objects.ts';
import { createLocalEnvelopeEncryption } from '../../packages/integrations/src/local-envelope-encryption.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createFilePrivacyJournal } from '../../packages/integrations/src/privacy-journal.ts';
import { createDeliveryFiles } from '../../packages/integrations/src/delivery-files.ts';
import { createReportRepository } from '../../packages/db/src/repositories/reports.ts';
import { createAssetRepository } from '../../packages/db/src/repositories/assets.ts';
import { createCapabilityRepository } from '../../packages/db/src/repositories/capabilities.ts';
import { createPilotRepository } from '../../packages/db/src/repositories/pilot-delivery.ts';
import { id, revision, instant, ok, type Instant } from '../../packages/domain/src/values/core.ts';
import type { AssetLocation } from '../../packages/application/src/ports/assets.ts';
import type { SignedPrivacyRecord } from '../../packages/application/src/ports/privacy-services.ts';
import {
  withSecurityArchive,
  expectedSecurityRestoreCatalog,
} from '../fixtures/phase2/security-archive.ts';
import { withRestoredRoleScopes } from '../fixtures/phase2/restored-role-scope.ts';
import {
  archivePrivateObjects,
  restorePrivateObjects,
  admitControlledRecoveryReads,
  type ObjectArchive,
  type ParentHeldCheckpoint,
} from '../fixtures/phase2/complete-object-archive.ts';
function location(row: Record<string, unknown>): AssetLocation {
  const asset = id('asset', row.id),
    r = revision(row.revision);
  if (!asset.ok || !r.ok) throw Error('Invalid owned asset');
  return {
    id: asset.value,
    revision: r.value,
    key: String(row.object_key),
    mime: String(row.mime_type),
    sha256: String(row.sha256),
    size: Number(row.size_bytes),
    version: String(row.object_version),
    state: 'ready',
  };
}
it('restores all55 migrations/225 table hashes and authenticated objects, then applies newer signed barriers before controlled private reads', async () => {
  const fixture = await durablePhase2Fixture(),
    { f, r, configFile, config, root, materialFile, objectsDirectory, journalDirectory } = fixture;
  let host: Awaited<ReturnType<typeof openDurableHost>> | undefined,
    photo: Awaited<ReturnType<typeof composePhotoServices>> | undefined;
  try {
    const material = await readLocalPhase2Material(materialFile),
      objects = await createLocalEncryptedObjects(objectsDirectory, material),
      privacyCrypto = createPrivacyCrypto(
        material.current,
        deriveLocalPhase2Keys(material, 'privacy-journal'),
      ),
      contacts = createContactCrypto(
        material.current,
        deriveLocalPhase2Keys(material, 'contact'),
        { local_lookup: material.lookup },
        material.lookup,
      ),
      p1JournalDirectory = join(root, 'p1-journal'),
      archiveDirectory = join(root, 'object-backup'),
      restoredDirectory = join(root, 'restored-objects');
    for (const dir of [archiveDirectory, restoredDirectory]) await mkdir(dir);
    const p1Journal = createFilePrivacyJournal(p1JournalDirectory, privacyCrypto),
      analysisJournal = createFilePrivacyJournal(journalDirectory, privacyCrypto);
    const deletedOwner = await f.owner();
    const options = await durableHostOptions(configFile);
    host = await createPhase2LocalHost({
      ...options,
      bind: async (context) => {
        const b = await options.bind(context);
        return {
          ...b,
          report: {
            ...b.report,
            provider: {
              analyze: async () => ({
                state: 'unavailable',
                providerRequestId: null,
                inputTokens: null,
                outputTokens: null,
                costMinor: null,
              }),
            },
          },
        };
      },
    });
    const coupon = await seedDurableCouponImport(fixture, host);
    await host.tick();
    // Real encrypted/versioned PDF bound to an independently owned P1 report/capability.
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('TECHNICAL FIXTURE - PRESERVED OWNER REPORT');
    const pdfBytes = await pdf.save(),
      pdfId = uuid('asset'),
      files = createDeliveryFiles({
        scope: f.assetAdapter,
        objects,
        bucket: config.policy.assetBucket,
        keyVersion: material.current,
      });
    await files.put(pdfId, 'report_pdf', pdfBytes);
    const grantKey = { keyVersion: 'local-proof', digest: randomBytes(32).toString('hex') };
    value(
      await f.scope.unitOfWork.run(async (tx) => {
        await f.caps.asset(tx, f.ownerIdentity, {
          assetId: pdfId,
          reportId: f.retainedReport.head.id,
          version: 1,
          comparisonRevision: null,
          rendererVersion: 'local-recovery-v1',
          locale: 'en-US',
          scope: 'owner',
          renderKey: '7'.repeat(64),
        });
        await f.caps.grant(
          tx,
          { owner: f.ownerIdentity },
          {
            id: uuid('download_grant'),
            assetId: pdfId,
            reportId: f.retainedReport.head.id,
            version: 1,
            scope: 'owner',
            key: grantKey,
            expiresAt: time(600000),
          },
        );
        return ok(undefined);
      }),
    );
    photo = await composePhotoServices(f);
    const picture = await photo.example(),
      capture = value(
        await host.services.photo.capture(picture.keys, {
          key: 'capture-' + uuid('command'),
          policyId: picture.policy,
        }),
      ),
      intent = value(
        await host.services.photo.intent(picture.keys, {
          ...picture.input,
          batchId: capture.batchId,
        }),
      );
    if (!intent.id || !intent.grant) throw Error('Synthetic upload grant required');
    value(
      await host.services.photo.finalize(
        picture.keys,
        { uploadId: intent.id, grant: intent.grant },
        picture.bytes,
      ),
    );
    const extraction = value(
      await host.services.photo.extract(picture.keys, {
        uploadId: intent.id,
        key: 'extract-' + uuid('command'),
      }),
    );
    await host.tick();
    const extracted = value(await host.services.photo.get(picture.keys, intent.id));
    expect(extracted.state).toBe('complete');
    expect(extracted.candidates.length).toBeGreaterThan(0);
    const photoScope = value(await host.services.photo.deletionTarget(picture.keys, intent.id)),
      analysis = await r.example();
    await f.admin.query(
      "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,100000,10000,1000,2,'active',$2 FROM app.ai_policy_versions WHERE id=$1",
      [analysis.policy, f.staff],
    );
    const uncertain = value(await host.services.report.request(analysis.keys, analysis.input));
    await host.services.report.execute(uncertain.id);
    const attempts = (
      await f.admin.query(
        'SELECT id,scope_id FROM app.ai_attempts WHERE request_id=$1 ORDER BY id',
        [uncertain.id],
      )
    ).rows;
    expect(attempts).toHaveLength(1);
    const unknownAttemptIds = attempts.map((x) => String(x.id)),
      analysisScope = attempts[0]!.scope_id;
    const held = (
      await f.admin.query(
        'SELECT id,state,reserved_minor::text,settled_minor::text FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY id',
        [unknownAttemptIds[0]],
      )
    ).rows;
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((x) => x.state === 'uncertain' && x.settled_minor === null)).toBe(true);
    // A real stored coupon assignment and a synthetic owner capability for its existing recipient.
    const seeds = await repositorySeeds(f),
      recipientId = uuid('contact'),
      recipientEmail = 'recovery-' + recipientId + '@example.invalid',
      recipientEnvelope = await createLocalEnvelopeEncryption(material).encrypt(
        new TextEncoder().encode(recipientEmail),
        'contact_email',
        recipientId,
      ),
      recipient = value(
        await f.scope.unitOfWork.run(async (tx) =>
          ok(
            await createPrivacyRepository(f.scope, contacts.lookupVersions).registerContact(tx, {
              id: recipientId,
              subjectId: uuid('subject'),
              keys: contacts.emailKeys(recipientEmail),
              envelope: recipientEnvelope,
            }),
          ),
        ),
      ),
      message = await seeds.send(recipient),
      recipientKey = { keyVersion: 'local-proof', digest: randomBytes(32).toString('hex') },
      recipientSession = uuid('owner_session');
    await f.admin.query(
      "INSERT INTO app.owner_sessions(id,subject_id,token_hash,key_version,expires_at) VALUES($1,$2,decode($3,'hex'),$4,clock_timestamp()+interval '1 hour')",
      [recipientSession, message.subject, recipientKey.digest, recipientKey.keyVersion],
    );
    const code = (
        await f.admin.query(
          'SELECT id FROM partners.coupon_codes WHERE pool_id=$1 ORDER BY id LIMIT 1',
          [coupon.pool],
        )
      ).rows[0]!.id,
      loc = (
        await f.admin.query(
          'SELECT id FROM partners.locations WHERE org_id=$1 ORDER BY id LIMIT 1',
          [coupon.org],
        )
      ).rows[0]!.id;
    const reservation = await seeds.directReservation(
      {
        org: { id: coupon.org, actor: fixture.p.sessions.get(coupon.h)!.subject, location: loc },
        id: coupon.offer,
        pool: coupon.pool,
        mode: 'unique',
        version: 1,
      },
      message,
      code,
    );
    const sourcePilot = f.pilotAdapter(),
      sourcePilotRepo = createPilotRepository(sourcePilot);
    value(
      await sourcePilot.unitOfWork.run(async (tx) => {
        await sourcePilotRepo.authorize(tx, [recipientKey], value(id('send', message.id)));
        return ok(undefined);
      }),
    );
    // Build P1 replay with the existing role; notifications are explicitly unavailable.
    const p1 = host.services.privacy;
    const sourceAssets = (
      await f.admin.query(
        "SELECT id,revision::text,object_key,mime_type,sha256,size_bytes::text,object_version FROM app.object_assets WHERE state='ready' ORDER BY id",
      )
    ).rows.map(location);
    expect(sourceAssets.length).toBeGreaterThanOrEqual(7);
    const photoIds = (
      await f.admin.query(
        'SELECT original_asset_id,sanitized_asset_id FROM app.tire_photo_uploads WHERE id=$1',
        [intent.id],
      )
    ).rows[0]!;
    const photoObjects = await Promise.all(
      sourceAssets
        .filter((a) => [photoIds.original_asset_id, photoIds.sanitized_asset_id].includes(a.id))
        .map(async (asset) => ({ asset, bytes: await objects.get(asset) })),
    );
    expect(photoObjects.length).toBeGreaterThan(0);
    const original = (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [f.retainedReport.head.id],
      )
    ).rows;
    // No background loop runs in this fixture. Every archive version is checked against quiesced SQL metadata.
    let objectArchive: ObjectArchive | undefined,
      checkpoint: ParentHeldCheckpoint | undefined,
      p1Snapshot: SignedPrivacyRecord | undefined,
      analysisSnapshot: SignedPrivacyRecord | undefined,
      backupFinishedAt: Instant | undefined;
    await withSecurityArchive(
      async (proof) => {
        expect(proof.restoredRows).toEqual(proof.sourceRows);
        expect(proof.sourceRows).toHaveLength(225);
        expect(proof.restoredCatalog).toEqual(expectedSecurityRestoreCatalog(proof.sourceCatalog));
        expect(
          (await proof.restored.query('SELECT count(*)::int n FROM migration_meta.applied'))
            .rows[0]!.n,
        ).toBe(55);
        const runtimeConnect = (
          await proof.restored.query(
            "SELECT rolname,has_database_privilege(rolname,current_database(),'CONNECT') allowed FROM pg_roles WHERE rolname LIKE 'tt_%' AND NOT rolsuper ORDER BY rolname",
          )
        ).rows;
        expect(runtimeConnect.every((x) => !x.allowed)).toBe(true);
        if (!objectArchive || !checkpoint || !p1Snapshot || !analysisSnapshot || !backupFinishedAt)
          throw Error('Complete parent-held checkpoint required');
        await restorePrivateObjects(archiveDirectory, restoredDirectory, objectArchive, checkpoint);
        const restoredObjects = await createLocalEncryptedObjects(restoredDirectory, material);
        for (const asset of sourceAssets)
          expect(
            createHash('sha256')
              .update(await restoredObjects.get(asset))
              .digest('hex'),
          ).toBe(asset.sha256);
        await expect(
          (
            await createLocalEncryptedObjects(restoredDirectory, {
              ...material,
              keys: { v1: new Uint8Array(32).fill(99) },
            })
          ).get(sourceAssets[0]!),
        ).rejects.toThrow();
        const replayed: string[] = [];
        await withRestoredRoleScopes(proof.restored, async (scope) => {
          const scopes: Phase2LocalScopes = {
              partner: scope('tt_p2_partner_service'),
              coupon: scope('tt_p2_coupon_worker'),
              pilot: scope('tt_p2_pilot_service'),
              analysis: scope('tt_p2_analysis_service'),
              insights: scope('tt_p2_insights_service'),
              private: scope('tt_private_runtime'),
              privacy: scope('tt_privacy_runtime'),
              asset: scope('tt_asset_runtime'),
              staff: scope('tt_p2_csv_staff'),
              ingest: scope('tt_ingest_runtime'),
              publish: scope('tt_publish_runtime'),
            },
            b = await options.bind({ scopes, material, objects: restoredObjects }),
            services = await composePhase2LocalServices(b),
            restoredP1 = services.privacy;
          const who = value(
            await scopes.private.unitOfWork.run(async (tx) =>
              ok(
                (
                  await scopes.private.query(
                    tx,
                    'SELECT current_user,session_user,(SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS super',
                  )
                ).rows[0],
              ),
            ),
          );
          if (!who) throw Error('Restricted proof identity missing');
          expect(who.current_user).toBe('tt_private_runtime');
          expect(who.super).toBe(false);
          const input = {
            runId: uuid('restore'),
            backupFinishedAt: backupFinishedAt!,
            expectedDigest: p1Snapshot!.digest,
            snapshot: p1Snapshot!,
            jurisdiction: 'synthetic',
          };
          expect(
            (
              await restoredP1.replay({
                ...input,
                snapshot: { ...p1Snapshot!, digest: '0'.repeat(64) },
              })
            ).ok,
          ).toBe(false);
          const validDocument = privacyCrypto.verify(p1Snapshot!);
          if (!validDocument || typeof validDocument !== 'object')
            throw Error('Expected captured journal');
          const document = validDocument as Record<string, unknown>;
          const stale = privacyCrypto.sign({
            ...document,
            capturedAt: new Date(Date.parse(backupFinishedAt!) - 1000).toISOString(),
          });
          expect(
            (await restoredP1.replay({ ...input, snapshot: stale, expectedDigest: stale.digest }))
              .ok,
          ).toBe(false);
          const partial = privacyCrypto.sign({ ...document, entries: [] });
          expect((await restoredP1.replay({ ...input, snapshot: partial })).ok).toBe(false);
          const unsupported = privacyCrypto.sign({ ...document, version: 2 });
          expect(
            (
              await restoredP1.replay({
                ...input,
                snapshot: unsupported,
                expectedDigest: unsupported.digest,
              })
            ).ok,
          ).toBe(false);
          let p1Ready = value(await restoredP1.replay(input)).ready;
          expect(p1Ready).toBe(false);
          expect(
            (await services.erasure.replay({ ...analysisSnapshot!, digest: '0'.repeat(64) })).ok,
          ).toBe(false);
          value(await services.erasure.replay(analysisSnapshot!));
          replayed.push(analysisSnapshot!.digest);
          // Existing owner/privacy and erasure barriers elapse on the real clock, without SQL clock mutation.
          await new Promise((resolve) => setTimeout(resolve, 46000));
          const pending = (
            await proof.restored.query(
              'SELECT request_id AS id FROM privacy.request_work WHERE recovery_run_id=$1',
              [input.runId],
            )
          ).rows;
          for (let pass = 0; pass < 20 && !p1Ready; pass++) {
            for (const request of pending) {
              const worked = await restoredP1.workOne(value(id('privacy_request', request.id)));
              if (!worked.ok) throw Error('Restored privacy worker refused: ' + worked.error.code);
            }
            p1Ready = value(await restoredP1.replay(input)).ready;
          }
          if (!p1Ready) {
            const progress = (
              await proof.restored.query(
                'SELECT r.kind,r.status,w.last_error,f.store,f.status AS stage FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id JOIN privacy.fulfillment_steps f ON f.request_id=r.id WHERE w.recovery_run_id=$1 ORDER BY r.kind,f.store',
                [input.runId],
              )
            ).rows;
            throw Error('P1 recovery incomplete: ' + JSON.stringify(progress));
          }
          expect(p1Ready).toBe(true);
          expect(
            value(
              await scopes.private.unitOfWork.run(async (tx) =>
                ok(await createOwnerRepository(scopes.private).resolve(tx, [deletedOwner.token])),
              ),
            ),
          ).toBeNull();
          replayed.push(p1Snapshot!.digest);
          const control = () =>
            admitControlledRecoveryReads({
              database: 'tt_app_p2_security_restore',
              manifest: objectArchive,
              checkpoint: checkpoint!,
              actualSqlDigest: proof.archiveSha256,
              assets: sourceAssets,
              replayedDigests: replayed,
              unknownAttemptIds,
              p1Ready,
            });
          expect(control().controlledTestReads).toBe(true);
          expect((await services.photo.get(picture.keys, intent.id)).ok).toBe(false);
          const hidden = await services.report.status(analysis.keys, uncertain.id);
          expect(hidden.ok ? hidden.value.state : 'denied').not.toBe('available');
          const owner = value(
            await scopes.private.unitOfWork.run(async (tx) =>
              ok(
                await createReportRepository(scopes.private).version(
                  tx,
                  f.ownerIdentity,
                  f.retainedReport.head.id,
                  1,
                ),
              ),
            ),
          );
          expect(owner).not.toBeNull();
          const grant = value(
            await scopes.private.unitOfWork.run(async (tx) =>
              ok(await createCapabilityRepository(scopes.private).download(tx, [grantKey])),
            ),
          );
          expect(grant?.assetId).toBe(pdfId);
          const pdfAsset = value(
            await scopes.asset.unitOfWork.run(async (tx) =>
              ok(
                await createAssetRepository(
                  scopes.asset,
                  config.policy.assetBucket,
                  material.current,
                ).get(tx, pdfId),
              ),
            ),
          );
          if (!pdfAsset) throw Error('Missing preserved PDF');
          expect(await restoredObjects.get(pdfAsset)).toEqual(pdfBytes);
          const restoredPilot = createPilotRepository(scopes.pilot);
          expect(
            (
              await scopes.pilot.unitOfWork.run(async (tx) => {
                await restoredPilot.authorize(tx, [recipientKey], value(id('send', message.id)));
                return ok(undefined);
              })
            ).ok,
          ).toBe(false);
          // Late recorded workers cannot attach output, resurrect the photograph or spend again.
          const latePhoto = await services.photo.execute(extraction.id),
            lateAnalysis = await services.report.execute(uncertain.id);
          expect(latePhoto.ok ? latePhoto.value.state : 'denied').not.toBe('available');
          expect(lateAnalysis.ok ? lateAnalysis.value.state : 'denied').not.toBe('available');
          for (let pass = 0; pass < 20; pass++) {
            const jobs = value(await services.erasure.pending());
            if (!jobs.length) break;
            for (const job of jobs) value(await services.erasure.workOne(job));
          }
          for (const item of photoObjects) {
            expect(
              (
                await proof.restored.query('SELECT state FROM app.object_assets WHERE id=$1', [
                  item.asset.id,
                ])
              ).rows[0]!.state,
            ).toBe('deleted');
            await expect(restoredObjects.get(item.asset)).rejects.toThrow();
            await expect(restoredObjects.put(item.asset, item.bytes)).rejects.toThrow();
          }
          expect(
            (
              await proof.restored.query('SELECT id FROM app.ai_attempts WHERE request_id=$1', [
                uncertain.id,
              ])
            ).rows.map((x) => x.id),
          ).toEqual(unknownAttemptIds);
          expect(
            (
              await proof.restored.query(
                'SELECT id,state,reserved_minor::text,settled_minor::text FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY id',
                [unknownAttemptIds[0]],
              )
            ).rows,
          ).toEqual(held);
          expect(
            (
              await proof.restored.query(
                'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
                [f.retainedReport.head.id],
              )
            ).rows,
          ).toEqual(original);
          expect(
            (
              await proof.restored.query(
                'SELECT id FROM partners.coupon_reservations WHERE id=$1',
                [reservation],
              )
            ).rows,
          ).toHaveLength(1); // Restricted ledger, never reissued.
        });
        expect(
          (
            await proof.restored.query(
              "SELECT has_database_privilege('tt_private_runtime',current_database(),'CONNECT') allowed",
            )
          ).rows[0]!.allowed,
        ).toBe(false);
        console.log(
          'P2_COMPLETE_RECOVERY_EVIDENCE ' +
            JSON.stringify({
              actualPgDumpRestore: true,
              migrations: 55,
              tables: 225,
              allTableHashesMatch: true,
              catalogParity: true,
              encryptedObjectsRestored: sourceAssets.length,
              authenticatedVersionsChecked: true,
              postBackupP1Restriction: true,
              postBackupP1Deletion: true,
              postBackupAnalysisErasure: true,
              originalP1ReportAndPdfReadable: true,
              photoAnalysisCouponDenied: true,
              unknownCostHoldsPreserved: true,
              lateWorkersRefused: true,
              originalRuntimeConnectDenied: true,
              actualRestrictedProofLogin: true,
              independentlyDurableCustody: false,
              actualHostedRecoveryAccepted: false,
              providerDispatches: 0,
              actualRecipientNotifications: 0,
              casesClosed: 0,
              gatesClosed: 0,
            }),
        );
      },
      async (receipt) => {
        backupFinishedAt = value(instant(receipt.finishedAt));
        objectArchive = await archivePrivateObjects(
          objectsDirectory,
          archiveDirectory,
          sourceAssets,
          receipt.sha256,
        );
        // Actual newer AI and P1 service journals use owned synthetic capabilities; no notification is dispatched.
        for (const [keys, scope] of [
          [picture.keys, photoScope],
          [analysis.keys, analysisScope],
        ] as const) {
          const job = value(
            await host!.services.erasure.removeScope(keys, scope, 'recovery-' + uuid('command')),
          );
          value(await host!.services.erasure.workOne(job));
        }
        // Actual source owner proofs create and journal both decisions after the archive.
        value(
          await p1.requestOwner(
            [recipientKey],
            'restrict',
            'synthetic',
            'recovery-restrict-' + uuid('command'),
          ),
        );
        value(
          await p1.requestOwner(
            [deletedOwner.token],
            'delete',
            'synthetic',
            'recovery-delete-' + uuid('command'),
          ),
        );
        p1Snapshot = await p1Journal.capture(new Date().toISOString());
        analysisSnapshot = await analysisJournal.capture(new Date().toISOString());
        checkpoint = {
          archive: objectArchive.id,
          objectDigest: objectArchive.digest,
          sqlDigest: receipt.sha256,
          p1Digest: p1Snapshot.digest,
          analysisDigest: analysisSnapshot.digest,
          unknownAttempts: unknownAttemptIds,
        };
        expect(
          (
            await f.admin.query(
              'SELECT id,state,reserved_minor::text,settled_minor::text FROM app.ai_budget_reservations WHERE attempt_id=$1 ORDER BY id',
              [unknownAttemptIds[0]],
            )
          ).rows,
        ).toEqual(held);
      },
    );
  } finally {
    await host?.shutdown();
    await photo?.cleanup();
    await fixture.cleanup();
  }
}, 240000);
