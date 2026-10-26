import { id, integer, instant, revision } from '../../../domain/src/values/core.ts';
import type { Version, Quote, CompareItem } from '../ports/private-records.ts';
import type { PreparedReport, ReportCrypto } from '../ports/report-services.ts';
import type { EngineResult } from '../../../engine/src/model.ts';
import type { QuoteInput, Charge, Item, QuoteEstimate } from '../../../engine/src/pricing/model.ts';
import { estimateQuote } from '../../../engine/src/pricing/quote.ts';
import { compareShopQuote, orderPriceOptions } from '../../../engine/src/pricing/compare.ts';
import { normalizeAssessment } from '../../../engine/src/input.ts';
import { evaluate } from '../../../engine/src/evaluate.ts';
import { sizeCode } from '../../../engine/src/input.ts';
import type { AssessmentInput } from '../../../engine/src/model.ts';
import { demand, exact, json, object } from './report-records.ts';
export function parsePrivateQuote(raw: unknown) {
  const fields =
    'basis,components,currency,expectedRevision,id,observedOn,productText,quantity,shopName,skuId,taxContextConfirmed,taxIncluded,totalMinor';
  const x = exact(
    raw,
    Object.hasOwn(object(raw), 'sizeCode')
      ? fields.split(',').concat('sizeCode').sort().join(',')
      : fields,
  );
  const declaredSize =
    x.sizeCode === null || x.sizeCode === undefined ? null : sizeCode(x.sizeCode);
  demand(x.sizeCode === null || x.sizeCode === undefined || declaredSize !== null);
  const quoteId = x.id === null ? null : id('quote', x.id),
    sku = x.skuId === null ? null : id('tire_sku', x.skuId),
    expected = x.expectedRevision === null ? null : revision(x.expectedRevision),
    total = integer(object(raw).totalMinor, 0n, 1000000000000n);
  // totalMinor is included in the exact wire contract below; there is no floating point money coercion.
  demand(quoteId === null || quoteId.ok);
  demand(sku === null || sku.ok);
  demand(expected === null || expected.ok);
  demand(total.ok);
  demand((quoteId === null) === (expected === null));
  demand(
    x.currency === 'USD' &&
      [1, 2, 4].includes(Number(x.quantity)) &&
      typeof x.quantity === 'number' &&
      ['per_tire', 'set', 'installed_set'].includes(String(x.basis)),
  );
  demand(
    typeof x.productText === 'string' &&
      x.productText.trim().length <= 200 &&
      (sku !== null || x.productText.trim().length > 0),
  );
  demand(x.shopName === null || (typeof x.shopName === 'string' && x.shopName.length <= 200));
  demand(typeof x.observedOn === 'string' && instant(x.observedOn + 'T00:00:00.000Z').ok);
  demand(
    typeof x.taxContextConfirmed === 'boolean' &&
      (x.taxIncluded === null || typeof x.taxIncluded === 'boolean'),
  );
  demand(Array.isArray(x.components) && x.components.length <= 7);
  const components = x.components.map((v) => {
    const c = exact(v, 'basis,included,kind,minor');
    demand(
      [
        'mounting',
        'balancing',
        'tpms_valve',
        'disposal',
        'tax',
        'alignment',
        'required_other',
      ].includes(String(c.kind)) &&
        typeof c.included === 'boolean' &&
        ['per_tire', 'per_axle', 'per_order'].includes(String(c.basis)),
    );
    demand(c.minor === null || integer(c.minor, 0n, 1000000000000n).ok);
    if (c.kind === 'tax' && x.taxIncluded !== null) demand(c.included === x.taxIncluded);
    return json(c);
  });
  demand(new Set(components.map((c) => c.kind)).size === components.length);
  return {
    id: quoteId?.ok ? quoteId.value : null,
    expectedRevision: expected?.ok ? expected.value : null,
    skuId: sku?.ok ? sku.value : null,
    totalMinor: total.value,
    quantity: x.quantity as number,
    basis: x.basis as Quote['basis'],
    observedOn: x.observedOn as string,
    productText: x.productText.trim(),
    shopName: x.shopName as string | null,
    components: [
      json({
        schemaVersion: 1,
        taxContextConfirmed: x.taxContextConfirmed,
        taxIncluded: x.taxIncluded,
        sizeCode: declaredSize,
      }),
      ...components,
    ],
  };
}
function unsafePrivateEstimate(
  q: Quote,
  p: PreparedReport,
  crypto: Pick<ReportCrypto, 'id'>,
  answers: AssessmentInput,
): QuoteEstimate | null {
  const s = p.snapshot,
    meta = q.components[0];
  if (!meta || meta.schemaVersion !== 1 || typeof meta.taxContextConfirmed !== 'boolean')
    return null;
  const known =
    q.skuId !== null && s.plans.some((p) => p.front.id === q.skuId || p.rear.id === q.skuId);
  const selection: Item[] =
    q.quantity === answers.replace.length
      ? (['front', 'rear'] as const).flatMap((axle) => {
          const n = answers.replace.filter((p) => p.startsWith(axle)).length;
          return n ? [{ axle, quantity: n as 1 | 2, skuId: q.skuId }] : [];
        })
      : q.quantity === 4
        ? [
            { axle: 'front', quantity: 2, skuId: q.skuId },
            { axle: 'rear', quantity: 2, skuId: q.skuId },
          ]
        : [{ axle: 'front', quantity: q.quantity as 1 | 2, skuId: q.skuId }];
  const lineId = crypto.id('price', q.id),
    charges: Charge[] = q.components.slice(1).map((v) => ({
      id: crypto.id('price_component', q.id + ':' + v.kind),
      kind: v.kind as Charge['kind'],
      included: v.included === true,
      appliesTo: [lineId],
      amount:
        v.minor === null
          ? null
          : {
              kind: 'fixed',
              basis: v.basis as 'per_tire' | 'per_axle' | 'per_order',
              value: {
                low: BigInt(String(v.minor)),
                high: BigInt(String(v.minor)),
                currency: 'USD',
              },
            },
    }));
  const tax = p.prices.find((x) => x.taxContextId !== null)?.taxContextId ?? null;
  const input: QuoteInput = {
    id: q.id,
    planId: null,
    bundleId: s.bundleId,
    regionKey: s.policy.regionKey,
    asOf: s.asOf,
    retailerId: null,
    taxContextId: meta.taxContextConfirmed ? tax : null,
    assumptionVersion: s.policy.version,
    origin: 'owner_quote',
    ownerAuthorized: true,
    source: null,
    currency: 'USD',
    observedAt: q.observedOn + 'T00:00:00.000Z',
    validUntil: q.expiresAt,
    productKnown: known,
    selection,
    includeAlignment: charges.some((c) => c.kind === 'alignment'),
    lines: [
      {
        id: lineId,
        items: selection,
        basis: q.basis === 'per_tire' ? 'per_tire' : 'per_set',
        quotedQuantity: q.basis === 'per_tire' ? 1 : q.quantity,
        value: { low: q.totalMinor, high: q.totalMinor, currency: 'USD' },
        taxIncluded: meta.taxIncluded as boolean | null,
      },
    ],
    charges,
  };
  const r = estimateQuote(input);
  return r.ok ? r.value : null;
}
function privateEstimate(
  q: Quote,
  p: PreparedReport,
  crypto: Pick<ReportCrypto, 'id'>,
  answers: AssessmentInput,
): QuoteEstimate | null {
  try {
    return unsafePrivateEstimate(q, p, crypto, answers);
  } catch {
    return null;
  }
}
export function buildComparison(
  v: Version,
  prepared: PreparedReport,
  result: EngineResult,
  quotes: readonly Quote[],
  selected: readonly { kind: 'catalog' | 'quote'; key: string }[],
  crypto: Pick<ReportCrypto, 'id'>,
) {
  const old = object(v.output.evidence),
    oldPlans = old.plans;
  demand(Array.isArray(oldPlans), 'integrity');
  const answers = normalizeAssessment(v.input);
  demand(answers.ok, 'integrity');
  const entries = selected.map((item) => {
    if (item.kind === 'quote') {
      const q = quotes.find((q) => q.id === item.key);
      demand(q, 'not_found');
      const price = privateEstimate(q, prepared, crypto, answers.value),
        sku = prepared.snapshot.plans
          .flatMap((p) => [p.front, p.rear])
          .find((s) => s.id === q.skuId),
        base = prepared.snapshot.plans[0];
      let decision: EngineResult['decisions'][number] | undefined;
      if (sku && base && q.quantity === answers.value.replace.length) {
        const plan = {
          ...base,
          id: crypto.id('plan', 'quote:' + q.id),
          front: answers.value.replace.some((p) => p.startsWith('front')) ? sku : base.front,
          rear: answers.value.replace.some((p) => p.startsWith('rear')) ? sku : base.rear,
          cost: null,
          inspection: null,
        };
        const evaluated = evaluate(answers.value, { ...prepared.snapshot, plans: [plan] });
        demand(evaluated.ok, 'integrity');
        decision = evaluated.value.decisions[0];
        if (q.components[0]?.sizeCode && q.components[0].sizeCode !== sku.sizeCode && decision)
          decision = {
            ...decision,
            status: 'blocked',
            reasons: [...new Set([...decision.reasons, 'SIZE_MISMATCH' as const])].sort(),
          };
      }
      return {
        item,
        price,
        decision,
        knownProduct: !!sku,
        fit: decision?.status ?? ('unverified' as const),
      };
    }
    const saved = oldPlans.find((p) => object(p).id === item.key);
    demand(saved, 'not_found');
    const f = object(object(saved).front),
      r = object(object(saved).rear),
      plan = prepared.snapshot.plans.find((p) => p.front.id === f.id && p.rear.id === r.id);
    const decision = result.decisions.find((d) => d.id === plan?.id),
      price = prepared.prices.find((p) => p.planId === plan?.id) ?? null;
    return {
      item,
      price,
      decision,
      knownProduct: !!plan,
      fit: decision?.status ?? ('unverified' as const),
    };
  });
  const anchor = entries.find((e) => e.item.kind === 'catalog' && e.price)?.price;
  const items: CompareItem[] = entries.map((e, index) => {
    const climate =
      e.fit === 'eligible'
        ? ('suitable' as const)
        : e.decision?.reasons.includes('SEASONAL_STRATEGY_MISMATCH')
          ? ('unsuitable' as const)
          : ('unknown' as const);
    const verdict =
      e.item.kind === 'quote'
        ? anchor && e.price
          ? compareShopQuote(anchor, e.price, e.fit, climate, 'installed')
          : {
              fit: e.fit,
              climate,
              relation: 'not_comparable',
              delta: null,
              evidenceMissing: true,
              score: null,
              issuanceAuthorized: false,
            }
        : null;
    return {
      slot: (index + 1) as CompareItem['slot'],
      kind: e.item.kind,
      sourceKey: e.item.kind + ':' + e.item.key,
      snapshot: json({
        productKnown: e.knownProduct,
        fit: e.fit,
        climate,
        reasons: e.decision?.reasons ?? ['PRODUCT_UNVERIFIED'],
        scoreBp: e.item.kind === 'catalog' ? (e.decision?.scoreBp ?? null) : null,
        price: e.price,
        verdict,
        issuanceAuthorized: false,
      }),
    };
  });
  const order = orderPriceOptions(
    entries.filter((e) => e.price !== null).map((e) => ({ quote: e.price!, eligibility: e.fit })),
    'installed',
  );
  return {
    scenario: json({
      asOf: prepared.snapshot.asOf,
      versions: result.versions,
      priceOrder: order,
      ownershipScenario: 'not_requested',
      issuanceAuthorized: false,
    }),
    items,
  };
}
