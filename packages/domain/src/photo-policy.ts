import { ok, invalid, known, unknown, instant, type Result } from './values/core.ts';
import { tireSize } from './values/tire.ts';
import { quantity } from './values/units.ts';
import type { PhotoField, PhotoCandidate } from './entities/photo.ts';
function unsafeText(value: string) {
  return (
    /[<>]/.test(value) ||
    Array.from(value).some((c) => {
      const n = c.charCodeAt(0);
      return n < 32 || n === 127;
    })
  );
}
export const photoFields: readonly PhotoField[] = Object.freeze([
  'brand',
  'model',
  'tire_size',
  'load_index',
  'speed_rating',
  'dot_tin',
  'date_code',
  'seasonal_marking',
  'run_flat_marking',
]);
export function imageMime(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x))
    return 'image/png';
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
// The same ordinary shape validator is used for suggestions and explicit manual/corrected entry.
// Neither a shape match nor confirmation establishes fitment, condition, recall status or authenticity.
export function photoFieldValue(field: unknown, raw: unknown, now: string): Result<string> {
  if (
    typeof field !== 'string' ||
    !photoFields.includes(field as PhotoField) ||
    typeof raw !== 'string' ||
    raw.length < 1 ||
    raw.length > 160 ||
    unsafeText(raw)
  )
    return invalid('photo_field');
  const text = raw.trim().normalize('NFC'),
    code = text.toUpperCase();
  if (field === 'brand' || field === 'model')
    return text.length >= 1 && text.length <= 80 && /^[\p{L}\p{N} &.,+'()/-]+$/u.test(text)
      ? ok(text)
      : invalid('photo_field');
  if (field === 'tire_size') {
    const normalized = code.replaceAll(' ', ''),
      m = /^(P|LT)?([1-9][0-9]{2})\/([1-9][0-9]{1,2})(ZR|R)([1-9][0-9](?:\.[05])?)(C)?$/.exec(
        normalized,
      );
    if (!m) {
      const alternative =
        /^(?:LT)?(?:[1-9][0-9](?:\.[0-9]{1,2})?X[1-9][0-9]?(?:\.[0-9]{1,2})?|[1-9][0-9]{2}|[1-9](?:\.[0-9]{1,2})?)(?:R|D|B)([1-9][0-9](?:\.[05])?)(?:LT|C)?$/.exec(
          normalized,
        );
      if (!alternative) return invalid('tire_size');
      const rim = quantity(alternative[1], 'inch');
      if (!rim.ok) return invalid('tire_size');
      return tireSize({
        code: normalized,
        width: unknown('unverified'),
        aspect: unknown('unverified'),
        rim: rim.value,
      }).ok
        ? ok(normalized)
        : invalid('tire_size');
    }
    const width = quantity(m[2], 'mm'),
      aspect = quantity(m[3], 'percent'),
      rim = quantity(m[5], 'inch');
    if (!width.ok || !aspect.ok || !rim.ok) return invalid('tire_size');
    return tireSize({
      code: normalized,
      width: known(width.value),
      aspect: known(aspect.value),
      rim: rim.value,
    }).ok
      ? ok(normalized)
      : invalid('tire_size');
  }
  if (field === 'load_index')
    return /^[1-9][0-9]{0,2}$/.test(code) ? ok(code) : invalid('load_index');
  if (field === 'speed_rating')
    return /^(A[1-8]|[BCDEFGJKLMNPQRSTUHVWYZ]|\(Y\))$/.test(code)
      ? ok(code)
      : invalid('speed_rating');
  if (field === 'date_code') {
    if (!instant(now).ok) return invalid('date_code');
    const currentYear = Number(now.slice(0, 4)),
      month = Number(now.slice(5, 7)),
      day = Number(now.slice(8, 10)),
      leap = currentYear % 4 === 0 && (currentYear % 100 !== 0 || currentYear % 400 === 0),
      days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
      dayOfYear = days.slice(0, month - 1).reduce((n, d) => n + d, 0) + day,
      week = Number(code.slice(0, 2)),
      year = 2000 + Number(code.slice(2));
    if (
      !/^\d{4}$/.test(code) ||
      week < 1 ||
      week > 53 ||
      year > currentYear ||
      (year === currentYear && week > Math.ceil(dayOfYear / 7))
    )
      return invalid('date_code');
    return ok(code);
  }
  if (field === 'dot_tin') {
    const normalized = code.replace(/^DOT\s*/, ''),
      tail = normalized.slice(-4);
    return /^[A-Z0-9]{10,13}$/.test(normalized) && photoFieldValue('date_code', tail, now).ok
      ? ok('DOT ' + normalized)
      : invalid('dot_tin');
  }
  if (field === 'seasonal_marking')
    return ['3PMSF', 'M+S', 'M&S', 'M/S'].includes(code) ? ok(code) : invalid('seasonal_marking');
  return ['RFT', 'ROF', 'SSR', 'ZP', 'RUN FLAT', 'RUNFLAT'].includes(code)
    ? ok(code)
    : invalid('run_flat_marking');
}
export type PhotoReading = Omit<PhotoCandidate, 'id' | 'uploadId' | 'ordinal'>;
export interface PhotoReadings {
  readonly schema: 1;
  readonly fields: readonly PhotoReading[];
  readonly dotStatus: 'partial' | 'unverified_full' | 'not_visible';
  readonly limitations: readonly [
    'confirmation_required',
    'no_condition_assessment',
    'no_fitment_clearance',
  ];
}
function object(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
export function photoReadingSet(raw: unknown, now: string): Result<PhotoReadings> {
  if (
    !object(raw) ||
    Object.keys(raw).sort().join(',') !== 'fields,schema' ||
    raw.schema !== 1 ||
    !Array.isArray(raw.fields) ||
    raw.fields.length > 9
  )
    return invalid('photo_output');
  const seen = new Set<string>(),
    fields: PhotoReading[] = [];
  let dotStatus: PhotoReadings['dotStatus'] = 'not_visible';
  for (const rawField of raw.fields) {
    if (
      !object(rawField) ||
      Object.keys(rawField).sort().join(',') !== 'field,quality,rawText,region,unknownReason,value'
    )
      return invalid('photo_output');
    const f = rawField;
    if (
      typeof f.field !== 'string' ||
      !photoFields.includes(f.field as PhotoField) ||
      seen.has(f.field) ||
      !['clear', 'uncertain', 'unknown'].includes(String(f.quality)) ||
      !(
        f.unknownReason === null ||
        ['unreadable', 'not_visible', 'ambiguous', 'unsupported'].includes(String(f.unknownReason))
      ) ||
      !(
        f.rawText === null ||
        (typeof f.rawText === 'string' && f.rawText.length <= 160 && !unsafeText(f.rawText))
      ) ||
      !(f.value === null || (typeof f.value === 'string' && f.value.length <= 160))
    )
      return invalid('photo_output');
    let region: PhotoReading['region'] = null;
    if (f.region !== null) {
      const r = f.region;
      if (
        !object(r) ||
        Object.keys(r).sort().join(',') !== 'h,w,x,y' ||
        !['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k])) ||
        Number(r.x) < 0 ||
        Number(r.y) < 0 ||
        Number(r.w) <= 0 ||
        Number(r.h) <= 0 ||
        Number(r.x) + Number(r.w) > 1 ||
        Number(r.y) + Number(r.h) > 1
      )
        return invalid('photo_output');
      region = Object.freeze({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) });
    }
    seen.add(f.field);
    let value: string | null = null,
      reason: PhotoReading['unknownReason'] = f.unknownReason as PhotoReading['unknownReason'];
    if (f.quality === 'clear' && f.value !== null && reason === null) {
      const v = photoFieldValue(f.field, f.value, now);
      if (v.ok) value = v.value;
      else reason = 'unsupported';
    } else reason = reason ?? (f.quality === 'uncertain' ? 'ambiguous' : 'unreadable');
    const rawText =
      typeof f.rawText === 'string' && f.rawText.trim().length > 0 ? f.rawText.trim() : null;
    if (f.field === 'dot_tin') {
      if (value !== null) dotStatus = 'unverified_full';
      else if (rawText) {
        dotStatus = 'partial';
        reason = 'not_visible';
      }
    }
    fields.push(
      Object.freeze({
        field: f.field as PhotoField,
        rawText,
        value,
        quality: value === null ? 'unknown' : 'clear',
        unknownReason: value === null ? (reason ?? 'unreadable') : null,
        region,
      }),
    );
  }
  return ok(
    Object.freeze({
      schema: 1,
      fields: Object.freeze(fields),
      dotStatus,
      limitations: Object.freeze([
        'confirmation_required',
        'no_condition_assessment',
        'no_fitment_clearance',
      ] as const),
    }),
  );
}
