const dollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
  date = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
export function money(minor: string) {
  if (!/^\d{1,19}$/.test(minor)) return 'Unavailable';
  const n = BigInt(minor);
  return '$' + dollars.format(n / 100n) + '.' + (n % 100n).toString().padStart(2, '0');
}
export function when(value: string) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? date.format(d) + ' UTC' : 'Date unavailable';
}
export function range(value: { low: string; high: string; currency: 'USD' } | null | undefined) {
  return value
    ? (value.low === value.high ? money(value.low) : money(value.low) + '–' + money(value.high)) +
        ' USD'
    : 'Unavailable';
}
const reasons: Record<string, string> = {
  FITMENT_VERIFIED: 'The stored fitment reference was verified.',
  FITMENT_UNCONFIRMED: 'Fitment remains unconfirmed.',
  FITMENT_CONSTRAINT_UNKNOWN: 'A fitment requirement is unknown.',
  FITMENT_SIZE_CONFLICT: 'The supplied sizes conflict with the fitment reference.',
  WHEEL_PACKAGE_UNCONFIRMED: 'The wheel package remains unconfirmed.',
  SIZE_MISMATCH: 'The tire size does not match the required size.',
  RIM_MISMATCH: 'The rim size does not match.',
  CONSTRUCTION_MISMATCH: 'The tire construction does not match.',
  INSUFFICIENT_LOAD: 'The recorded load requirement is not met.',
  INSUFFICIENT_SPEED: 'The recorded speed requirement is not met.',
  LOAD_RANGE_MISMATCH: 'The load range does not match.',
  XL_REQUIRED: 'The recorded requirement calls for XL tires.',
  RUN_FLAT_REQUIRED: 'The recorded requirement calls for run-flat tires.',
  SOURCE_UNAVAILABLE: 'Required source data is unavailable.',
  POLICY_REVIEW_REQUIRED: 'The policy needs review.',
  REGIONAL_POLICY_UNCONFIRMED: 'Regional policy is not confirmed.',
  CLIMATE_UNKNOWN: 'Climate suitability is unknown.',
  SEASONAL_POLICY_UNKNOWN: 'The seasonal policy is unknown.',
  SEASONAL_STRATEGY_MISMATCH: 'The seasonal strategy does not match.',
  WINTER_MARK_REQUIRED: 'The required winter marking is missing.',
  WINTER_MARK_UNKNOWN: 'The winter marking is unknown.',
  MARKET_UNAVAILABLE: 'The product is unavailable in this market.',
  AVAILABILITY_UNKNOWN: 'Availability is unknown.',
  RECALL_MATCHED: 'A recall match requires review.',
  RECALL_REVIEW_REQUIRED: 'Recall evidence requires review.',
  RECALL_STALE: 'The recall evidence is stale.',
  REPLACEMENT_POLICY_UNKNOWN: 'The replacement policy is unknown.',
  REPLACEMENT_PATTERN_UNAPPROVED: 'The replacement pattern has not been approved.',
  MODEL_MIX_UNAPPROVED: 'This model combination has not been approved.',
  INSPECTION_REQUIRED: 'An inspection is required.',
  RETAINED_TIRE_CONDITION: 'The condition of retained tires is unresolved.',
  REPLACEMENT_MEASUREMENTS_UNKNOWN: 'Replacement measurements are unknown.',
  TREAD_DIFFERENCE_EXCEEDED: 'The recorded tread-difference limit is exceeded.',
  CIRCUMFERENCE_DIFFERENCE_EXCEEDED: 'The recorded circumference-difference limit is exceeded.',
  EVIDENCE_MISSING: 'Some comparison evidence is missing.',
  EVIDENCE_NOT_COMPARABLE: 'The evidence is not comparable.',
  PREFERENCE_SCORE: 'The preference score uses the recorded comparison evidence.',
  PRIORITY_UNSUPPORTED: 'A selected priority is unsupported by the evidence.',
  ABOVE_BUDGET: 'This option is above the stated budget.',
  BUDGET_UNVERIFIED: 'The budget comparison is unverified.',
};
export function reason(code: string) {
  return reasons[code] ?? 'Additional evidence needs review.';
}
export function confidence(value: number | null | undefined) {
  return value === 3 ? 'High' : value === 2 ? 'Medium' : value === 1 ? 'Low' : 'Unknown';
}

export function showDollarInput(minor: string | undefined) {
  if (!minor || !/^\d{1,19}$/.test(minor)) return '';
  const n = BigInt(minor);
  return (n / 100n).toString() + '.' + (n % 100n).toString().padStart(2, '0');
}
export function parseDollarInput(text: string): string | null | false {
  const s = text.trim();
  if (!s) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return false;
  const [d, c = ''] = s.split('.');
  return (BigInt(d!) * 100n + BigInt(c.padEnd(2, '0'))).toString();
}
