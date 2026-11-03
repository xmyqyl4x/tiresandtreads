import { it, expect } from 'vitest';
import {
  deliveryChoice,
  deliveryPresentation,
  deliveryReference,
  privateProof,
  proofLink,
  rightsBody,
} from '../../apps/web/src/delivery-privacy/model.ts';
import {
  deliveryView,
  privacyStatusView,
} from '../../packages/contracts/src/delivery-privacy-views.ts';
import { uuid } from '../fixtures/engine/base.ts';
const notices = { report: uuid(1), offers: uuid(2) },
  reference = { id: uuid(3), version: 2, comparisonRevision: '4' };
const form = { email: 'User+tag@example.invalid', report: false, offers: false };
it('requires an explicit independent purpose and a valid address', () => {
  expect(deliveryChoice(form, reference, notices)).toMatchObject({
    ok: false,
    errors: { purposes: expect.any(String) },
  });
  expect(
    deliveryChoice({ ...form, email: 'bad\n@example.invalid', offers: true }, reference, notices),
  ).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
});
it('builds report-only delivery with only its bound notice/version/comparison', () => {
  expect(deliveryChoice({ ...form, report: true }, reference, notices)).toEqual({
    ok: true,
    request: {
      kind: 'delivery',
      input: {
        email: form.email,
        report: { id: reference.id, version: 2 },
        comparisonRevision: '4',
        offers: false,
        notices: { report: notices.report },
      },
    },
  });
});
it('keeps offers-only requests independent of report identity and requires separate confirmation', () => {
  expect(deliveryChoice({ ...form, offers: true }, null, notices)).toEqual({
    ok: true,
    request: {
      kind: 'offers',
      input: { email: form.email, report: null, offers: true, notices: { offers: notices.offers } },
    },
  });
  expect(deliveryChoice({ ...form, offers: true, report: true }, reference, notices)).toMatchObject(
    { ok: true, request: { input: { offers: true, notices } } },
  );
  expect(deliveryChoice({ ...form, report: true }, null, notices)).toMatchObject({
    ok: false,
    errors: { report: expect.any(String) },
  });
});
it('refuses absent/stale notice references rather than inventing a grant', () => {
  expect(
    deliveryChoice({ ...form, offers: true }, reference, { report: notices.report, offers: 'bad' })
      .ok,
  ).toBe(false);
});
it.each([
  '?report=bad&version=2',
  '?report=' + uuid(3) + '&version=0',
  '?report=' + uuid(3) + '&version=2&version=3',
  '?report=' + uuid(3) + '&version=2&comparison=bad',
])('refuses malformed or ambiguous report bindings %s', (query) => {
  expect(deliveryReference(query)).toBeNull();
});
it('preserves the exact report/comparison reference in delivery navigation', () => {
  expect(deliveryReference('?report=' + uuid(3) + '&version=2&comparison=4')).toEqual(reference);
});
const scheduled = {
  id: uuid(5),
  revision: '1',
  state: 'scheduled' as const,
  sendAfter: '2026-11-03T12:01:00.000Z',
  cancelDeadline: '2026-11-03T12:01:00.000Z',
};
it('uses server deadlines without claiming client time authorizes cancellation', () => {
  expect(deliveryPresentation(scheduled, Date.parse('2026-11-03T12:00:01.000Z'))).toMatchObject({
    canCancel: true,
    deadlinePassed: false,
  });
  expect(deliveryPresentation(scheduled, Date.parse('2026-11-03T12:02:00.000Z'))).toMatchObject({
    canCancel: true,
    deadlinePassed: true,
  });
});
it.each([
  'dispatching',
  'accepted',
  'uncertain',
  'failed',
  'manual_review',
  'cancelled',
  'suppressed',
] as const)('does not offer cancellation or recall for %s', (state) => {
  const shown = deliveryPresentation({ ...scheduled, state });
  expect(shown.canCancel).toBe(false);
  expect(shown.title.length).toBeGreaterThan(3);
  if (state === 'accepted') expect(shown.detail).toMatch(/not.*deliver/i);
  if (state === 'uncertain') expect(shown.detail).toMatch(/new request/i);
});
it('refuses malformed status, timestamp and private payloads', () => {
  expect(deliveryView.safeParse(scheduled).success).toBe(true);
  for (const change of [
    { state: 'delivered' },
    { cancelDeadline: 'not-a-time' },
    { revision: '0' },
    { email: 'secret@example.invalid' },
  ])
    expect(deliveryView.safeParse({ ...scheduled, ...change }).success).toBe(false);
  expect(
    privacyStatusView.safeParse({
      id: uuid(7),
      kind: 'delete',
      status: 'completed',
      dueAt: scheduled.sendAfter,
      completedAt: null,
    }).success,
  ).toBe(false);
});
const proof = 'privacy.p1.' + uuid(7) + '.' + 'a'.repeat(64);
it('uses same-site fragment-only purpose-bound proof links without credentials or query leakage', () => {
  const link = proofLink('http://127.0.0.1:8380', 'privacy', proof);
  expect(link).toBe('http://127.0.0.1:8380/preview/privacy-request#' + proof);
  expect(privateProof(link, 'privacy', 'http://127.0.0.1:8380')).toBe(proof);
  expect(privateProof('#' + proof, 'privacy', 'http://127.0.0.1:8380')).toBe(proof);
  for (const invalid of [
    link.replace('127.0.0.1', 'example.invalid'),
    link.replace('#', '?proof='),
    link.replace('/privacy-request', '/email-preferences'),
    proof.replace('privacy.', 'verify.'),
    '#' + proof + '%0a',
    link.replace('http://', 'http://user@'),
  ])
    expect(privateProof(invalid, 'privacy', 'http://127.0.0.1:8380')).toBeNull();
});
it('requires an explicit rights type/region and an acknowledgement for restrictive owner requests', () => {
  expect(rightsBody({ kind: '', jurisdiction: '', acknowledged: false })).toMatchObject({
    ok: false,
  });
  expect(
    rightsBody({ kind: 'delete', jurisdiction: 'synthetic', acknowledged: false }),
  ).toMatchObject({ ok: false, errors: { acknowledged: expect.any(String) } });
  expect(rightsBody({ kind: 'access', jurisdiction: 'synthetic', acknowledged: false })).toEqual({
    ok: true,
    input: { kind: 'access', jurisdiction: 'synthetic' },
  });
  expect(rightsBody({ kind: 'delete', jurisdiction: 'synthetic', acknowledged: true })).toEqual({
    ok: true,
    input: { kind: 'delete', jurisdiction: 'synthetic' },
  });
});

it('does not mislabel an empty address as unavailable notices when the published notices loaded', () => {
  const result = deliveryChoice({ ...form, email: '' }, reference, notices);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['email', 'purposes']);
});
it('refuses hidden address control characters rather than trimming them into a valid request', () => {
  expect(
    deliveryChoice({ ...form, email: 'User@example.invalid\n', offers: true }, reference, notices),
  ).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
});
