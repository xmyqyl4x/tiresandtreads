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
export async function assessmentApiFixture() {
  return operationsApiFixture(async ({ db, services }) => {
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
    services.reports = reports;
    return publicOwnerRoutes({
      reports,
      shareKeys: (t) => crypto.lookup('share', t),
      lookup: async (query) => {
        // Fixed slow-response scenario for browser cancellation/recovery checks only.
        if (query.get('modelYear') === '2027')
          await new Promise((resolve) => setTimeout(resolve, 2000));
        return createReferenceQuery(db.readScope.unitOfWork, db.catalog)(query);
      },
      content: async () => ok({ coverage: 'unavailable' }),
      download: async () => fail(failure('not_found')),
    });
  });
}
