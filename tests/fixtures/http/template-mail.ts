import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateProfile } from '../templates/report.ts';
import { fonts } from '../templates/fonts.ts';
// Synthetic URLs are renderer inputs, not minted capabilities or an authentication proof.
// Only the disposable HTTP fixture may select this sink. No actual mail adapter is composed.
export const templateMailProof = {
  renderer(hash: string) {
    return createReportTemplateRenderer({
      hash,
      fixture: true,
      profile: templateProfile,
      fonts,
      context: (d) => {
        const reportId = String(d.report.reportId),
          asOf = String((d.report.result as Record<string, unknown>).asOf),
          proof = (kind: string) => `${kind}.synthetic.${reportId}.${'a'.repeat(64)}`;
        return {
          reportId,
          version: Number(d.report.version),
          comparisonRevision: d.comparison === null ? null : String(d.comparison.revision),
          expiresAt: new Date(Date.parse(asOf) + 86400000).toISOString(),
          viewUrl: templateProfile.origin + templateProfile.routes.report + '#' + proof('share'),
          preferencesUrl:
            templateProfile.origin +
            templateProfile.routes.preferences +
            '#' +
            proof('unsubscribe'),
          offersConfirmationUrl: null,
        };
      },
    });
  },
};
