import { vi } from 'vitest';
import { engineFixture, asOf, uuid, type Mutable } from '../engine/base.ts';
import { createReportEvidence } from '../../../packages/application/src/services/report-evidence.ts';
import { createReportCrypto } from '../../../packages/integrations/src/report-crypto.ts';
import { known, id } from '../../../packages/domain/src/values/core.ts';
import type {
  CatalogRepository,
  CatalogPin,
  CatalogSource,
} from '../../../packages/application/src/ports/catalog.ts';
import type {
  UnitOfWork,
  TransactionContext,
} from '../../../packages/application/src/ports/transactions.ts';
import { reportWork, json } from '../../../packages/application/src/services/report-records.ts';
import type { ReportPolicyRepository } from '../../../packages/application/src/ports/report-services.ts';
import type { JsonObject } from '../../../packages/application/src/ports/catalog-records.ts';
export function evidenceFixture() {
  const e = engineFixture(),
    source = (kind: string): CatalogSource => {
      const s = e.snapshot.sources.find((s) => s.kind === kind)!;
      return {
        datasetId: s.datasetId,
        providerId: s.providerId,
        licenseId: s.licenseId,
        kind,
        rights: s.rights,
        fetchedAt: s.fetchedAt,
        expiresAt: known(s.validUntil),
      } as CatalogSource;
    };
  const facts: Record<string, { fact: Record<string, unknown>; source: CatalogSource }[]> = {};
  function put(kind: string, fact: unknown, s = 'catalog') {
    (facts[kind] ??= []).push({ fact: fact as Record<string, unknown>, source: source(s) });
  }
  const f = e.snapshot.fitment!;
  put(
    'fitmentConfigurations',
    {
      id: f.id,
      vehicleId: uuid(90),
      wheelPackage: f.wheelPackage,
      verificationStatus: 'verified',
      approvedOptions: { drivetrain: f.drivetrain, replacement: f.replacement },
    },
    'fitment',
  );
  for (const a of f.axles)
    put(
      'fitmentAxles',
      { ...a, id: uuid(a.axle === 'front' ? 91 : 92), configurationId: f.id },
      'fitment',
    );
  const skus = [e.snapshot.plans[0]!.front, e.snapshot.plans[0]!.rear];
  f.replacement!.permittedModelPairs.push({ front: skus[0]!.modelId, rear: skus[1]!.modelId });
  put(
    'climateProfiles',
    { id: uuid(93), market: 'US', regionKey: 'SYNTHETIC_US', reviewedAt: asOf, profile: {} },
    'climate',
  );
  put(
    'marketRules',
    {
      id: uuid(94),
      market: 'US',
      regionKey: 'SYNTHETIC_US',
      reviewedAt: asOf,
      effectiveFrom: asOf,
      effectiveTo: null,
      guidance: {},
    },
    'market_rules',
  );
  for (const [i, s] of skus.entries()) {
    put('tireSkus', {
      ...s,
      status: 'active',
      manufacturerSku: 'synthetic-' + i,
      sourceRecordKey: s.id,
    });
    put('marketAvailability', {
      id: uuid(300 + i),
      skuId: s.id,
      market: 'US',
      available: true,
      observedAt: asOf,
      expiresAt: s.availabilityUntil,
    });
    if (!facts.tireModels?.some((m) => m.fact.id === s.modelId))
      put('tireModels', {
        id: s.modelId,
        brand: 'Synthetic',
        model: 'Fixture ' + i,
        category: 'test',
        seasonalClass: s.season,
      });
    for (const [j, m] of s.measurements.entries())
      put('evidence', {
        id: uuid(400 + i * 10 + j),
        skuId: s.id,
        modelId: null,
        metricCode: m.metric,
        numericValue: String(m.valueBp),
        textValue: null,
        unit: 'basis_point',
        method: 'synthetic',
        reviewedAt: m.reviewedAt,
        confidence: m.confidence,
        applicability: { comparisonKey: m.comparisonKey, validUntil: m.validUntil },
      });
    put('prices', {
      id: uuid(500 + i),
      skuId: s.id,
      retailerId: uuid(600),
      market: 'US',
      currency: 'USD',
      unitPriceMinor: 15000n,
      quantityBasis: 'per_tire',
      observedAt: asOf,
      validUntil: '2026-11-01T00:00:00.000Z',
      taxIncluded: false,
    });
    for (const [j, kind] of ['mounting', 'balancing', 'tpms_valve', 'disposal'].entries())
      put('priceComponents', {
        id: uuid(700 + i * 10 + j),
        priceId: uuid(500 + i),
        kind,
        basis: 'per_tire',
        amountKind: 'fixed',
        lowMinor: 250n,
        highMinor: 250n,
        rate: null,
        included: false,
      });
    put('priceComponents', {
      id: uuid(709 + i * 10),
      priceId: uuid(500 + i),
      kind: 'tax',
      basis: 'tire_subtotal',
      amountKind: 'percentage',
      lowMinor: null,
      highMinor: null,
      rate: '0.07',
      included: false,
    });
  }
  const pin = {
    bundleId: id('bundle', e.snapshot.bundleId).ok
      ? (e.snapshot.bundleId as CatalogPin['bundleId'])
      : null!,
    market: 'US',
    coverage: 'available' as CatalogPin['coverage'],
    components: e.snapshot.sources.map((s) => ({ key: s.kind, source: source(s.kind) })),
  };
  const doc = json({
    ...e.snapshot.policy,
    componentKinds: Object.fromEntries(e.snapshot.sources.map((s) => [s.kind, s.kind])),
    freshnessSeconds: Object.fromEntries(e.snapshot.sources.map((s) => [s.kind, 864000])),
    taxContextId: uuid(601),
  }) as Mutable<JsonObject>;
  const rule = {
    id: e.snapshot.policy.id,
    version: e.snapshot.policy.version,
    document: doc,
    reviewedBy: uuid(60),
    reviewedAt: e.snapshot.policy.reviewedAt!,
  };
  const catalog = {
    pin: vi.fn(async () => pin),
    page: vi.fn(async (_tx: unknown, r: { kind: string; filters: Record<string, unknown> }) => ({
      items: (facts[r.kind] ?? []).filter((x) =>
        Object.entries(r.filters).every(([k, v]) => x.fact[k] === v),
      ),
      next: null as string | null,
    })),
    batch: vi.fn(async (_tx: unknown, r: { kind: string; field: string; ids: string[] }) =>
      (facts[r.kind] ?? []).filter((x) => r.ids.includes(String(x.fact[r.field]))),
    ),
  };
  const policies = { published: vi.fn(async () => rule) },
    recalls = {
      checkedAt: vi.fn(
        async () => asOf as import('../../../packages/domain/src/values/core.ts').Instant | null,
      ),
    };
  const base: UnitOfWork = { run: async (work) => work({} as TransactionContext) };
  const uow: UnitOfWork = { run: (work) => reportWork(base, work) };
  const crypto = createReportCrypto(
    'test',
    { test: new Uint8Array(32).fill(42) },
    new Uint8Array(32).fill(43),
  );
  const service = createReportEvidence({
    catalog: catalog as unknown as CatalogRepository,
    policies: policies as unknown as ReportPolicyRepository,
    catalogUow: uow,
    sourceUow: uow,
    recalls,
    crypto,
  });
  return { e, pin, doc, rule, facts, catalog, policies, recalls, uow, crypto, service, asOf };
}
