import { createCapturedDeliveryContext } from '../../../packages/integrations/src/report-templates/captured-context.ts';
import type { createContactCrypto } from '../../../packages/integrations/src/contact-crypto.ts';
import type { fixtureReportCrypto } from './report-services.ts';
import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateProfile } from '../templates/report.ts';
import { fonts } from '../templates/fonts.ts';
// Disposable, transaction-captured capabilities use the same synthetic keys as the local API.
// Only the disposable HTTP fixture may select this sink. No actual mail adapter is composed.
export const templateMailProof = {
  renderer(
    hash: string,
    keys: {
      contacts: ReturnType<typeof createContactCrypto>;
      reports: ReturnType<typeof fixtureReportCrypto>;
    },
  ) {
    return createReportTemplateRenderer({
      hash,
      fixture: true,
      profile: templateProfile,
      fonts,
      context: createCapturedDeliveryContext({ profile: templateProfile, ...keys }),
    });
  },
};
