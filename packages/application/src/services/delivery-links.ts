import { instant } from '../../../domain/src/values/core.ts';
import type { DeliveryLinkCapture } from '../ports/delivery-links.ts';
import type { ContactCrypto, ContactServiceRepository } from '../ports/contact-services.ts';
import type { ReportCrypto } from '../ports/report-services.ts';
import type { CapabilityRepository } from '../ports/owner-report.ts';
import { demand } from './service-work.ts';

// Runs inside the same request transaction as consent, send, immutable snapshot and outbox.
export function createDeliveryLinkCapture(d: {
  readonly contacts: Pick<ContactServiceRepository, 'intent'>;
  readonly capabilities: Pick<CapabilityRepository, 'share'>;
  readonly contactCrypto: ContactCrypto;
  readonly reportCrypto: ReportCrypto;
  readonly now: () => string;
}): DeliveryLinkCapture {
  return {
    async capture(tx, input) {
      const { owner, send } = input,
        now = d.now();
      demand(instant(now).ok && instant(input.reportExpiresAt).ok);
      demand(
        send.ownerId === owner.subjectId &&
          send.state === 'scheduled' &&
          send.contactId &&
          send.reportId &&
          send.reportVersion !== null &&
          Number.isSafeInteger(send.reportVersion) &&
          send.reportVersion > 0,
        'forbidden',
      );
      demand(input.reportExpiresAt > now, 'forbidden');
      async function intent(id: typeof input.verificationId, purpose: 'report' | 'offers') {
        const i = await d.contacts.intent(tx, id);
        demand(i && i.live && !i.invalidated && !i.usedAt && i.expiresAt > now, 'forbidden');
        demand(
          i.ownerId === owner.subjectId && i.contactId === send.contactId && i.purpose === purpose,
          'forbidden',
        );
        demand(
          i.scope ===
            (purpose === 'report' ? `report:${send.reportId}:${send.reportVersion}` : 'offers'),
          'forbidden',
        );
        const proof = d.contactCrypto.token('verify', i.id, i.key.keyVersion);
        demand(
          proof.key.digest === i.key.digest && proof.key.keyVersion === i.key.keyVersion,
          'forbidden',
        );
        return i;
      }
      const report = await intent(input.verificationId, 'report'),
        offers = input.offersVerificationId
          ? await intent(input.offersVerificationId, 'offers')
          : null,
        expires = instant(
          [
            input.reportExpiresAt,
            report.expiresAt,
            ...(offers ? [offers.expiresAt] : []),
          ].sort()[0],
        );
      demand(expires.ok);
      demand(expires.value > send.sendAfter, 'forbidden');
      const id = d.reportCrypto.id('report_capability', 'email-delivery:' + send.id),
        proof = d.reportCrypto.token('share', id, d.reportCrypto.keyVersion);
      await d.capabilities.share(tx, owner, {
        id,
        reportId: send.reportId,
        version: send.reportVersion,
        comparisonRevision: send.comparisonRevision,
        key: proof.key,
        expiresAt: expires.value,
      });
      return {
        schemaVersion: 1,
        sendId: send.id,
        reportId: send.reportId,
        version: send.reportVersion,
        comparisonRevision: send.comparisonRevision?.toString() ?? null,
        expiresAt: expires.value,
        share: { id, key: proof.key },
        reportPreferences: { id: report.id, key: report.key },
        offersConfirmation: offers ? { id: offers.id, key: offers.key } : null,
      };
    },
  };
}
