import { createReportServices } from '../../../packages/application/src/services/reports.ts';
import { createReportAccessRepository } from '../../../packages/db/src/repositories/report-services.ts';
import { createCommandRepository } from '../../../packages/db/src/repositories/jobs.ts';
import { createReportCrypto } from '../../../packages/integrations/src/report-crypto.ts';
import { privateFixture, time } from '../private/database.ts';
import { engineFixture } from '../engine/base.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';

// Fixed synthetic evidence/encryption ports; engine, business services and SQL remain real.
export function fixtureReportServices(db: Awaited<ReturnType<typeof privateFixture>>) {
  const crypto = createReportCrypto(
    'http-v1',
    { 'http-v1': new Uint8Array(32).fill(41) },
    new Uint8Array(32).fill(87),
  );
  const encrypted = new Map<string, Uint8Array>();
  const reports = createReportServices({
    uow: db.scope.unitOfWork,
    owners: db.owners,
    reports: db.reports,
    capabilities: db.caps,
    access: createReportAccessRepository(db.scope),
    commands: createCommandRepository(db.scope),
    crypto,
    now: () => time(),
    evidence: {
      prepare: async (_input, asOf) => {
        const e = engineFixture();
        e.snapshot.bundleId = db.bundleId;
        e.snapshot.policy.id = db.ruleId;
        e.snapshot.asOf = asOf;
        e.snapshot.recall.checkedAt = asOf;
        return ok({ snapshot: e.snapshot, prices: [], products: [] });
      },
      current: async () => ok(true),
      overlay: async (_version, asOf) =>
        ok({ checkedAt: asOf, status: 'review_required', matched: [], unresolved: true }),
    },
    encryption: {
      encrypt: async (bytes, purpose, id) => {
        encrypted.set(purpose + id, bytes);
        return { keyVersion: 'synthetic-only', hex: 'c'.repeat(64) };
      },
      decrypt: async (_value, purpose, id) => encrypted.get(purpose + id)!,
    },
  });
  return { reports, crypto };
}
