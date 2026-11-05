import { emailControlRoutes } from './email-control-routes.ts';
import type { Id } from '../../../packages/domain/src/values/core.ts';
import { createAssetService } from '../../../packages/application/src/services/assets.ts';
import { createAssetRepository } from '../../../packages/db/src/repositories/assets.ts';
import { createFixtureReportRenderer } from '../../../packages/integrations/src/delivery-renderer.ts';
import { createHash } from 'node:crypto';
import { operationsApiFixture } from './operations-api.ts';
import { fixtureReportServices } from './report-services.ts';
import { publicOwnerRoutes } from '../../../packages/integrations/src/http/public-owner.ts';
import { createReferenceQuery } from '../../../packages/application/src/queries/reference.ts';
import { ok, fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import { uuid } from '../engine/base.ts';
import { success } from '../catalog/database.ts';
// Disposable synthetic domain facts and evidence, with actual HTTP/business services/PostgreSQL.
// This fixture does not select a licensed adapter, approve a source, or activate product advice.
export async function assessmentApiFixture(mailProof?: Parameters<typeof operationsApiFixture>[1]) {
  let tokens: ReturnType<typeof fixtureReportServices>['crypto'] | undefined;
  const api = await operationsApiFixture(async (context) => {
    const { db, services } = context;
    const r = await db.run();
    await db.admin.query(
      "UPDATE app.data_licenses SET expires_at=now()+interval '1 day' WHERE id=$1",
      [db.license],
    );
    await db.stage(r, 'vehicles', [
      {
        id: uuid(39) as never,
        market: 'US',
        modelYear: 2026,
        make: 'Synthetic',
        model: 'Example',
        trim: 'Local fixture',
        powertrain: 'FWD',
        sourceRecordKey: 'vehicle',
      },
    ]);
    await db.stage(
      r,
      'fitmentConfigurations',
      [40, 41].map((n) => ({
        id: uuid(n) as never,
        vehicleId: uuid(39) as never,
        wheelPackage: n === 40 ? 'Synthetic staggered 18' : 'Synthetic alternative 18',
        verificationStatus: 'verified',
        approvedOptions: {},
        schemaVersion: 1 as const,
        sourceRecordKey: 'configuration-' + n,
      })),
      2n,
    );
    await db.stage(
      r,
      'fitmentAxles',
      [40, 41].flatMap((n, index) =>
        (['front', 'rear'] as const).map((axle, i) => ({
          id: uuid(50 + index * 2 + i) as never,
          configurationId: uuid(n) as never,
          axle,
          quantity: 2,
          sizeCode: axle === 'front' ? '225/45R18' : '255/40R18',
          widthMm: null,
          aspectRatio: null,
          rimInches: '18',
          construction: 'radial',
          minLoadIndex: 98,
          minSpeedRank: 12,
          loadRange: 'not_required',
          xlRequired: false,
          runFlatRequired: false,
          unknownConstraints: [],
          schemaVersion: 1 as const,
        })),
      ),
      4n,
    );
    const publication = await db.candidate(r, 7n);
    await success(db.publishScope.unitOfWork, (tx) => db.publish.publish(tx, publication));
    const { reports, crypto } = fixtureReportServices(db, { current: true });
    tokens = crypto;

    const store = new Map<string, Uint8Array>(),
      assetScope = db.adapter('tt_asset_runtime'),
      files = createAssetService({
        uow: assetScope.unitOfWork,
        assets: createAssetRepository(assetScope, 'synthetic-private', 'fixture-kms'),
        authority: db.scope.unitOfWork,
        capabilities: db.caps,
        objects: {
          put: async (a, b) => {
            store.set(a.id, b);
            return 'fixture-v1';
          },
          get: async (a) => {
            const b = store.get(a.id);
            if (
              !b ||
              createHash('sha256').update(b).digest('hex') !== a.sha256 ||
              b.length !== a.size
            )
              throw Error('Fixture asset unavailable');
            return b;
          },
          erase: async (a) => {
            store.delete(a.id);
          },
        },
      });
    // Existing fixed technical renderer only. No delivery, recipient or provider is activated.
    const originalCreate = reports.create,
      seeded = new Map<string, Promise<void>>();
    reports.create = async (keys, key, input) => {
      const result = await originalCreate(keys, key, input);
      if (
        result.ok &&
        typeof input === 'object' &&
        input !== null &&
        'regionKey' in input &&
        input.regionKey === 'SYNTHETIC_PDF'
      ) {
        const reportId = result.value.report_id!;
        let seed = seeded.get(reportId);
        if (!seed) {
          seed = (async () => {
            const owner = await success(db.scope.unitOfWork, (tx) => db.owners.resolve(tx, keys));
            if (!owner) throw Error('Missing fixture owner');
            const hash = 'b'.repeat(64),
              rendered = await createFixtureReportRenderer(hash).render({
                schemaVersion: 1,
                fixture: true,
                locale: 'en-US',
                market: 'US',
                sender: 'fixture@example.invalid',
                policyVersion: 'synthetic',
                report: {},
                comparison: null,
                template: { id: crypto.id('template'), version: 'fixture', rendererHash: hash },
                learning: [],
              }),
              bytes = new Uint8Array(Buffer.from(rendered.pdf, 'base64'));
            for (const scope of ['owner', 'shared'] as const) {
              const assetId = crypto.id('asset', reportId + ':' + scope);
              await files.upload(
                {
                  id: assetId,
                  purpose: 'report_pdf',
                  mime: 'application/pdf',
                  size: bytes.length,
                  sha256: createHash('sha256').update(bytes).digest('hex'),
                },
                bytes,
              );
              await success(db.scope.unitOfWork, (tx) =>
                db.caps.asset(tx, owner, {
                  assetId,
                  reportId,
                  version: 1,
                  comparisonRevision: null,
                  rendererVersion: 'existing-technical-fixture',
                  locale: 'en-US',
                  scope,
                  renderKey: 'synthetic-pdf:' + reportId + ':' + scope,
                }),
              );
            }
          })();
          seeded.set(reportId, seed);
        }
        await seed;
      }
      return result;
    };
    services.reports = reports;
    return [
      ...(await emailControlRoutes(context)),
      ...publicOwnerRoutes({
        reports,
        shareKeys: (t) => crypto.lookup('share', t),
        lookup: async (query) => {
          // Fixed slow-response scenario for browser cancellation/recovery checks only.
          if (query.get('modelYear') === '2027')
            await new Promise((resolve) => setTimeout(resolve, 2000));
          return createReferenceQuery(db.readScope.unitOfWork, db.catalog)(query);
        },
        content: async () => ok({ coverage: 'unavailable' }),
        download: async (token) => {
          try {
            return ok(await files.download(crypto.lookup('download', token)));
          } catch {
            return fail(failure('not_found'));
          }
        },
      }),
    ];
  }, mailProof);
  return {
    ...api,
    async expiredShare(who: Parameters<typeof api.ownerIdentity>[0], reportId: Id<'report'>) {
      const owner = await api.ownerIdentity(who),
        version = await success(api.db.scope.unitOfWork, (tx) =>
          api.db.reports.version(tx, owner, reportId, 1),
        );
      if (!version || !tokens) throw Error('Invalid synthetic expired-share setup');
      const capId = tokens.id('report_capability'),
        minted = tokens.token('share', capId, tokens.keyVersion);
      await api.db.admin.query(
        "INSERT INTO app.report_capabilities(id,report_id,report_version,scope,version_scope,token_hash,key_version,expires_at,created_at,updated_at) VALUES($1,$2,1,'view','fixed',decode($3,'hex'),$4,clock_timestamp()-interval '1 day',clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days')",
        [capId, reportId, minted.key.digest, minted.key.keyVersion],
      );
      return minted.token;
    },
  };
}
