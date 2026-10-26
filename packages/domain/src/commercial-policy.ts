import { id, instant } from './values/core.ts';
export const adRoutes = ['education', 'glossary', 'tire_model', 'tire_size'] as const;
export type AdRoute = (typeof adRoutes)[number];
export interface AdSlot {
  readonly key: string;
  readonly route: AdRoute;
  readonly width: number;
  readonly height: number;
  readonly housePath: string;
  readonly houseLabel: string;
}
export interface CommercialPolicy {
  readonly schemaVersion: 1;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly accountId: string | null;
  readonly adsTxt: readonly string[];
  readonly blockedCategories: readonly string[];
  readonly blockedUrls: readonly string[];
  readonly slots: readonly AdSlot[];
}
export interface AdSignals {
  readonly consent: boolean;
  readonly cmpAvailable: boolean;
  readonly gpc: boolean;
  readonly under13: boolean;
  readonly internal: boolean;
  readonly blocked: boolean;
  readonly filled: boolean;
}
function requireValue(value: unknown): asserts value {
  if (!value) throw Error('Invalid commercial value');
}
function exact(value: unknown, fields: string): asserts value is Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(
    Object.keys(value as object)
      .sort()
      .join(',') === fields,
  );
}
export function adRoute(path: string): AdRoute | null {
  const match =
    /^\/(learn|guides|glossary|tires\/models|tires\/sizes)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(path);
  return !match
    ? null
    : match[1] === 'glossary'
      ? 'glossary'
      : match[1] === 'tires/models'
        ? 'tire_model'
        : match[1] === 'tires/sizes'
          ? 'tire_size'
          : 'education';
}
export function commercialPolicy(raw: unknown): CommercialPolicy {
  exact(
    raw,
    'accountId,adsTxt,blockedCategories,blockedUrls,expiresAt,issuedAt,schemaVersion,slots',
  );
  requireValue(raw.schemaVersion === 1 && instant(raw.issuedAt).ok && instant(raw.expiresAt).ok);
  const start = utcMilliseconds(raw.issuedAt as string),
    end = utcMilliseconds(raw.expiresAt as string);
  requireValue(end > start && end - start <= 86400000);
  requireValue(raw.accountId === null || id('ad_account', raw.accountId).ok);
  requireValue(Array.isArray(raw.adsTxt) && raw.adsTxt.length <= 50);
  for (const line of raw.adsTxt)
    requireValue(
      typeof line === 'string' &&
        /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}, [A-Za-z0-9_-]{1,100}, (DIRECT|RESELLER)(, [a-f0-9]{16})?$/.test(
          line,
        ),
    );
  requireValue(raw.accountId !== null || raw.adsTxt.length === 0);
  requireValue(new Set(raw.adsTxt).size === raw.adsTxt.length);
  requireValue(
    Array.isArray(raw.blockedCategories) &&
      raw.blockedCategories.length <= 100 &&
      raw.blockedCategories.every(
        (c) => typeof c === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(c),
      ),
  );
  requireValue(
    Array.isArray(raw.blockedUrls) &&
      raw.blockedUrls.length <= 100 &&
      raw.blockedUrls.every(
        (u) =>
          typeof u === 'string' &&
          /^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}(?:\/[a-zA-Z0-9/_-]*)?$/.test(u) &&
          u.length <= 2048,
      ),
  );
  requireValue(
    new Set(raw.blockedCategories).size === raw.blockedCategories.length &&
      new Set(raw.blockedUrls).size === raw.blockedUrls.length,
  );
  requireValue(Array.isArray(raw.slots) && raw.slots.length <= 8);
  const keys = new Set<string>();
  const counts = new Map<string, number>();
  for (const slot of raw.slots) {
    exact(slot, 'height,houseLabel,housePath,key,route,width');
    requireValue(
      typeof slot.key === 'string' &&
        /^[a-z][a-z0-9_]{0,63}$/.test(slot.key) &&
        !keys.has(slot.key),
    );
    keys.add(slot.key);
    requireValue(adRoutes.includes(slot.route as AdRoute));
    counts.set(String(slot.route), (counts.get(String(slot.route)) ?? 0) + 1);
    requireValue(counts.get(String(slot.route))! <= 2);
    requireValue(
      Number.isInteger(slot.width) &&
        Number(slot.width) >= 100 &&
        Number(slot.width) <= 1200 &&
        Number.isInteger(slot.height) &&
        Number(slot.height) >= 50 &&
        Number(slot.height) <= 600,
    );
    requireValue(typeof slot.housePath === 'string' && adRoute(slot.housePath) !== null);
    requireValue(
      typeof slot.houseLabel === 'string' && /^[\p{L}\p{N} ,.'!?-]{1,100}$/u.test(slot.houseLabel),
    );
  }
  return structuredClone(raw) as unknown as CommercialPolicy;
}
export function placement(
  policy: CommercialPolicy,
  path: string,
  signals: AdSignals,
  activated: boolean,
  networkReady: boolean,
) {
  exact(signals, 'blocked,cmpAvailable,consent,filled,gpc,internal,under13');
  requireValue(Object.values(signals).every((s) => typeof s === 'boolean'));
  const route = adRoute(path);
  if (!route || signals.under13) return [];
  const external =
    activated &&
    networkReady &&
    signals.consent &&
    signals.cmpAvailable &&
    !signals.gpc &&
    !signals.internal &&
    !signals.blocked &&
    signals.filled &&
    policy.blockedCategories.length === 0 &&
    policy.blockedUrls.length === 0;
  return policy.slots
    .filter((s) => s.route === route)
    .map((s) => ({
      ...s,
      mode: external ? ('external' as const) : ('house' as const),
      label: external ? 'Advertisements' : 'From Tires & Tread',
      refreshSeconds: null,
    }));
}
export function affiliateDestination(value: string, approvedOrigin: string): string {
  requireValue(
    typeof value === 'string' &&
      value.length <= 2048 &&
      !/[\\\s]/.test(value) &&
      !Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
  );
  const url = new URL(value),
    origin = new URL(approvedOrigin);
  requireValue(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.origin === origin.origin &&
      approvedOrigin === origin.origin &&
      (!url.port || url.port === '443'),
  );
  requireValue(
    !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(
      url.hostname,
    ),
  );
  for (const [key, v] of url.searchParams)
    requireValue(
      ['ref', 'aff', 'affiliate', 'aid', 'campaign'].includes(key) &&
        /^[A-Za-z0-9_-]{1,100}$/.test(v),
    );
  return url.href;
}
export interface AdMetric {
  readonly day: string;
  readonly dimension: string;
  readonly currency: string;
  readonly impressions: string;
  readonly eligibleRequests: string | null;
  readonly revenueMinor: string;
  readonly revenueStatus: 'estimated' | 'finalized';
  readonly viewableImpressions: string | null;
  readonly consentRequests: string | null;
  readonly totalRequests: string | null;
  readonly latencySamples: string | null;
  readonly latencyTotalMs: string | null;
}
export interface AdReport {
  readonly accountId: string;
  readonly start: string;
  readonly end: string;
  readonly sourceRevision: string;
  readonly sourceGeneration: string;
  readonly fetchedAt: string;
  readonly rows: readonly AdMetric[];
}
export function commercialDay(day: unknown): string {
  requireValue(
    typeof day === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      instant(day + 'T00:00:00.000Z').ok,
  );
  return day;
}
// UTC arithmetic keeps domain policy independent of the host clock and timezone.
function utcMilliseconds(iso: string): number {
  const [year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0] = iso
    .match(/\d+/g)!
    .map(Number);
  const y = year! - 1;
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const preceding = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][month! - 1]!;
  const days =
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) +
    preceding +
    (leap && month! > 2 ? 1 : 0) +
    day! -
    1;
  return ((days * 24 + hour) * 60 + minute) * 60000 + second * 1000 + millisecond;
}
function count(n: unknown, max = 9223372036854775807n): bigint {
  requireValue(typeof n === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(n));
  const b = BigInt(n);
  requireValue(b <= max);
  return b;
}
export function adReport(raw: unknown): AdReport {
  exact(raw, 'accountId,end,fetchedAt,rows,sourceGeneration,sourceRevision,start');
  requireValue(id('ad_account', raw.accountId).ok);
  const start = commercialDay(raw.start),
    end = commercialDay(raw.end);
  requireValue(instant(raw.fetchedAt).ok && end <= (raw.fetchedAt as string).slice(0, 10));
  requireValue(start <= end && utcMilliseconds(end) - utcMilliseconds(start) <= 366 * 86400000);
  requireValue(
    typeof raw.sourceRevision === 'string' &&
      /^[A-Za-z0-9_.:-]{1,200}$/.test(raw.sourceRevision) &&
      count(raw.sourceGeneration) > 0n,
  );
  requireValue(Array.isArray(raw.rows) && raw.rows.length <= 1000);
  const keys = new Set<string>();
  for (const row of raw.rows) {
    exact(
      row,
      'consentRequests,currency,day,dimension,eligibleRequests,impressions,latencySamples,latencyTotalMs,revenueMinor,revenueStatus,totalRequests,viewableImpressions',
    );
    const day = commercialDay(row.day);
    requireValue(
      day >= start &&
        day <= end &&
        typeof row.currency === 'string' &&
        /^[A-Z]{3}$/.test(row.currency),
    );
    requireValue(
      row.dimension === 'all' ||
        (typeof row.dimension === 'string' &&
          /^(page|slot):[a-f0-9-]{36}$/.test(row.dimension) &&
          id('dimension', row.dimension.slice(5)).ok),
    );
    const key = [day, row.dimension, row.currency].join(':');
    requireValue(!keys.has(key));
    keys.add(key);
    const impressions = count(row.impressions);
    requireValue(row.eligibleRequests === null || count(row.eligibleRequests) >= impressions);
    requireValue(
      typeof row.revenueMinor === 'string' &&
        /^-?(0|[1-9][0-9]{0,12})$/.test(row.revenueMinor) &&
        BigInt(row.revenueMinor) >= -1000000000000n &&
        BigInt(row.revenueMinor) <= 1000000000000n &&
        ['estimated', 'finalized'].includes(String(row.revenueStatus)),
    );
    requireValue(row.viewableImpressions === null || count(row.viewableImpressions) <= impressions);
    requireValue((row.consentRequests === null) === (row.totalRequests === null));
    if (row.totalRequests !== null)
      requireValue(count(row.consentRequests) <= count(row.totalRequests));
    requireValue((row.latencySamples === null) === (row.latencyTotalMs === null));
    if (row.latencySamples !== null) {
      const samples = count(row.latencySamples);
      const ms = count(row.latencyTotalMs);
      requireValue(samples > 0n && ms <= samples * 60000n);
    }
  }
  return structuredClone(raw) as unknown as AdReport;
}
