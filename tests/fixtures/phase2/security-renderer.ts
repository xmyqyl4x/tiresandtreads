import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateContext, templateProfile } from '../templates/report.ts';
import { fonts } from '../templates/fonts.ts';
// Synthetic link metadata is fixed relative to the frozen report, never the wall clock.
// It is not a grant issuer or live sender profile.
export function securityRenderer() {
  return createReportTemplateRenderer({
    hash: 'd'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context: (document) => {
      const asOf = (document.report.result as { asOf?: unknown } | undefined)?.asOf;
      if (typeof asOf !== 'string') throw Error('Frozen synthetic report time required');
      return {
        ...templateContext(),
        reportId: String(document.report.reportId),
        version: Number(document.report.version),
        expiresAt: new Date(Date.parse(asOf) + 7 * 86400000).toISOString(),
      };
    },
  });
}
