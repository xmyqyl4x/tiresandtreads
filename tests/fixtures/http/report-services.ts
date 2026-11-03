import { createReportServices } from '../../../packages/application/src/services/reports.ts';
import { createReportAccessRepository } from '../../../packages/db/src/repositories/report-services.ts';
import { createCommandRepository } from '../../../packages/db/src/repositories/jobs.ts';
import { createReportCrypto } from '../../../packages/integrations/src/report-crypto.ts';
import { privateFixture, time } from '../private/database.ts';
import { engineFixture, uuid } from '../engine/base.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';

// Fixed synthetic evidence/encryption ports; engine, business services and SQL remain real.
export function fixtureReportServices(
  db: Awaited<ReturnType<typeof privateFixture>>,
  options: { current?: boolean } = {},
) {
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
        if (options.current && ['SYNTHETIC_FIVE', 'SYNTHETIC_PDF'].includes(_input.regionKey))
          e.snapshot.policy.regionKey = _input.regionKey;
        if (options.current) {
          // Fixed five-choice scenario for responsive comparison/results tests only.
          if (['SYNTHETIC_FIVE', 'SYNTHETIC_PDF'].includes(_input.regionKey))
            for (let i = 1; i < 5; i++) {
              const p = structuredClone(e.snapshot.plans[0]!);
              p.id = uuid(101 + i);
              for (const [j, axle] of (['front', 'rear'] as const).entries()) {
                p[axle].id = uuid(201 + i * 2 + j);
                p[axle].modelId = uuid(301 + i);
                for (const m of p[axle].measurements) m.skuId = p[axle].id;
              }
              e.snapshot.plans.push(p);
            }

          const past = new Date(Date.parse(asOf) - 86400000).toISOString(),
            future = new Date(Date.parse(asOf) + 86400000).toISOString();
          for (const s of e.snapshot.sources) {
            s.fetchedAt = past;
            s.validUntil = future;
          }
          e.snapshot.policy.reviewedAt = past;
          e.snapshot.policy.reviewDueAt = future;
          for (const p of e.snapshot.plans) {
            if (p.cost) p.cost.validUntil = future;
            for (const s of [p.front, p.rear]) {
              s.availabilityUntil = future;
              for (const m of s.measurements) {
                m.reviewedAt = past;
                m.validUntil = future;
              }
            }
          }
          if (_input.regionKey === 'SYNTHETIC_STALE')
            e.snapshot.recall.checkedAt = new Date(Date.parse(asOf) - 30 * 86400000).toISOString();
        }
        return ok({
          snapshot: e.snapshot,
          prices: [],
          products: options.current
            ? e.snapshot.plans.map((p, i) => ({
                id: p.front.id,
                modelId: p.front.modelId,
                brand: 'Synthetic',
                model: 'Example ' + (i + 1),
              }))
            : [],
        });
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
