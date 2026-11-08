import { it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createAnalysisReportRenderer } from '../../packages/integrations/src/analysis-delivery-renderer.ts';
import { createReportTemplateRenderer } from '../../packages/integrations/src/report-templates/renderer.ts';
import {
  templateDocument,
  templateContext,
  templateProfile,
} from '../fixtures/templates/report.ts';
import { fonts } from '../fixtures/templates/fonts.ts';
const hash = 'c'.repeat(64),
  base = () =>
    createReportTemplateRenderer({
      hash: 'b'.repeat(64),
      fixture: true,
      profile: templateProfile,
      fonts,
      context: () => templateContext(),
    });
function selected() {
  return {
    schema: 1,
    mode: 'artifact',
    attachmentRevision: '3',
    artifactHash: 'a'.repeat(64),
    output: {
      schema: 1,
      kind: 'ai_assisted_selection',
      summary: 'These explanations refer only to facts recorded in the deterministic report.',
      claims: [],
      limitations: ['source_limits'],
      questions: ['verify_fitment', 'confirm_total'],
    },
  };
}
function document(analysis: unknown = selected()) {
  const d = templateDocument();
  return { ...d, template: { ...d.template, rendererHash: hash }, analysis };
}
it('renders frozen reviewed assistance into real HTML/text/PDF without repeating model numeric claims', async () => {
  const b = base(),
    r = createAnalysisReportRenderer(b, hash),
    out = await r.render(document()),
    original = await b.render(templateDocument()),
    pdf = await PDFDocument.load(Buffer.from(out.pdf, 'base64')),
    p1 = await PDFDocument.load(Buffer.from(original.pdf, 'base64'));
  expect(out.html).toContain('AI-assisted installer questions');
  expect(out.text).toContain('complete installed total');
  expect(out.text).toContain('does not establish fitment');
  expect(out.text).toContain('Frozen attachment revision 3');
  expect(out.text).toContain('Personalized claims and citations remain in the private owner view');
  expect(pdf.getPageCount()).toBe(p1.getPageCount() + 1);
  expect(pdf.getCreationDate()).toEqual(p1.getCreationDate());
  expect(out.commercial).toBe(false);
}, 30000);
it('coalesces concurrent requests, copies input and emits identical frozen bytes on retries', async () => {
  const r = createAnalysisReportRenderer(base(), hash),
    selection = selected(),
    d = document(selection),
    a = r.render(d),
    b = r.render(structuredClone(d));
  selection.output.questions.push('verify_dot');
  expect(a).toBe(b);
  const out = await a;
  expect(out.text).not.toContain('DOT identification');
  expect(await r.render(document())).toEqual(out);
}, 30000);
it('renders a shared generic selection in real HTML/text/PDF using fixed reviewed copy', async () => {
  const out = await createAnalysisReportRenderer(base(), hash).render(
    document({
      ...selected(),
      output: {
        schema: 1,
        kind: 'reviewed_generic_explanation',
        claims: [
          {
            text: '<img src=x onerror=alert(1)> PRIVATE_RAW_PROSE',
            adviceId: '11111111-1111-4111-8111-111111111111',
            sourceId: '22222222-2222-4222-8222-222222222222',
          },
        ],
        questions: ['verify_fitment'],
        limitations: [
          'deterministic_authority',
          'physical_inspection_required',
          'no_recall_clearance',
        ],
      },
    }),
  );
  expect(out.text).toContain('Reviewed general installer questions');
  expect(out.html).toContain('reviewed general guidance');
  expect(out.html + out.text).not.toContain('PRIVATE_RAW_PROSE');
  expect(out.html).not.toContain('<img src=x');
  expect((await PDFDocument.load(Buffer.from(out.pdf, 'base64'))).getPageCount()).toBeGreaterThan(
    1,
  );
}, 30000);
it.each(['not_requested', 'unavailable', 'declined', 'expired'])(
  'keeps explicit %s fallback in all output formats',
  async (fallback) => {
    const out = await createAnalysisReportRenderer(base(), hash).render(
      document({ schema: 1, mode: 'none', fallback }),
    );
    expect(out.text).toContain('AI assistance was not included');
    expect(out.text).toContain('Selection: ' + fallback.replaceAll('_', ' '));
    expect(out.html).not.toContain('AI-assisted installer questions');
    expect((await PDFDocument.load(Buffer.from(out.pdf, 'base64'))).getPageCount()).toBeGreaterThan(
      1,
    );
  },
  30000,
);
it('refuses invalid selection, renderer drift, oversized input and fixture changes', async () => {
  const r = createAnalysisReportRenderer(base(), hash);
  await expect(
    r.render(
      document({ ...selected(), output: { ...selected().output, summary: 'safe to drive' } }),
    ),
  ).rejects.toThrow();
  await expect(r.render({ ...document(), fixture: false })).rejects.toThrow();
  await expect(
    r.render({ ...document(), report: { ...document().report, extra: 'x'.repeat(524289) } }),
  ).rejects.toThrow();
  const d = document();
  d.template.rendererHash = 'f'.repeat(64);
  await expect(r.render(d)).rejects.toThrow();
  expect(() => createAnalysisReportRenderer(base(), 'b'.repeat(64))).toThrow();
});
