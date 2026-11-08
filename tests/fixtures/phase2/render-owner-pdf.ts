import { createAnalysisReportRenderer } from '../../../packages/integrations/src/analysis-delivery-renderer.ts';
import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateDocument, templateContext, templateProfile } from '../templates/report.ts';
import { fonts } from '../templates/fonts.ts';
if (process.argv.length !== 2) throw Error('Fixed PDF visual proof accepts no arguments');
const hash = 'c'.repeat(64),
  base = createReportTemplateRenderer({
    hash: 'b'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context: () => templateContext(),
  }),
  document = templateDocument();
const result = await createAnalysisReportRenderer(base, hash).render({
  ...document,
  template: { ...document.template, rendererHash: hash },
  analysis: {
    schema: 1,
    mode: 'artifact',
    attachmentRevision: '9999999999999999999',
    artifactHash: 'a'.repeat(64),
    output: {
      schema: 1,
      kind: 'ai_assisted_selection',
      summary: 'These explanations refer only to facts recorded in the deterministic report.',
      claims: [],
      limitations: ['source_limits'],
      questions: ['verify_fitment', 'measure_tread', 'verify_dot', 'confirm_total'],
    },
  },
} as Parameters<ReturnType<typeof createAnalysisReportRenderer>['render']>[0]);
// The caller captures this bounded synthetic artifact for rendering; it is not a delivery.
process.stdout.write(result.pdf);
