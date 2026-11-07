import { it, expect } from 'vitest';
import {
  photoFieldValue,
  photoReadingSet,
  imageMime,
} from '../../packages/domain/src/photo-policy.ts';
it.each([
  ['brand', 'Michelin', 'Michelin'],
  ['model', 'Pilot Sport 4', 'Pilot Sport 4'],
  ['tire_size', 'p225/65r17', 'P225/65R17'],
  ['load_index', '102', '102'],
  ['speed_rating', 'h', 'H'],
  ['date_code', '3524', '3524'],
  ['dot_tin', 'DOT ABCDE1233524', 'DOT ABCDE1233524'],
  ['seasonal_marking', '3PMSF', '3PMSF'],
  ['run_flat_marking', 'RFT', 'RFT'],
])('uses ordinary shared shape validation for %s', (field, raw, want) =>
  expect(photoFieldValue(field, raw, '2026-11-06T12:00:00.000Z')).toMatchObject({
    ok: true,
    value: want,
  }),
);
it.each([
  { f: 'brand', v: '<script>' },
  { f: 'model', v: 'x\ny' },
  { f: 'tire_size', v: '225/0R17' },
  { f: 'tire_size', v: '225/65R00' },
  { f: 'load_index', v: '100.5' },
  { f: 'speed_rating', v: 'SAFE' },
  { f: 'date_code', v: '0024' },
  { f: 'date_code', v: '5424' },
  { f: 'date_code', v: '3528' },
  { f: 'dot_tin', v: 'DOT ABC' },
  { f: 'seasonal_marking', v: 'all weather safe' },
  { f: 'run_flat_marking', v: 'certified safe' },
  { f: 'condition', v: 'safe' },
])('rejects invalid or unsupported field $f / $v', ({ f, v }) =>
  expect(photoFieldValue(f, v, '2026-11-06T12:00:00.000Z').ok).toBe(false),
);
const field = () => ({
  field: 'tire_size',
  rawText: '225/65R17',
  value: '225/65R17',
  quality: 'clear',
  unknownReason: null,
  region: { x: 0, y: 0, w: 1, h: 1 },
});
it('returns only suggestions and fixed warnings; never condition or fitment clearance', () => {
  const out = photoReadingSet({ schema: 1, fields: [field()] }, '2026-11-06T12:00:00.000Z');
  expect(out).toMatchObject({
    ok: true,
    value: {
      fields: [{ value: '225/65R17' }],
      limitations: ['confirmation_required', 'no_condition_assessment', 'no_fitment_clearance'],
    },
  });
});
it('keeps low-quality values unknown instead of trusting model confidence', () =>
  expect(
    photoReadingSet(
      { schema: 1, fields: [{ ...field(), quality: 'uncertain' }] },
      '2026-11-06T12:00:00.000Z',
    ),
  ).toMatchObject({
    ok: true,
    value: { fields: [{ value: null, quality: 'unknown', unknownReason: 'ambiguous' }] },
  }));
it('labels partial DOT text without manufacturing a date or a full TIN', () =>
  expect(
    photoReadingSet(
      {
        schema: 1,
        fields: [{ ...field(), field: 'dot_tin', rawText: 'DOT ABC123', value: 'DOT ABC123' }],
      },
      '2026-11-06T12:00:00.000Z',
    ),
  ).toMatchObject({
    ok: true,
    value: { dotStatus: 'partial', fields: [{ value: null, unknownReason: 'not_visible' }] },
  }));
it.each([
  { schema: 1, fields: [field(), field()] },
  { schema: 1, fields: [{ ...field(), field: 'condition' }] },
  { schema: 1, fields: [{ ...field(), region: { x: 0, y: 0, w: 2, h: 1 } }] },
  { schema: 1, fields: [{ ...field(), confidence: 1 }] },
  { schema: 1, fields: [], safe: true },
])('rejects duplicate/forged/unbounded output %#', (v) =>
  expect(photoReadingSet(v, '2026-11-06T12:00:00.000Z').ok).toBe(false),
);
it.each([
  { b: new Uint8Array([255, 216, 255, 0]), m: 'image/jpeg' },
  { b: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), m: 'image/png' },
  { b: new TextEncoder().encode('RIFFxxxxWEBP'), m: 'image/webp' },
])('requires supported binary magic $m', ({ b, m }) => expect(imageMime(b)).toBe(m));
it.each([
  new Uint8Array(),
  new TextEncoder().encode('<svg/>'),
  new TextEncoder().encode('xxxxftypheic'),
])('rejects unknown/HEIC/vector containers %#', (v) => expect(imageMime(v)).toBeNull());

it.each(['31X10.50R15', '35X12.50R17LT', '195R15C', '7.50R16', '235/80R17.5'])(
  'keeps manual non-metric code %s usable without inferring verified dimensions',
  (code) =>
    expect(photoFieldValue('tire_size', code, '2026-11-06T12:00:00.000Z')).toMatchObject({
      ok: true,
      value: code,
    }),
);

it('normalizes empty not-visible text to null for sealed candidate storage', () =>
  expect(
    photoReadingSet(
      {
        schema: 1,
        fields: [
          {
            ...field(),
            field: 'dot_tin',
            rawText: '',
            value: null,
            quality: 'unknown',
            unknownReason: 'not_visible',
          },
        ],
      },
      '2026-11-06T12:00:00.000Z',
    ),
  ).toMatchObject({
    ok: true,
    value: {
      dotStatus: 'not_visible',
      fields: [{ rawText: null, value: null, unknownReason: 'not_visible' }],
    },
  }));
