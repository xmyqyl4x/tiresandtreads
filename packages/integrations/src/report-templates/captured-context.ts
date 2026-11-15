import type { DeliveryDocument } from '../../../application/src/ports/delivery-services.ts';
import type { ContactCrypto } from '../../../application/src/ports/contact-services.ts';
import type { ReportCrypto } from '../../../application/src/ports/report-services.ts';
import { id, instant } from '../../../domain/src/values/core.ts';
import type { TemplateContext, TemplateProfile } from './types.ts';

// Reconstructs proofs only for previously captured identities. No DB writes, lookup of latest
// report state, clock, authority creation or expiry extension is permitted during rendering.
export function createCapturedDeliveryContext(o: {
  readonly profile: TemplateProfile;
  readonly contacts: ContactCrypto;
  readonly reports: ReportCrypto;
}): (document: DeliveryDocument) => TemplateContext {
  const profile = structuredClone(o.profile);
  return (document) => {
    const l = document.links;
    if (
      !l ||
      l.schemaVersion !== 1 ||
      !id('send', l.sendId).ok ||
      !instant(l.expiresAt).ok ||
      l.reportId !== document.report.reportId ||
      l.version !== document.report.version ||
      l.comparisonRevision !==
        (document.comparison === null ? null : String(document.comparison.revision)) ||
      !id('report_capability', l.share.id).ok ||
      !id('verification', l.reportPreferences.id).ok ||
      (l.offersConfirmation !== null && !id('verification', l.offersConfirmation.id).ok)
    )
      throw Error('Delivery link context unavailable');
    const share = o.reports.token('share', l.share.id, l.share.key.keyVersion),
      report = o.contacts.token(
        'verify',
        l.reportPreferences.id,
        l.reportPreferences.key.keyVersion,
      ),
      preferences = o.contacts.token(
        'unsubscribe',
        l.reportPreferences.id,
        l.reportPreferences.key.keyVersion,
      ),
      offers = l.offersConfirmation
        ? o.contacts.token('verify', l.offersConfirmation.id, l.offersConfirmation.key.keyVersion)
        : null;
    if (
      share.key.digest !== l.share.key.digest ||
      report.key.digest !== l.reportPreferences.key.digest ||
      (offers && offers.key.digest !== l.offersConfirmation!.key.digest)
    )
      throw Error('Delivery link key unavailable');
    return {
      reportId: l.reportId,
      version: l.version,
      comparisonRevision: l.comparisonRevision,
      expiresAt: l.expiresAt,
      viewUrl: profile.origin + profile.routes.report + '#' + share.token,
      preferencesUrl: profile.origin + profile.routes.preferences + '#' + preferences.raw,
      offersConfirmationUrl: offers
        ? profile.origin + profile.routes.confirmation + '#' + offers.raw
        : null,
    };
  };
}
