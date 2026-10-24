import { expect, it } from 'vitest';
import {
  moneyFromRow,
  moneyToRow,
  tireSizeFromRow,
  reportHeadFromRow,
  schemaVersion,
} from '../../packages/db/src/mappers.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
const report = {
  id: '11111111-1111-4111-8111-111111111111',
  owner_subject_id: '22222222-2222-4222-8222-222222222222',
  revision: '9007199254740993',
  expires_at: new Date('2026-10-23T10:00:00.000Z'),
  status: 'active',
  current_version: 1,
};
it('round-trips exact SQL money while discarding unselected private fields', () => {
  const value = moneyFromRow(
    { unit_price_minor: '9007199254740993', currency: 'USD', email: 'secret' },
    ['USD'],
  );
  expect(value).toEqual({ ok: true, value: { minor: 9007199254740993n, currency: 'USD' } });
  if (value.ok)
    expect(moneyToRow(value.value)).toEqual({
      unit_price_minor: '9007199254740993',
      currency: 'USD',
    });
  for (const row of [
    { unit_price_minor: 9007199254740992, currency: 'USD' },
    { unit_price_minor: null, currency: 'USD' },
    {},
  ])
    expect(moneyFromRow(row, ['USD'])).toMatchObject({
      ok: false,
      error: { code: 'invalid_stored_data' },
    });
});
it('maps nullable dimensions to unknown rather than inventing zero', () => {
  const row = { size_code: 'fixture', width_mm: null, aspect_ratio: null, rim_inches: '17.5' };
  expect(tireSizeFromRow(row)).toMatchObject({
    ok: true,
    value: {
      width: { state: 'unknown' },
      aspect: { state: 'unknown' },
      rim: { microunits: 17500000n },
    },
  });
  expect(tireSizeFromRow({ ...row, width_mm: '225', aspect_ratio: '55' })).toMatchObject({
    ok: true,
    value: { width: { state: 'known' } },
  });
  for (const patch of [
    { width_mm: undefined },
    { rim_inches: '0' },
    { aspect_ratio: '201' },
    { width_mm: '0' },
    { size_code: 7 },
    { rim_inches: null },
    { width_mm: '1.0000001' },
  ])
    expect(tireSizeFromRow({ ...row, ...patch }).ok).toBe(false);
});
it('maps report heads without leaking extra storage columns', () => {
  const result = reportHeadFromRow({ ...report, encrypted_email: 'secret' });
  expect(result).toMatchObject({
    ok: true,
    value: {
      revision: 9007199254740993n,
      currentVersion: 1,
      expiresAt: '2026-10-23T10:00:00.000Z',
    },
  });
  if (result.ok)
    expect(Object.keys(result.value).sort()).toEqual([
      'currentVersion',
      'expiresAt',
      'id',
      'ownerId',
      'revision',
      'status',
    ]);
  expect(reportHeadFromRow({ ...report, status: 'draft', current_version: null }).ok).toBe(true);
  expect(
    reportHeadFromRow({
      ...report,
      status: 'pending_deletion',
      expires_at: '2026-10-23T10:00:00.000Z',
    }).ok,
  ).toBe(true);
  for (const patch of [
    { id: 'bad' },
    { owner_subject_id: null },
    { revision: 2 },
    { expires_at: new Date('invalid') },
    { expires_at: undefined },
    { current_version: 0 },
    { current_version: '1' },
    { current_version: 2147483648 },
    { status: 'active', current_version: null },
    { status: 'future_status' },
  ])
    expect(reportHeadFromRow({ ...report, ...patch }).ok).toBe(false);
});
it('refuses unsupported snapshot versions and unbounded pages', () => {
  expect(schemaVersion(1)).toEqual({ ok: true, value: 1 });
  for (const value of [0, 2, '1', null]) expect(schemaVersion(value).ok).toBe(false);
  expect(pageRequest(100, 'opaque')).toEqual({ ok: true, value: { limit: 100, after: 'opaque' } });
  expect(pageRequest(1).ok).toBe(true);
  for (const value of [0, 101, 1.5, '1', NaN]) expect(pageRequest(value).ok).toBe(false);
  for (const cursor of ['', {}, 'x'.repeat(513)]) expect(pageRequest(1, cursor).ok).toBe(false);
});
