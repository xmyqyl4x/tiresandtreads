import { ok, invalid, instant, type Result } from './values/core.ts';
import { instantMilliseconds } from './values/time.ts';
import { partnerDomain } from './partner-policy.ts';
function day(v: unknown): number {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return NaN;
  const stamp = instant(v + 'T00:00:00.000Z');
  return stamp.ok ? instantMilliseconds(stamp.value) - 62135596800000 : NaN;
}
export function completedWeek(v: unknown, now: number): Result<string> {
  const n = day(v);
  return Number.isFinite(now) &&
    Number.isFinite(n) &&
    (((n / 86400000 + 3) % 7) + 7) % 7 === 0 &&
    n + 7 * 86400000 <= now &&
    n >= now - 395 * 86400000
    ? ok(v as string)
    : invalid('completed_week');
}
// Every cell counts distinct people, not summed daily uniques. Suppress all cells,
// including totals, when either a positive cell or its positive complement is small.
export function suppressCells(cohort: bigint, cells: Readonly<Record<string, bigint>>) {
  if (cohort < 0n || Object.values(cells).some((n) => n < 0n || n > cohort))
    throw Error('Invalid aggregate');
  if (
    cohort < 50n ||
    Object.values(cells).some((n) => (n > 0n && n < 50n) || (cohort - n > 0n && cohort - n < 50n))
  )
    return Object.freeze({ state: 'suppressed' as const, cells: null });
  return Object.freeze({
    state: 'available' as const,
    cells: Object.freeze(
      Object.fromEntries(Object.entries(cells).map(([k, n]) => [k, n.toString()])),
    ),
  });
}
export interface DomainSample {
  readonly domain: string;
  readonly source: 'google_postmaster' | 'microsoft_snds';
  readonly day: string;
  readonly status: 'available' | 'unavailable';
  readonly reputation: 'high' | 'medium' | 'low' | 'bad' | null;
  readonly spamBasisPoints: number | null;
  readonly sampleSize: number | null;
}
export function domainSample(v: unknown, now: number): Result<DomainSample> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid('domain_sample');
  const r = v as Record<string, unknown>,
    d = partnerDomain(r.domain),
    at = day(r.day);
  if (
    !Number.isFinite(now) ||
    !d.ok ||
    Object.keys(r).sort().join(',') !==
      'day,domain,reputation,sampleSize,source,spamBasisPoints,status' ||
    !['google_postmaster', 'microsoft_snds'].includes(String(r.source)) ||
    !['available', 'unavailable'].includes(String(r.status)) ||
    !Number.isFinite(at) ||
    at > now ||
    at < now - 30 * 86400000 ||
    !(r.reputation === null || ['high', 'medium', 'low', 'bad'].includes(String(r.reputation))) ||
    !(
      r.spamBasisPoints === null ||
      (Number.isInteger(r.spamBasisPoints) &&
        Number(r.spamBasisPoints) >= 0 &&
        Number(r.spamBasisPoints) <= 10000)
    ) ||
    !(
      r.sampleSize === null ||
      (Number.isSafeInteger(r.sampleSize) &&
        Number(r.sampleSize) >= 1 &&
        Number(r.sampleSize) <= 1000000000)
    ) ||
    (r.status === 'unavailable' &&
      [r.reputation, r.spamBasisPoints, r.sampleSize].some((x) => x !== null)) ||
    (r.status === 'available' && r.sampleSize === null)
  )
    return invalid('domain_sample');
  return ok(Object.freeze({ ...r, domain: d.value }) as unknown as DomainSample);
}
