import type { Instant } from './core.ts';
// Proleptic Gregorian UTC arithmetic over already validated instants. No implicit clock.
// The epoch is 0001-01-01; differences fit exact JS integers throughout the Instant range.
export function instantMilliseconds(value: Instant): number {
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    previous = year - 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const days =
    365 * previous +
    Math.floor(previous / 4) -
    Math.floor(previous / 100) +
    Math.floor(previous / 400) +
    monthDays[month - 1]! +
    (leap && month > 2 ? 1 : 0) +
    Number(value.slice(8, 10)) -
    1;
  return (
    days * 86400000 +
    Number(value.slice(11, 13)) * 3600000 +
    Number(value.slice(14, 16)) * 60000 +
    Number(value.slice(17, 19)) * 1000 +
    Number(value.slice(20, 23))
  );
}
