import { fail, ok, instant, type Id } from '../../../domain/src/values/core.ts';
import { normalizeAssessment } from '../../../engine/src/input.ts';
import { evaluate } from '../../../engine/src/evaluate.ts';
import type {
  AssessmentInput,
  EngineSnapshot,
  Source,
  Sku,
  Plan,
  RulePolicy,
  Fitment,
  Measurement,
  Metric,
} from '../../../engine/src/model.ts';
import type {
  CatalogRepository,
  CatalogPin,
  CatalogSource,
  PublicFact,
  FactFilters,
} from '../ports/catalog.ts';
import { pageRequest } from '../ports/pagination.ts';
import type { FactKind, JsonObject } from '../ports/catalog-records.ts';
import type {
  ReportEvidence,
  ReportPolicyRepository,
  ReportCrypto,
  SafetyOverlay,
  ReportRecallRepository,
} from '../ports/report-services.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import {
  demand,
  object,
  canonical,
  json,
  serviceFailure,
  reportWork,
  ReportFault,
} from './report-records.ts';
import { attachExactPrice } from '../../../engine/src/pricing/bridge.ts';
import { compileCatalogPrice } from './report-prices.ts';
function until(asOf: string, seconds: number) {
  return new Date(new Date(asOf).getTime() + seconds * 1000).toISOString();
}
export function createReportEvidence(deps: {
  readonly catalog: CatalogRepository;
  readonly policies: ReportPolicyRepository;
  readonly catalogUow: UnitOfWork;
  readonly recalls: ReportRecallRepository;
  readonly sourceUow: UnitOfWork;
  readonly crypto: Pick<ReportCrypto, 'id'>;
}): ReportEvidence {
  const { catalog, policies, catalogUow, recalls, sourceUow, crypto } = deps;
  async function ready(dataset: string) {
    const r = await sourceUow.run(async (tx) =>
      ok(await recalls.checkedAt(tx, dataset as Id<'dataset'>)),
    );
    if (!r.ok) throw new ReportFault(r.error.code, r.error);
    return r.value;
  }
  async function page<K extends FactKind>(
    tx: Tx,
    pin: CatalogPin,
    kind: K,
    filters: FactFilters<K>,
  ) {
    const paging = pageRequest(100, null);
    demand(paging.ok, 'integrity');
    const r = await catalog.page<K>(tx, {
      kind,
      bundleId: pin.bundleId,
      market: pin.market,
      filters,
      page: paging.value,
    });
    demand(r.next === null, 'unavailable');
    return r.items;
  }
  async function batch<K extends FactKind>(
    tx: Tx,
    pin: CatalogPin,
    kind: K,
    field: Parameters<CatalogRepository['batch']>[1]['field'],
    ids: readonly string[],
  ) {
    return catalog.batch(tx, {
      kind,
      bundleId: pin.bundleId,
      market: pin.market,
      field,
      ids: [...new Set(ids)].sort(),
    });
  }
  function source(s: CatalogSource, pin: CatalogPin, doc: JsonObject, asOf: string): Source {
    demand(
      ['display', 'api', 'cache', 'derived', 'snapshot'].every(
        (k) => s.rights[k as keyof typeof s.rights] === true,
      ),
      'unavailable',
    );
    const kinds = object(doc.componentKinds),
      ttl = object(doc.freshnessSeconds),
      component = pin.components.find((c) => c.source.datasetId === s.datasetId);
    demand(component, 'integrity');
    const kind = kinds[component.key];
    demand(
      typeof kind === 'string' &&
        ['catalog', 'fitment', 'recall', 'climate', 'market_rules'].includes(kind),
      'unavailable',
    );
    const seconds = ttl[kind];
    demand(
      typeof seconds === 'number' &&
        Number.isSafeInteger(seconds) &&
        seconds > 0 &&
        seconds <= 2592000,
      'unavailable',
    );
    const expiry = until(s.fetchedAt, seconds);
    demand(
      s.fetchedAt <= asOf &&
        expiry > asOf &&
        (s.expiresAt.state !== 'known' || s.expiresAt.value > asOf),
      'unavailable',
    );
    return {
      datasetId: s.datasetId,
      providerId: s.providerId,
      licenseId: s.licenseId,
      market: 'US',
      kind: kind as Source['kind'],
      fetchedAt: s.fetchedAt,
      validUntil:
        s.expiresAt.state === 'known' && s.expiresAt.value < expiry ? s.expiresAt.value : expiry,
      rights: s.rights,
    };
  }
  async function prepared(input: AssessmentInput, asOf: string) {
    demand(instant(asOf).ok, 'integrity');
    const read = await reportWork(catalogUow, async (tx) => {
      const pin = await catalog.pin(tx, 'US', null),
        rule = await policies.published(tx, input.regionKey);
      demand(pin?.coverage === 'available' && rule, 'unavailable');
      const doc = rule.document;
      demand(
        instant(doc.reviewDueAt).ok && String(doc.reviewDueAt) > asOf && rule.reviewedAt <= asOf,
        'unavailable',
      );
      const components = pin.components.map((c) => source(c.source, pin, doc, asOf));
      const policy = {
        ...doc,
        id: rule.id,
        version: rule.version,
        reviewed: true,
        reviewedBy: rule.reviewedBy,
        reviewedAt: rule.reviewedAt,
      } as unknown as RulePolicy;
      const climate = await page(tx, pin, 'climateProfiles', { regionKey: input.regionKey }),
        guidance = await page(tx, pin, 'marketRules', { regionKey: input.regionKey });
      demand(
        climate.length === 1 &&
          climate[0]!.source.datasetId === policy.climateSourceId &&
          climate[0]!.fact.reviewedAt <= asOf &&
          guidance.some(
            (r) =>
              r.source.datasetId === policy.marketRulesSourceId &&
              r.fact.effectiveFrom <= asOf &&
              (r.fact.effectiveTo === null || r.fact.effectiveTo > asOf) &&
              r.fact.reviewedAt <= asOf,
          ),
        'unavailable',
      );
      const recall = components.filter((s) => s.kind === 'recall');
      demand(recall.length === 1, 'unavailable');
      const config = input.configurationId
        ? await page(tx, pin, 'fitmentConfigurations', {
            id: input.configurationId as Id<'fitment_configuration'>,
          })
        : [];
      demand(config.length <= 1, 'integrity');
      const cfg = config[0],
        axles = cfg ? await batch(tx, pin, 'fitmentAxles', 'configurationId', [cfg.fact.id]) : [];
      const opts = cfg?.fact.approvedOptions;
      const fitment: Fitment | null = cfg
        ? {
            id: cfg.fact.id,
            sourceId: cfg.source.datasetId,
            wheelPackage: cfg.fact.wheelPackage,
            verified:
              cfg.fact.verificationStatus === 'verified' &&
              axles.every((a) => a.source.datasetId === cfg.source.datasetId),
            drivetrain:
              opts && ['FWD', 'RWD', 'AWD', '4WD'].includes(String(opts.drivetrain))
                ? (opts.drivetrain as Fitment['drivetrain'])
                : null,
            axles: axles.map((r) => r.fact) as Fitment['axles'],
            replacement: opts?.replacement
              ? (opts.replacement as unknown as Fitment['replacement'])
              : null,
          }
        : null;
      const sizes =
        input.sizes ??
        (fitment && fitment.axles.length === 2
          ? {
              front: fitment.axles.find((a) => a.axle === 'front')?.sizeCode,
              rear: fitment.axles.find((a) => a.axle === 'rear')?.sizeCode,
            }
          : null);
      const skuRows = [] as { fact: PublicFact<'tireSkus'>; source: CatalogSource }[];
      if (sizes?.front && sizes.rear)
        for (const sizeCode of [...new Set([sizes.front, sizes.rear])])
          skuRows.push(...(await page(tx, pin, 'tireSkus', { sizeCode })));
      const skuIds = skuRows.map((r) => r.fact.id),
        modelIds = skuRows.map((r) => r.fact.modelId);
      const models = await batch(tx, pin, 'tireModels', 'id', modelIds),
        availability = await batch(tx, pin, 'marketAvailability', 'skuId', skuIds),
        measurements = await batch(tx, pin, 'evidence', 'skuId', skuIds);
      const targetRows = [
        ...(await batch(tx, pin, 'recallTargets', 'skuId', skuIds)),
        ...(await batch(tx, pin, 'recallTargets', 'modelId', modelIds)),
      ];
      const targets = [...new Map(targetRows.map((r) => [r.fact.id, r])).values()];
      const prices = await batch(tx, pin, 'prices', 'skuId', skuIds),
        charges = await batch(
          tx,
          pin,
          'priceComponents',
          'priceId',
          prices.map((r) => r.fact.id),
        );
      const skus: Sku[] = skuRows.map(({ fact: f, source: s }) => {
        const model = models.filter(
            (r) => r.fact.id === f.modelId && r.source.datasetId === s.datasetId,
          ),
          avs = availability.filter(
            (r) =>
              r.source.datasetId === s.datasetId &&
              r.fact.skuId === f.id &&
              r.fact.market === 'US' &&
              r.fact.observedAt <= asOf,
          ),
          ms = measurements.filter((r) => r.fact.skuId === f.id);
        const mapped = targets.filter(
          (r) =>
            r.source.datasetId === recall[0]!.datasetId &&
            (r.fact.skuId === f.id || r.fact.modelId === f.modelId),
        );
        const state = mapped.some((r) => r.fact.matchStatus === 'matched')
          ? 'matched'
          : mapped.some((r) => r.fact.matchStatus !== 'not_matched')
            ? 'unresolved'
            : 'unknown';
        const evidence: Measurement[] = ms
          .filter(
            (r) =>
              r.fact.unit === 'basis_point' &&
              r.fact.numericValue !== null &&
              /^(0|[1-9][0-9]{0,4})$/.test(r.fact.numericValue) &&
              Number(r.fact.numericValue) <= 10000 &&
              ['high', 'medium', 'low'].includes(r.fact.confidence) &&
              typeof r.fact.applicability.comparisonKey === 'string' &&
              instant(r.fact.applicability.validUntil).ok,
          )
          .map((r) => ({
            metric: r.fact.metricCode as Metric,
            skuId: f.id,
            sourceId: r.source.datasetId,
            valueBp: Number(r.fact.numericValue),
            comparisonKey: String(r.fact.applicability.comparisonKey),
            reviewedAt: r.fact.reviewedAt,
            validUntil: String(r.fact.applicability.validUntil),
            confidence: r.fact.confidence as Measurement['confidence'],
          }))
          .filter((m) =>
            [
              'wet',
              'longevity',
              'comfort',
              'dry',
              'value',
              'noise',
              'efficiency',
              'snow',
              'ice',
            ].includes(m.metric),
          );
        demand(evidence.length <= 9, 'integrity');
        return {
          id: f.id,
          sourceId: s.datasetId,
          modelId: f.modelId,
          sizeCode: f.sizeCode,
          rimInches: f.rimInches,
          construction: f.construction,
          loadIndex: f.loadIndex,
          speedRank: f.speedRank,
          loadRange: f.loadRange,
          xl: f.xl,
          runFlat: f.runFlat,
          season:
            model.length === 1 &&
            ['all_season', 'all_weather', 'summer', 'winter'].includes(model[0]!.fact.seasonalClass)
              ? (model[0]!.fact.seasonalClass as Sku['season'])
              : null,
          threePmsf: null,
          available: avs.length === 1 ? avs[0]!.fact.available : null,
          availabilityUntil: avs.length === 1 ? avs[0]!.fact.expiresAt : null,
          recall: {
            sourceId: recall[0]!.datasetId,
            state,
            targetRefs: mapped.map((r) => r.fact.sourceTargetId).sort(),
          },
          measurements: evidence,
        };
      });
      const front = skus.filter((s) => s.sizeCode === sizes?.front),
        rear = skus.filter((s) => s.sizeCode === sizes?.rear),
        plans: Plan[] = [];
      for (const f of front)
        for (const r of rear) {
          // Only explicit reviewed model combinations enter the portfolio; no guessed staggered mix.
          if (
            !fitment?.replacement?.permittedModelPairs.some(
              (p) => p.front === f.modelId && p.rear === r.modelId,
            )
          )
            continue;
          demand(plans.length < 100, 'unavailable');
          plans.push({
            id: crypto.id('plan', canonical([pin.bundleId, cfg?.fact.id ?? null, f.id, r.id])),
            front: f,
            rear: r,
            inspection: null,
            cost: null,
          });
        }
      let snapshot: EngineSnapshot = {
        bundleId: pin.bundleId,
        asOf,
        sources: components,
        policy,
        fitment,
        recall: { datasetId: recall[0]!.datasetId, checkedAt: asOf, complete: false },
        plans,
      };
      const estimates = [];
      for (const plan of plans) {
        const price = compileCatalogPrice({
          input,
          snapshot,
          plan,
          prices,
          charges,
          crypto,
          taxContextId: doc.taxContextId ?? null,
        });
        if (price) {
          estimates.push(price);
          const attached = attachExactPrice(input, snapshot, price);
          demand(attached.ok, 'integrity');
          snapshot = attached.value;
        }
      }
      const products = skuRows.map((r) => {
        const model = models.find(
          (m) => m.fact.id === r.fact.modelId && m.source.datasetId === r.source.datasetId,
        );
        return json({
          id: r.fact.id,
          modelId: r.fact.modelId,
          brand: model?.fact.brand ?? null,
          model: model?.fact.model ?? null,
          sizeCode: r.fact.sizeCode,
        });
      });
      return ok({ snapshot, prices: estimates, products });
    });
    if (!read.ok) return read;
    const checkedAt = await ready(read.value.snapshot.recall.datasetId);
    demand(checkedAt, 'unavailable');
    const snapshot = {
      ...read.value.snapshot,
      recall: { ...read.value.snapshot.recall, checkedAt, complete: true },
    };
    const validated = evaluate(input, snapshot);
    demand(validated.ok, 'integrity');
    return ok({ ...read.value, snapshot });
  }
  return {
    async prepare(input, asOf) {
      try {
        return await prepared(input, asOf);
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async current(p) {
      try {
        const r = await reportWork(catalogUow, async (tx) => {
          const pin = await catalog.pin(tx, 'US', null),
            rule = await policies.published(tx, p.snapshot.policy.regionKey);
          return ok(
            !!pin &&
              pin.coverage === 'available' &&
              pin.bundleId === p.snapshot.bundleId &&
              rule?.id === p.snapshot.policy.id &&
              canonical(pin.components.map((c) => [c.source.datasetId, c.source.rights]).sort()) ===
                canonical(p.snapshot.sources.map((s) => [s.datasetId, s.rights]).sort()),
          );
        });
        return r.ok ? ok(r.value && (await ready(p.snapshot.recall.datasetId)) !== null) : r;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async overlay(v, asOf) {
      let historical: string[] = [];
      try {
        const plans = object(v.output.evidence).plans;
        if (Array.isArray(plans))
          historical = [
            ...new Set(
              plans
                .flatMap((p) => [object(object(p).front), object(object(p).rear)])
                .flatMap((s) => {
                  const recall = object(s.recall);
                  return recall.state === 'matched' && Array.isArray(recall.targetRefs)
                    ? recall.targetRefs.filter(
                        (r): r is string =>
                          typeof r === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(r),
                      )
                    : [];
                }),
            ),
          ].sort();
      } catch {
        /* Unreadable historical evidence cannot establish clearance. */
      }
      try {
        demand(instant(asOf).ok, 'integrity');
        const normalized = normalizeAssessment(v.input);
        demand(normalized.ok, 'integrity');
        const evidence = object(v.output.evidence),
          plans = evidence.plans;
        demand(Array.isArray(plans), 'integrity');
        const skuIds = [
            ...new Set(
              plans
                .flatMap((p) => [object(object(p).front).id, object(object(p).rear).id])
                .map((s) => String(s)),
            ),
          ],
          modelIds = [
            ...new Set(
              plans
                .flatMap((p) => [object(object(p).front).modelId, object(object(p).rear).modelId])
                .map(String),
            ),
          ];
        const r = await reportWork(catalogUow, async (tx) => {
          const pin = await catalog.pin(tx, 'US', null);
          if (!pin || pin.coverage !== 'available') return ok(null);
          const recalls = pin.components.filter((c) =>
            ['recall', 'nhtsa-tire-recalls'].includes(c.source.kind),
          );
          if (recalls.length !== 1) return ok(null);
          const targets = [
            ...(await batch(tx, pin, 'recallTargets', 'skuId', skuIds)),
            ...(await batch(tx, pin, 'recallTargets', 'modelId', modelIds)),
          ];
          return ok({
            datasetId: recalls[0]!.source.datasetId,
            targets: targets.filter((t) => t.source.datasetId === recalls[0]!.source.datasetId),
          });
        });
        const unavailable: SafetyOverlay = {
          checkedAt: asOf,
          status: 'unavailable',
          matched: historical,
          unresolved: true,
        };
        if (!r.ok || !r.value || !(await ready(r.value.datasetId))) return ok(unavailable);
        const matched = [
          ...new Set([
            ...historical,
            ...r.value.targets
              .filter((t) => t.fact.matchStatus === 'matched')
              .map((t) => t.fact.sourceTargetId),
          ]),
        ].sort();
        // No catalog match is never clearance. A real clearance contract remains a source gate.
        return ok({
          checkedAt: asOf,
          status: 'review_required',
          matched,
          unresolved: true,
        } as SafetyOverlay);
      } catch {
        return ok({
          checkedAt: asOf,
          status: 'unavailable',
          matched: historical,
          unresolved: true,
        } as SafetyOverlay);
      }
    },
  };
}
