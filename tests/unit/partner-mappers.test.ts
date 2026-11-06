import { expect, it } from 'vitest';
import { partnerOrganizationFromRow } from '../../packages/db/src/repositories/partner-mappers.ts';
import {
  partnerOfferFromRow,
  couponAssignmentFromRow,
  partnerMetricFromRow,
} from '../../packages/db/src/repositories/partner-mappers.ts';
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222';
const offer = () => ({
  org_id: a,
  offer_id: b,
  version: 1,
  supersedes_version: null,
  title: 'Tire offer',
  description: 'Reviewed synthetic terms',
  terms: { restrictions: ['local'] },
  discount_type: 'percent_off',
  percent_basis_points: 1200,
  amount_minor: null,
  currency_code: null,
  service_code: null,
  minimum_tires: 1,
  minimum_purchase_minor: null,
  minimum_purchase_currency: null,
  redemption_method: 'in_store_code',
  redemption_domain: null,
  redemption_url: null,
  logo_asset_id: null,
  logo_rights_warranted: false,
  valid_from: new Date('2026-01-01T00:00:00.000Z'),
  valid_until: new Date('2026-02-01T00:00:00.000Z'),
  status: 'draft',
  created_by: a,
  reviewed_by: null,
});
it('decodes the scoped organization without converting an int64 revision through Number', () => {
  const result = partnerOrganizationFromRow({
    id: '11111111-1111-4111-8111-111111111111',
    legal_name: 'Synthetic reseller',
    market: 'US',
    status: 'pending',
    verification_status: 'pending',
    revision: '9007199254740993',
  });
  expect(result).toEqual({
    ok: true,
    value: {
      id: '11111111-1111-4111-8111-111111111111',
      legalName: 'Synthetic reseller',
      market: 'US',
      status: 'pending',
      verification: 'pending',
      revision: 9007199254740993n,
    },
  });
});
it.each([
  'percent_off',
  'amount_off',
  'set_of_four_off',
  'buy_three_get_one',
  'free_service',
  'mail_in_rebate',
  'price_match',
])('decodes %s without lossy money or invented optional fields', (kind) => {
  const row = {
    ...offer(),
    discount_type: kind,
    percent_basis_points: kind === 'percent_off' ? 1000 : null,
    amount_minor: ['amount_off', 'set_of_four_off', 'mail_in_rebate'].includes(kind)
      ? '9007199254740993'
      : null,
    currency_code: ['amount_off', 'set_of_four_off', 'mail_in_rebate'].includes(kind)
      ? 'USD'
      : null,
    service_code: kind === 'free_service' ? 'alignment' : null,
    minimum_tires: ['set_of_four_off', 'buy_three_get_one'].includes(kind) ? 4 : 1,
  };
  const r = partnerOfferFromRow(row);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value.discount.kind).toBe(kind);
  if ('money' in r.value.discount) expect(r.value.discount.money.minor).toBe(9007199254740993n);
  expect(r.value.minimumPurchase).toBeNull();
  expect(r.value.validFrom).toBe('2026-01-01T00:00:00.000Z');
  expect(r.value.redemptionUrl).toBeNull();
});
it.each([
  ['version', 0],
  ['supersedes_version', 1],
  ['org_id', 'bad'],
  ['offer_id', null],
  ['title', ' '],
  ['description', ''],
  ['terms', []],
  ['terms', new Date()],
  ['percent_basis_points', 10001],
  ['amount_minor', '0'],
  ['minimum_tires', 0],
  ['minimum_purchase_minor', '4'],
  ['minimum_purchase_currency', 'USD'],
  ['valid_from', new Date('invalid')],
  ['valid_until', '2026-01-01T00:00:00.000Z'],
  ['status', 'invented'],
  ['status', 'published'],
  ['created_by', 'invalid'],
  ['reviewed_by', a],
  ['redemption_method', 'link'],
  ['redemption_url', 'http://unsafe.invalid'],
  ['redemption_domain', 'unsafe.invalid'],
  ['logo_asset_id', b],
  ['logo_rights_warranted', 'yes'],
])('refuses malformed stored offer %s instead of substituting a default', (field, value) => {
  const row = { ...offer(), [field]: value };
  if (field === 'reviewed_by') row.status = 'reviewed';
  expect(partnerOfferFromRow(row)).toEqual({
    ok: false,
    error: { code: 'invalid_stored_data', field: 'offer_version' },
  });
});
it('keeps allowed logo, HTTPS authority and a zero minimum purchase explicit', () => {
  const r = partnerOfferFromRow({
    ...offer(),
    logo_asset_id: b,
    logo_rights_warranted: true,
    redemption_method: 'link',
    redemption_domain: 'synthetic.invalid',
    redemption_url: 'https://synthetic.invalid:443/offer',
    minimum_purchase_minor: '0',
    minimum_purchase_currency: 'USD',
    status: 'reviewed',
    reviewed_by: b,
  });
  expect(r).toMatchObject({
    ok: true,
    value: { logoAssetId: b, minimumPurchase: { minor: 0n, currency: 'USD' }, reviewedBy: b },
  });
});
it('copies and freezes nested terms and excludes private row columns', () => {
  const row = { ...offer(), encrypted_code: 'private', recipient_email: 'synthetic@invalid' },
    r = partnerOfferFromRow(row);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  row.terms.restrictions.push('changed');
  expect(r.value.terms).toEqual({ restrictions: ['local'] });
  expect(Object.isFrozen(r.value.terms.restrictions)).toBe(true);
  expect(JSON.stringify(r.value)).not.toMatch(/private|recipient_email|encrypted_code/);
});
const assignment = () => ({
  id: a,
  org_id: a,
  send_id: a,
  owner_subject_id: b,
  offer_id: a,
  offer_version: 1,
  pool_id: b,
  pool_mode: 'unique',
  code_id: a,
  slot: 1,
  policy_version: 'p1',
  state: 'reserved',
  reserved_at: new Date('2026-01-01T00:00:00.000Z'),
});
it.each(['shared', 'unique', 'generated'])(
  'maps %s assignment references without secret material',
  (mode) => {
    const r = couponAssignmentFromRow({
      ...assignment(),
      pool_mode: mode,
      code_id: mode === 'shared' ? null : a,
      encrypted_code: 'hidden',
      code_hmac: 'hidden',
    });
    expect(r).toMatchObject({ ok: true, value: { mode } });
    if (r.ok) expect(Object.keys(r.value)).not.toContain('encrypted_code');
  },
);
it.each([
  ['pool_mode', 'shared'],
  ['code_id', null],
  ['state', 'invalid'],
  ['slot', 4],
  ['offer_version', 0],
  ['reserved_at', 'invalid'],
  ['policy_version', ''],
])('refuses malformed assignment %s', (field, value) =>
  expect(couponAssignmentFromRow({ ...assignment(), [field]: value }).ok).toBe(false),
);
it.each([
  ['2026-01-01', '9007199254740993', true],
  ['2026-02-30', '1', false],
  ['2026-01-01', '-1', false],
  ['2026-01-01', '9223372036854775808', false],
])('validates aggregate day/count %s %s', (day, total, expected) => {
  const r = partnerMetricFromRow({
    day,
    total_count: total,
    metric: 'reported_redemptions',
    market: 'US',
  });
  expect(r.ok).toBe(expected);
  if (r.ok) expect(r.value.count).toBe(9007199254740993n);
});
it.each([
  ['status', 'active'],
  ['verification_status', 'unknown'],
  ['revision', '0'],
  ['id', '00000000-0000-0000-0000-000000000000'],
  ['legal_name', ''],
  ['market', null],
])('rejects malformed organization %s', (field, value) =>
  expect(
    partnerOrganizationFromRow({
      id: a,
      legal_name: 'Synthetic',
      market: 'US',
      status: 'pending',
      verification_status: 'pending',
      revision: '1',
      [field]: value,
    }).ok,
  ).toBe(false),
);
