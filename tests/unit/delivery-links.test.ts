import { it, expect, vi } from 'vitest';
import { createDeliveryLinkCapture } from '../../packages/application/src/services/delivery-links.ts';
import { createCapturedDeliveryContext } from '../../packages/integrations/src/report-templates/captured-context.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createReportCrypto } from '../../packages/integrations/src/report-crypto.ts';
import { id, instant, revision } from '../../packages/domain/src/values/core.ts';
import type { Result } from '../../packages/domain/src/values/core.ts';
import type { ContactIntent } from '../../packages/application/src/ports/contact-services.ts';
import type { Send } from '../../packages/application/src/ports/private-records.ts';
import type { TransactionContext } from '../../packages/application/src/ports/transactions.ts';
import { templateDocument, templateProfile } from '../fixtures/templates/report.ts';
function value<T>(r: Result<T, unknown>) {
  if (!r.ok) throw Error('Invalid fixture');
  return r.value;
}
const key = <K extends string>(kind: K, n: number) =>
  value(id(kind, '10000000-0000-4000-8000-' + String(n).padStart(12, '0')));
const at = (day: number) => value(instant(`2026-11-${day}T12:00:00.000Z`));
const tx = {} as TransactionContext;
function setup(offers = false) {
  const contacts = createContactCrypto(
      'c1',
      { c1: new Uint8Array(32).fill(4) },
      { l1: new Uint8Array(32).fill(5) },
      new Uint8Array(32).fill(6),
    ),
    reports = createReportCrypto(
      'r1',
      { r1: new Uint8Array(32).fill(7) },
      new Uint8Array(32).fill(8),
    ),
    owner = { subjectId: key('subject', 2), sessionId: key('owner_session', 3) },
    send: Send = {
      id: key('send', 4),
      revision: value(revision('1')),
      state: 'scheduled',
      ownerId: owner.subjectId,
      contactId: key('contact', 5),
      reportId: key('report', 1),
      reportVersion: 1,
      comparisonRevision: null,
      provider: 'fixture',
      providerKey: 'f'.repeat(64),
      sendAfter: at(15),
      cancelDeadline: at(15),
      templateId: key('template', 6),
      payloadAssetId: null,
      payloadHash: null,
    },
    verificationId = key('verification', 7),
    offersVerificationId = key('verification', 8);
  function makeIntent(id: typeof verificationId, purpose: 'report' | 'offers'): ContactIntent {
    return {
      id,
      contactId: send.contactId!,
      subjectId: key('subject', 9),
      ownerId: owner.subjectId,
      purpose,
      scope: purpose === 'report' ? `report:${send.reportId}:1` : 'offers',
      noticeId: key('notice', 10),
      policyVersion: 'synthetic',
      eventId: key('consent_event', 11),
      permissionDigest: 'a'.repeat(64),
      key: contacts.token('verify', id, 'c1').key,
      expiresAt: at(purpose === 'report' ? 20 : 16),
      usedAt: null,
      invalidated: false,
      live: true,
    };
  }
  const intents = new Map([
      [verificationId, makeIntent(verificationId, 'report')],
      [offersVerificationId, makeIntent(offersVerificationId, 'offers')],
    ]),
    share = vi.fn(async () => undefined),
    capture = createDeliveryLinkCapture({
      contacts: { intent: async (_tx, id) => intents.get(id) ?? null },
      capabilities: { share },
      contactCrypto: contacts,
      reportCrypto: reports,
      now: () => at(15),
    }),
    input = {
      owner,
      send,
      reportExpiresAt: at(18),
      verificationId,
      offersVerificationId: offers ? offersVerificationId : null,
    };
  return { contacts, reports, intents, share, capture, input };
}
it('captures one fixed-version authority in the caller transaction, without persisting bearer proofs', async () => {
  const s = setup(),
    links = await s.capture.capture(tx, s.input);
  expect(s.share).toHaveBeenCalledExactlyOnceWith(
    tx,
    s.input.owner,
    expect.objectContaining({
      id: links.share.id,
      reportId: s.input.send.reportId,
      version: 1,
      comparisonRevision: null,
      expiresAt: at(18),
    }),
  );
  expect(links.expiresAt).toBe(at(18));
  expect(links.offersConfirmation).toBeNull();
  expect(JSON.stringify(links)).not.toMatch(/share\.|unsubscribe\.|verify\./);
  const document = { ...templateDocument(), links },
    get = createCapturedDeliveryContext({
      profile: templateProfile,
      contacts: s.contacts,
      reports: s.reports,
    }),
    a = get(document),
    b = get(structuredClone(document));
  expect(a).toEqual(b);
  expect(a.offersConfirmationUrl).toBeNull();
  expect(s.reports.lookup('share', new URL(a.viewUrl).hash.slice(1))).toEqual([links.share.key]);
  expect(s.contacts.parse('unsubscribe', new URL(a.preferencesUrl).hash.slice(1))?.id).toBe(
    s.input.verificationId,
  );
  expect(s.contacts.parse('verify', new URL(a.preferencesUrl).hash.slice(1))).toBeNull();
  expect(s.share).toHaveBeenCalledTimes(1);
});
it('binds selected offers separately and caps the captured expiry at the earliest parent/intent', async () => {
  const s = setup(true),
    links = await s.capture.capture(tx, s.input),
    get = createCapturedDeliveryContext({
      profile: templateProfile,
      contacts: s.contacts,
      reports: s.reports,
    }),
    context = get({ ...templateDocument(), links });
  expect(links.expiresAt).toBe(at(16));
  expect(
    s.contacts.parse('verify', new URL(context.offersConfirmationUrl!).hash.slice(1))?.id,
  ).toBe(s.input.offersVerificationId);
  expect(context.preferencesUrl).not.toBe(context.offersConfirmationUrl);
});
it.each([
  'absent',
  'expired',
  'invalidated',
  'used',
  'not-live',
  'wrong-owner',
  'wrong-contact',
  'wrong-purpose',
  'wrong-scope',
  'wrong-key',
])('refuses %s report-purpose authority before creating a share', async (mode) => {
  const s = setup(),
    original = s.intents.get(s.input.verificationId)!;
  if (mode === 'absent') s.intents.delete(original.id);
  else
    s.intents.set(original.id, {
      ...original,
      ...(mode === 'expired' ? { expiresAt: at(14) } : {}),
      ...(mode === 'invalidated' ? { invalidated: true } : {}),
      ...(mode === 'used' ? { usedAt: at(15) } : {}),
      ...(mode === 'not-live' ? { live: false } : {}),
      ...(mode === 'wrong-owner' ? { ownerId: key('subject', 99) } : {}),
      ...(mode === 'wrong-contact' ? { contactId: key('contact', 99) } : {}),
      ...(mode === 'wrong-purpose' ? { purpose: 'offers' } : {}),
      ...(mode === 'wrong-scope' ? { scope: 'report:another:1' } : {}),
      ...(mode === 'wrong-key' ? { key: { ...original.key, digest: 'b'.repeat(64) } } : {}),
    });
  await expect(s.capture.capture(tx, s.input)).rejects.toThrow();
  expect(s.share).not.toHaveBeenCalled();
});
it('refuses invalid selected offers without creating partial report authority', async () => {
  const s = setup(true);
  s.intents.delete(s.input.offersVerificationId!);
  await expect(s.capture.capture(tx, s.input)).rejects.toThrow();
  expect(s.share).not.toHaveBeenCalled();
});
it('reconstructs the original links after key rotation and refuses missing or changed retained keys', async () => {
  const s = setup(true),
    links = await s.capture.capture(tx, s.input),
    document = { ...templateDocument(), links },
    original = createCapturedDeliveryContext({
      profile: templateProfile,
      contacts: s.contacts,
      reports: s.reports,
    })(document),
    reports = createReportCrypto(
      'r2',
      { r1: new Uint8Array(32).fill(7), r2: new Uint8Array(32).fill(9) },
      new Uint8Array(32).fill(8),
    ),
    contacts = createContactCrypto(
      'c2',
      { c1: new Uint8Array(32).fill(4), c2: new Uint8Array(32).fill(10) },
      { l1: new Uint8Array(32).fill(5) },
      new Uint8Array(32).fill(6),
    );
  expect(
    createCapturedDeliveryContext({ profile: templateProfile, contacts, reports })(document),
  ).toEqual(original);
  const missing = createReportCrypto(
    'r2',
    { r2: new Uint8Array(32).fill(9) },
    new Uint8Array(32).fill(8),
  );
  expect(() =>
    createCapturedDeliveryContext({ profile: templateProfile, contacts, reports: missing })(
      document,
    ),
  ).toThrow();
  const changed = createReportCrypto(
    'r1',
    { r1: new Uint8Array(32).fill(12) },
    new Uint8Array(32).fill(8),
  );
  expect(() =>
    createCapturedDeliveryContext({ profile: templateProfile, contacts, reports: changed })(
      document,
    ),
  ).toThrow();
  expect(s.share).toHaveBeenCalledTimes(1);
});
it.each(['report', 'version', 'comparison', 'proof', 'missing'])(
  'refuses a captured context with changed %s binding',
  async (mode) => {
    const s = setup(true),
      links = structuredClone(await s.capture.capture(tx, s.input)),
      document = { ...templateDocument(), links };
    const altered =
      mode === 'missing'
        ? templateDocument()
        : {
            ...document,
            report: {
              ...document.report,
              ...(mode === 'report' ? { reportId: key('report', 99) } : {}),
              ...(mode === 'version' ? { version: 2 } : {}),
            },
            comparison: mode === 'comparison' ? { revision: '3' } : document.comparison,
            links:
              mode === 'proof'
                ? {
                    ...links,
                    reportPreferences: {
                      ...links.reportPreferences,
                      key: { ...links.reportPreferences.key, digest: 'b'.repeat(64) },
                    },
                  }
                : links,
          };
    expect(() =>
      createCapturedDeliveryContext({
        profile: templateProfile,
        contacts: s.contacts,
        reports: s.reports,
      })(altered),
    ).toThrow();
  },
);
it.each([
  'owner',
  'contact',
  'report',
  'zero-version',
  'negative-version',
  'state',
  'expired-parent',
  'expired-before-send',
])('refuses unusable %s send context before creating a capability', async (mode) => {
  const s = setup();
  const input = {
    ...s.input,
    reportExpiresAt: mode === 'expired-parent' ? at(14) : at(18),
    send: {
      ...s.input.send,
      ...(mode === 'owner' ? { ownerId: key('subject', 99) } : {}),
      ...(mode === 'contact' ? { contactId: null } : {}),
      ...(mode === 'report' ? { reportId: null } : {}),
      ...(mode === 'zero-version' ? { reportVersion: 0 } : {}),
      ...(mode === 'negative-version' ? { reportVersion: -1 } : {}),
      ...(mode === 'state' ? { state: 'cancelled' as const } : {}),
      ...(mode === 'expired-before-send' ? { sendAfter: at(21) } : {}),
    },
  };
  await expect(s.capture.capture(tx, input)).rejects.toThrow();
  expect(s.share).not.toHaveBeenCalled();
});
