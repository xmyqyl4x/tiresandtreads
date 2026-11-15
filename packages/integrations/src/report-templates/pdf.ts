import { comparisonCopy } from '../../../contracts/src/report-display.ts';
import { messages } from './messages.ts';
import { TaggedPdfDocument } from './pdf-document.ts';
import type { ReportPresentation, TemplateFonts, PresentedOption } from './types.ts';

let tail = Promise.resolve(),
  pending = 0;
const ink = '#1c2023',
  blue = '#1d4e9e',
  width = 528,
  bottom = 734;

// Each render owns its font/structure state. Serialize and bound work to limit peak memory.
export async function renderReportPdf(
  v: ReportPresentation,
  fonts: TemplateFonts,
): Promise<Uint8Array> {
  if (pending >= 4) throw Error('Report renderer busy');
  pending++;
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    for (const font of [fonts.regular, fonts.bold])
      if (font.length < 32 || font.length > 2000000) throw Error('Report fonts unavailable');
    const doc = new TaggedPdfDocument({
      tagged: true,
      bufferPages: true,
      size: 'LETTER',
      pdfVersion: '1.7',
      margins: { top: 54, left: 42, right: 42, bottom: 58 },
      lang: 'en-US',
      displayTitle: true,
      info: {
        Title: v.title,
        Author: v.senderName,
        Subject: 'Saved historical tire assessment - version ' + v.reference.version,
        Creator: 'Tires & Tread template v1',
        Producer: 'Tires & Tread template v1',
        CreationDate: new Date(v.asOf),
        ModDate: new Date(v.asOf),
      },
    });
    return await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      doc.on('error', reject);
      doc.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) {
          doc.destroy();
          reject(Error('Report PDF size unavailable'));
        } else chunks.push(chunk);
      });
      doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      try {
        doc.registerFont('Body', Buffer.from(fonts.regular));
        doc.registerFont('Bold', Buffer.from(fonts.bold));
        const root = doc.struct('Document');
        doc.addStructure(root);
        function paragraph(text: string, role = 'P', size = 10, link?: string) {
          root.add(
            doc.struct(role, () => {
              doc
                .font(role.startsWith('H') ? 'Bold' : 'Body')
                .fontSize(size)
                .fillColor(link ? blue : ink);
              // Spaces are part of marked content; wrapping never clips a fixed-height box.
              doc.text(text + ' ', {
                width,
                lineGap: 3,
                ...(link ? { link, underline: true } : {}),
              });
              doc.y += 8;
            }),
          );
        }
        function heading(text: string, role = 'H2', size = 16) {
          // Keep a heading with the beginning of its following section, even across pages.
          if (doc.y + 100 > bottom) doc.addPage();
          paragraph(text, role, size);
        }
        function reserve(values: readonly { text: string; size: number; bold: boolean }[]) {
          const height = values.reduce((total, value) => {
            doc.font(value.bold ? 'Bold' : 'Body').fontSize(value.size);
            return total + doc.heightOfString(value.text + ' ', { width, lineGap: 3 }) + 8;
          }, 0);
          if (height <= bottom - 54 && doc.y + height > bottom) doc.addPage();
        }
        function optionText(o: PresentedOption) {
          return [
            o.status,
            o.size,
            ...(o.product ? [o.product] : []),
            ...(o.fitment ? ['Fitment: ' + o.fitment] : []),
            ...(o.climate ? ['Climate: ' + o.climate] : []),
            'Preference score: ' + o.score + '; ' + o.evidenceLabel + ': ' + o.evidence,
            'Installed estimate (' + o.quantity + '): ' + o.installed,
            (o.kind === 'quote' ? comparisonCopy.quoteBase : comparisonCopy.catalogBase) +
              ': ' +
              o.merchandise,
            ...(o.kind === 'quote' ? [comparisonCopy.quoteInclusion] : []),
            ...(o.difference ? ['Quote minus observed installed range: ' + o.difference] : []),
            ...o.reasons.map((r) => '- ' + r),
          ];
        }
        function optionBlock(o: PresentedOption) {
          return [
            { text: o.label, size: 13, bold: true },
            ...optionText(o).map((text) => ({ text, size: 10, bold: false })),
          ];
        }
        function option(o: PresentedOption) {
          reserve(optionBlock(o));
          heading(o.label, 'H3', 13);
          optionText(o).forEach((text) => paragraph(text));
        }
        paragraph(v.title, 'H1', 25);
        if (v.fixture) paragraph(messages.preview);
        paragraph(
          'Saved report version ' +
            v.reference.version +
            ' - assessed ' +
            new Date(v.asOf).toUTCString(),
        );
        paragraph(v.disclosure);
        paragraph(v.inputSummary);
        if (v.options[0])
          reserve([{ text: messages.options, size: 16, bold: true }, ...optionBlock(v.options[0])]);
        heading(messages.options);
        if (v.options.length) v.options.forEach(option);
        else paragraph(messages.empty);
        if (v.comparison.length) {
          const title = 'Comparison revision ' + v.reference.comparisonRevision;
          reserve([{ text: title, size: 16, bold: true }, ...optionBlock(v.comparison[0]!)]);
          heading(title);
          v.comparison.forEach(option);
          paragraph(comparisonCopy.noScenario);
        }
        if (v.decisions.length) {
          heading(messages.decisions);
          v.decisions.forEach((text) => paragraph(text));
          paragraph(messages.compact);
        }
        heading(messages.maintenanceHeading);
        paragraph(messages.maintenance);
        heading(messages.learn);
        if (v.learning.length) for (const l of v.learning) paragraph(l.title, 'Link', 10, l.url);
        else paragraph(messages.noLearning);
        reserve([
          { text: messages.provenance, size: 16, bold: true },
          ...v.provenance.map((text) => ({ text, size: 10, bold: false })),
        ]);
        heading(messages.provenance);
        v.provenance.forEach((text) => paragraph(text));
        heading('About this saved copy');
        paragraph('Report reference: ' + v.reference.reportId + '; version ' + v.reference.version);
        paragraph(
          'This PDF contains no email preference proofs or recipient address. Access to current source evidence or private downloads remains subject to expiry and revocation.',
        );
        paragraph(messages.privacy, 'Link', 10, v.links.privacy);
        const pages = doc.bufferedPageRange();
        if (pages.count > 40) throw Error('Report PDF page limit unavailable');
        for (let i = pages.start; i < pages.start + pages.count; i++) {
          doc.switchToPage(i);
          doc.markContent('Artifact', { type: 'Pagination', attached: ['Top'] });
          doc
            .font('Bold')
            .fontSize(10)
            .fillColor(ink)
            .text(v.senderName, 42, 20, { lineBreak: false });
          doc.endMarkedContent();
          doc.markContent('Artifact', { type: 'Pagination', attached: ['Bottom'] });
          doc
            .font('Body')
            .fontSize(9)
            .fillColor('#52606d')
            .text(
              'Saved version ' + v.reference.version + ' | Page ' + (i + 1) + ' of ' + pages.count,
              42,
              752,
              { lineBreak: false },
            );
          doc.endMarkedContent();
        }
        root.end();
        doc.end();
      } catch (error) {
        doc.destroy();
        reject(error);
      }
    });
  } finally {
    pending--;
    release();
  }
}
