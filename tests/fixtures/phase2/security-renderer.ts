import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateContext, templateProfile } from '../templates/report.ts';
import { fonts } from '../templates/fonts.ts';
// The real renderer with fixed synthetic context; not a grant issuer or live sender profile.
export function securityRenderer() {
  return createReportTemplateRenderer({
    hash: 'd'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context: (document) => ({
      ...templateContext(),
      reportId: String(document.report.reportId),
      version: Number(document.report.version),
    }),
  });
}
