import { id, instant } from '../../../domain/src/values/core.ts';
import { instantMilliseconds } from '../../../domain/src/values/time.ts';
import { current } from '../evidence.ts';
import {
  amount,
  boundary,
  checked,
  plus,
  percentage,
  rate,
  requirePrice,
  times,
} from './arithmetic.ts';
import type { Amount, Charge, Item, QuoteInput, QuoteEstimate, PriceReason } from './model.ts';
import type { Source } from '../model.ts';
export function selectionKey(items: readonly Item[]) {
  return [...items]
    .map((i) => `${i.axle}:${i.skuId ?? 'unknown'}:${i.quantity}`)
    .sort()
    .join('|');
}
export function allowedSource(source: Source, asOf: string) {
  return (
    source.kind === 'catalog' &&
    source.market === 'US' &&
    current(source.fetchedAt, source.validUntil, asOf) &&
    ['display', 'api', 'cache', 'derived', 'snapshot'].every(
      (k) => source.rights[k as keyof typeof source.rights] === true,
    )
  );
}
function validateItems(items: readonly Item[]) {
  requirePrice(items.length > 0 && items.length <= 2, 'items');
  requirePrice(new Set(items.map((i) => i.axle)).size === items.length, 'items');
  for (const i of items)
    requirePrice(
      ['front', 'rear'].includes(i.axle) &&
        [1, 2].includes(i.quantity) &&
        (i.skuId === null || id('sku', i.skuId).ok),
      'items',
    );
}
export function estimateQuote(q: QuoteInput) {
  return boundary(() => {
    requirePrice(
      [
        q.id,
        q.bundleId,
        ...[q.retailerId, q.taxContextId].filter((v) => v !== null),
        ...(q.source ? [q.source.datasetId, q.source.providerId, q.source.licenseId] : []),
      ].every((v) => id('price_reference', v).ok) &&
        (q.planId === null || id('plan', q.planId).ok),
      'price_identity',
    );
    requirePrice(
      (q.origin === 'licensed_feed' && q.source !== null) ||
        (q.origin === 'owner_quote' && q.source === null),
      'price_origin',
    );
    requirePrice(
      q.currency === 'USD' &&
        /^[A-Z0-9_-]{1,80}$/.test(q.regionKey) &&
        /^[A-Za-z0-9_.-]{1,80}$/.test(q.assumptionVersion),
      'price_scope',
    );
    requirePrice(
      typeof q.productKnown === 'boolean' &&
        typeof q.ownerAuthorized === 'boolean' &&
        typeof q.includeAlignment === 'boolean',
      'price_flags',
    );
    const now = instant(q.asOf),
      observed = instant(q.observedAt);
    requirePrice(
      now.ok &&
        observed.ok &&
        q.observedAt <= q.asOf &&
        (q.validUntil === null || (instant(q.validUntil).ok && q.validUntil >= q.observedAt)),
      'price_time',
    );
    validateItems(q.selection);
    const quantity = q.selection.reduce((s, i) => s + i.quantity, 0);
    requirePrice(
      [1, 2, 4].includes(quantity) && q.lines.length <= 4 && q.charges.length <= 32,
      'price_bound',
    );
    requirePrice(
      new Set(q.lines.map((l) => l.id)).size === q.lines.length &&
        new Set(q.charges.map((c) => c.id)).size === q.charges.length,
      'duplicate_price',
    );
    const reasons = new Set<PriceReason>();
    if (!q.productKnown) reasons.add('PRODUCT_UNVERIFIED');
    if (q.productKnown)
      requirePrice(
        q.selection.every((i) => i.skuId !== null),
        'product_identity',
      );
    const age = instantMilliseconds(now.value) - instantMilliseconds(observed.value);
    const permitted =
      q.origin === 'owner_quote'
        ? q.ownerAuthorized
        : q.source !== null && allowedSource(q.source, q.asOf);
    const freshness: QuoteEstimate['freshness'] = !permitted
      ? 'unavailable'
      : age >= 7 * 86400000 || (q.validUntil !== null && q.validUntil <= q.asOf)
        ? 'expired'
        : age >= 48 * 3600000
          ? 'stale'
          : 'fresh';
    if (freshness === 'stale') reasons.add('PRICE_STALE');
    if (freshness === 'expired') reasons.add('PRICE_EXPIRED');
    if (freshness === 'unavailable') reasons.add('SOURCE_UNAVAILABLE');
    const until = q.source
      ? [q.source.validUntil, q.validUntil ?? q.source.validUntil].sort()[0]!
      : q.validUntil;
    const base = {
      mathVersion: '1.0.0' as const,
      issuanceAuthorized: false as const,
      id: q.id,
      planId: q.planId,
      bundleId: q.bundleId,
      regionKey: q.regionKey,
      asOf: q.asOf,
      origin: q.origin,
      sourceId: q.source?.datasetId ?? null,
      retailerId: q.retailerId,
      taxContextId: q.taxContextId,
      assumptionVersion: q.assumptionVersion,
      observedAt: q.observedAt,
      validUntil: until,
      currency: 'USD' as const,
      productKnown: q.productKnown,
      selection: Object.freeze(
        [...q.selection]
          .sort((a, b) => (a.axle < b.axle ? -1 : 1))
          .map((i) => Object.freeze({ ...i })),
      ),
      quantity,
      includeAlignment: q.includeAlignment,
      freshness,
      currentPriceClaim: freshness === 'fresh',
    };
    if (freshness === 'expired' || freshness === 'unavailable')
      return Object.freeze({
        ...base,
        merchandise: null,
        installed: null,
        optionalAlignment: null,
        reasons: Object.freeze([...reasons].sort()),
        charges: Object.freeze([]),
      }) satisfies QuoteEstimate;
    const lines = new Map<
      string,
      { value: Amount | null; items: readonly Item[]; taxIncluded: boolean | null }
    >();
    for (const l of q.lines) {
      requirePrice(id('price', l.id).ok, 'price_identity');
      validateItems(l.items);
      requirePrice(
        l.items.every((i) =>
          q.selection.some(
            (s) => s.axle === i.axle && s.skuId === i.skuId && i.quantity <= s.quantity,
          ),
        ),
        'selection',
      );
      const count = l.items.reduce((s, i) => s + i.quantity, 0);
      requirePrice(
        Number.isSafeInteger(l.quotedQuantity) && l.quotedQuantity > 0 && l.quotedQuantity <= 4,
        'quantity_basis',
      );
      requirePrice(
        (l.basis === 'per_tire' && l.quotedQuantity === 1) ||
          (l.basis === 'per_axle' &&
            l.quotedQuantity === 2 &&
            l.items.every((i) => i.quantity === 2)) ||
          (l.basis === 'per_set' && l.quotedQuantity === count),
        'quantity_basis',
      );
      requirePrice(count % l.quotedQuantity === 0, 'quantity_basis');
      lines.set(l.id, {
        value: l.value === null ? null : times(checked(l.value), BigInt(count / l.quotedQuantity)),
        items: l.items,
        taxIncluded: l.taxIncluded,
      });
    }
    const covered = [...lines.values()].flatMap((l) => l.items);
    requirePrice(
      q.selection.every(
        (s) =>
          covered
            .filter((i) => i.axle === s.axle && i.skuId === s.skuId)
            .reduce((n, i) => n + i.quantity, 0) <= s.quantity,
      ),
      'duplicate_quantity',
    );
    const complete = q.selection.every(
      (s) =>
        covered
          .filter((i) => i.axle === s.axle && i.skuId === s.skuId)
          .reduce((n, i) => n + i.quantity, 0) === s.quantity,
    );
    const merchandise =
      complete && [...lines.values()].every((l) => l.value !== null)
        ? plus([...lines.values()].map((l) => l.value!))
        : null;
    if (!merchandise) reasons.add('PRICE_MISSING');
    const charges = new Map(q.charges.map((c) => [c.id, c])),
      memo = new Map<string, Amount | null>(),
      visiting = new Set<string>();
    for (const c of q.charges) {
      requirePrice(
        id('price_component', c.id).ok &&
          typeof c.included === 'boolean' &&
          [
            'mounting',
            'balancing',
            'tpms_valve',
            'disposal',
            'tax',
            'alignment',
            'required_other',
          ].includes(c.kind) &&
          c.appliesTo.length > 0 &&
          c.appliesTo.length <= 4 &&
          new Set(c.appliesTo).size === c.appliesTo.length &&
          c.appliesTo.every((v) => lines.has(v)),
        'component_scope',
      );
      if (c.kind === 'tax')
        for (const key of c.appliesTo) {
          const l = lines.get(key)!;
          if (l.taxIncluded === null) reasons.add('TAX_UNCONFIRMED');
          else requirePrice(l.taxIncluded === c.included, 'tax_inclusion');
        }
    }
    function charge(c: Charge): Amount | null {
      if (memo.has(c.id)) return memo.get(c.id)!;
      requirePrice(!visiting.has(c.id), 'component_cycle');
      visiting.add(c.id);
      let value: Amount | null;
      if (c.included) value = amount(0n);
      else if (!c.amount) value = null;
      else if (c.amount.kind === 'fixed') {
        requirePrice(
          ['per_tire', 'per_axle', 'per_order'].includes(c.amount.basis),
          'component_basis',
        );
        const items = c.appliesTo.flatMap((k) => lines.get(k)!.items);
        const n =
          c.amount.basis === 'per_tire'
            ? items.reduce((s, i) => s + i.quantity, 0)
            : c.amount.basis === 'per_axle'
              ? new Set(items.map((i) => i.axle)).size
              : 1;
        value = times(checked(c.amount.value), BigInt(n));
      } else {
        const a = c.amount;
        requirePrice(
          a.kind === 'percentage' &&
            ['tire_subtotal', 'taxable_subtotal', 'order_subtotal'].includes(a.basis) &&
            ['per_line', 'per_order'].includes(a.rounding) &&
            a.baseChargeIds.length <= 32 &&
            new Set(a.baseChargeIds).size === a.baseChargeIds.length &&
            (a.basis !== 'tire_subtotal' || a.baseChargeIds.length === 0),
          'percentage_basis',
        );
        for (const key of a.baseChargeIds) {
          const other = charges.get(key);
          requirePrice(
            other &&
              other.appliesTo.every((k) => c.appliesTo.includes(k)) &&
              (other.kind !== 'alignment' || q.includeAlignment),
            'tax_base',
          );
        }
        requirePrice(a.rounding !== 'per_line' || a.baseChargeIds.length === 0, 'rounding_scope');
        const r = rate(a.rate),
          parts = [
            ...c.appliesTo.map((k) => lines.get(k)!.value),
            ...a.baseChargeIds.map((k) => charge(charges.get(k)!)),
          ];
        value = parts.some((v) => v === null)
          ? null
          : a.rounding === 'per_line'
            ? plus(parts.map((v) => percentage(v!, r)))
            : percentage(plus(parts as Amount[]), r);
      }
      visiting.delete(c.id);
      memo.set(c.id, value);
      return value;
    }
    for (const c of q.charges) charge(c);
    const required = [
      'mounting',
      'balancing',
      'tpms_valve',
      'disposal',
      'tax',
      ...(q.includeAlignment ? ['alignment'] : []),
    ];
    let costComplete = !!merchandise && !reasons.has('TAX_UNCONFIRMED');
    for (const line of q.lines)
      for (const kind of required) {
        const matches = q.charges.filter((c) => c.kind === kind && c.appliesTo.includes(line.id));
        requirePrice(matches.length <= 1, 'duplicate_component');
        if (matches.length !== 1 || charge(matches[0]!) === null) costComplete = false;
      }
    const extras = q.charges
      .filter((c) => c.kind !== 'alignment' || q.includeAlignment)
      .map(charge);
    if (extras.some((v) => v === null)) costComplete = false;
    if (!costComplete) reasons.add('REQUIRED_COST_UNKNOWN');
    const installed = costComplete ? plus([merchandise!, ...(extras as Amount[])]) : null;
    const align = q.charges.filter((c) => c.kind === 'alignment').map(charge),
      optionalAlignment =
        align.length && align.every((v) => v !== null) ? plus(align as Amount[]) : null;
    return Object.freeze({
      ...base,
      currentPriceClaim: freshness === 'fresh' && merchandise !== null,
      merchandise,
      installed,
      optionalAlignment,
      reasons: Object.freeze([...reasons].sort()),
      charges: Object.freeze(
        [...q.charges]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((c) => Object.freeze({ id: c.id, kind: c.kind, additional: charge(c) })),
      ),
    }) satisfies QuoteEstimate;
  });
}
