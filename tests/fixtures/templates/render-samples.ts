// Local synthetic visual evidence only. No transport/provider/production composition.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateDocument, templateContext, templateProfile } from './report.ts';
import { fonts } from './fonts.ts';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (
    typeof input === 'string' &&
    (input.startsWith('data:font/ttf;base64,') ||
      input.startsWith('data:application/octet-stream;base64,'))
  )
    return nativeFetch(input, init);
  throw Error('External I/O prohibited in local rendering');
};
const output = 'docs/implementation/evidence/P1/p1-pr-037-renderer';
const preview = '.local/report-template-preview';
mkdirSync(output, { recursive: true });
mkdirSync(preview, { recursive: true });
const records = [];
for (const name of ['normal', 'missing', 'long-comparison']) {
  const d = templateDocument(),
    context = templateContext();
  if (name === 'missing') {
    d.report.prices = [];
    d.report.products = [];
    d.learning = [];
  }
  if (name === 'long-comparison') {
    (d.report.products as Record<string, unknown>[])[0]!.model =
      '[Éléphant Āccénted éxpándéd ' + 'LongLabelWithoutSpaces'.repeat(12) + ']';
    context.comparisonRevision = '2';
    d.comparison = {
      revision: '2',
      items: Array.from({ length: 4 }, (_, i) => ({
        slot: i + 1,
        kind: 'quote',
        snapshot: {
          price: { installed: null, merchandise: null, quantity: null },
          verdict: { relation: 'not_comparable', evidenceMissing: true },
        },
      })),
    };
  }
  const r = createReportTemplateRenderer({
    hash: 'b'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context: () => context,
  });
  const mail = await r.render(d),
    pdf = Buffer.from(mail.pdf, 'base64');
  writeFileSync(output + '/' + name + '.pdf', pdf);
  writeFileSync(preview + '/' + name + '.html', mail.html);
  writeFileSync(
    preview + '/' + name + '-forced-dark.html',
    mail.html.replace(
      '@media(prefers-color-scheme:dark){.email-body,.email-card{background:#1c2023!important;color:#f3f4f4!important}.email-link{color:#9ec5ff!important}}',
      '.email-body,.email-card{background:#1c2023!important;color:#f3f4f4!important}.email-link{color:#9ec5ff!important}',
    ),
  );
  writeFileSync(preview + '/' + name + '.txt', mail.text);
  records.push({
    name,
    pdfBytes: pdf.length,
    pdfSha256: createHash('sha256').update(pdf).digest('hex'),
    htmlBytes: Buffer.byteLength(mail.html),
    textBytes: Buffer.byteLength(mail.text),
    fixture: true,
    images: 0,
  });
}
writeFileSync(
  output + '/samples.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      scope: 'synthetic local renderer evidence',
      records,
      actualRecipientNotifications: 0,
      casesClosed: 0,
      gatesClosed: 0,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(records));
