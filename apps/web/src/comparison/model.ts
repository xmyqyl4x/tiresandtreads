import { money } from '../results/presentation.ts';
import type { Selection } from '@tt/contracts/comparison';
import { quoteInputSchema, type QuoteInput } from '@tt/contracts/quote-input';
import { parseDollarInput } from '../results/presentation.ts';
export interface Choices {
  items: Selection[];
  pending: Selection | null;
}
const equal = (a: Selection, b: Selection) => a.kind === b.kind && a.key === b.key;
export function addChoice(state: Choices, item: Selection): Choices {
  if (state.items.some((x) => equal(x, item))) return state;
  return state.items.length < 4
    ? { items: [...state.items, item], pending: null }
    : { ...state, pending: item };
}
export function replaceChoice(state: Choices, index: number): Choices {
  if (!state.pending || !Number.isInteger(index) || index < 0 || index >= state.items.length)
    throw Error('Choose an existing slot');
  return { items: state.items.map((x, i) => (i === index ? state.pending! : x)), pending: null };
}
export function removeChoice(state: Choices, index: number): Choices {
  if (!Number.isInteger(index) || index < 0 || index >= state.items.length)
    throw Error('Choose an existing slot');
  return { ...state, items: state.items.filter((_, i) => i !== index) };
}
export const chargeNames = {
  mounting: 'Mounting',
  balancing: 'Balancing',
  tpms_valve: 'TPMS / valves',
  disposal: 'Disposal',
  tax: 'Tax',
  alignment: 'Alignment',
  required_other: 'Other required charges',
} as const;
type Kind = keyof typeof chargeNames;
export interface QuoteFields {
  product: string;
  shop: string;
  amount: string;
  quantity: string;
  basis: string;
  size: string;
  observedOn: string;
  taxConfirmed: boolean;
  alignment: boolean;
  charges: Record<
    Kind,
    {
      state: 'unknown' | 'included' | 'extra' | 'zero';
      amount: string;
      basis: 'per_tire' | 'per_axle' | 'per_order';
    }
  >;
}
export function blankQuote(): QuoteFields {
  return {
    product: '',
    shop: '',
    amount: '',
    quantity: '',
    basis: '',
    size: '',
    observedOn: '',
    taxConfirmed: false,
    alignment: false,
    charges: Object.fromEntries(
      Object.keys(chargeNames).map((k) => [
        k,
        { state: 'unknown', amount: '', basis: 'per_order' },
      ]),
    ) as QuoteFields['charges'],
  };
}
export function quoteBody(
  fields: QuoteFields,
): { ok: true; input: QuoteInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {},
    minor = parseDollarInput(fields.amount);
  if (!fields.product.trim() || fields.product.trim().length > 200)
    errors.product = 'Enter the quoted product, up to 200 characters.';
  if (minor === false || minor === null)
    errors.amount = 'Enter the quoted USD amount, with up to two decimal places.';
  if (!['1', '2', '4'].includes(fields.quantity))
    errors.quantity = 'Choose the quoted tire quantity.';
  if (!['per_tire', 'set', 'installed_set'].includes(fields.basis))
    errors.basis = 'Choose what the quoted price includes.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.observedOn))
    errors.observedOn = 'Enter the date of the quote.';
  if (fields.shop.length > 200) errors.shop = 'Use up to 200 characters.';
  const components = (Object.keys(chargeNames) as Kind[])
    .filter((k) => k !== 'alignment' || fields.alignment)
    .map((kind) => {
      const c = fields.charges[kind],
        value = c.state === 'extra' ? parseDollarInput(c.amount) : c.state === 'zero' ? '0' : null;
      if (c.state === 'extra' && (value === false || value === null))
        errors['extra-' + kind] = 'Enter the extra amount, including explicit zero if applicable.';
      return {
        kind,
        included: c.state === 'included',
        basis: c.basis,
        minor: value === false ? null : value,
      };
    });
  if (Object.keys(errors).length) return { ok: false, errors };
  const parsed = quoteInputSchema.safeParse({
    id: null,
    expectedRevision: null,
    skuId: null,
    productText: fields.product.trim(),
    shopName: fields.shop.trim() || null,
    currency: 'USD',
    totalMinor: minor,
    quantity: Number(fields.quantity),
    basis: fields.basis,
    sizeCode: fields.size.trim() || null,
    observedOn: fields.observedOn,
    taxContextConfirmed: fields.taxConfirmed,
    taxIncluded:
      fields.charges.tax.state === 'included'
        ? true
        : fields.charges.tax.state === 'unknown'
          ? null
          : false,
    components,
  });
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, errors: { quote: 'Review the quote fields and lengths.' } };
}
export function shareReference(origin: string, token: string) {
  if (
    !/^share\.[a-zA-Z0-9_-]{1,100}\.[0-9a-f-]{36}\.[a-f0-9]{64}$/.test(token) ||
    token.length > 256
  )
    throw Error('Invalid share reference');
  return new URL('/preview/shared#' + encodeURIComponent(token), origin).href;
}
export function existingShare(origin: string, raw: string) {
  try {
    const u = new URL(raw);
    if (u.origin !== new URL(origin).origin || u.pathname !== '/preview/shared' || u.search)
      return null;
    const token = decodeURIComponent(u.hash.slice(1));
    shareReference(origin, token);
    return { token, capability: token.split('.')[2]! };
  } catch {
    return null;
  }
}

export function quotedDifference(
  value: { lowMinor: string; highMinor: string; currency: 'USD' } | null,
) {
  if (!value) return 'Unavailable';
  const signed = (n: string) =>
    /^-?\d{1,19}$/.test(n)
      ? n.startsWith('-')
        ? '-' + money(n.slice(1))
        : money(n)
      : 'Unavailable';
  return (
    signed(value.lowMinor) +
    (value.lowMinor === value.highMinor ? '' : ' to ' + signed(value.highMinor)) +
    ' USD'
  );
}
