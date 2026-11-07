import { canonical } from '../../application/src/services/service-records.ts';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type {
  ReportRenderer,
  DeliveryDocument,
} from '../../application/src/ports/delivery-services.ts';
import { freezeAnalysis, analysisDeliveryText } from '../../domain/src/analysis-delivery.ts';
import { validateMail } from '../../domain/src/delivery-policy.ts';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
// The supplied base renderer and frozen document are the only inputs. No inference, latest
// artifact lookup, network fetch, grant issuance or recipient notification belongs here.
export function createAnalysisReportRenderer(base: ReportRenderer, hash: string): ReportRenderer {
  if (!/^[a-f0-9]{64}$/.test(hash) || hash === base.hash)
    throw Error('Distinct reviewed composite renderer hash required');
  const active = new Map<string, Promise<ReturnType<typeof validateMail>>>();
  async function render(raw: DeliveryDocument) {
    if (raw.template.rendererHash !== hash) throw Error('Composite renderer version unavailable');
    const { analysis, analysisIdentity, ...document } = raw as DeliveryDocument & {
      analysis: unknown;
      analysisIdentity?: unknown;
    };
    const selected = freezeAnalysis(analysis),
      lines = analysisDeliveryText(selected);
    if (analysisIdentity !== undefined) {
      const expected =
        selected.mode === 'none'
          ? { schema: 1, mode: 'none', fallback: selected.fallback }
          : {
              schema: 1,
              mode: 'artifact',
              attachmentRevision: selected.attachmentRevision,
              artifactHash: selected.artifactHash,
            };
      if (canonical(analysisIdentity, 4096) !== canonical(expected, 4096))
        throw Error('Frozen analysis identity mismatch');
    }
    const mail = validateMail(
      await base.render({
        ...document,
        template: { ...document.template, rendererHash: base.hash },
      }),
    );
    const pdf = await PDFDocument.load(
      Uint8Array.from(atob(mail.pdf), (c) => c.charCodeAt(0)),
      { updateMetadata: false },
    );
    const font = await pdf.embedFont(StandardFonts.Helvetica),
      page = pdf.addPage([612, 792]);
    let y = 740;
    for (const line of lines) {
      const words = line.split(' ');
      let row = '';
      for (const word of words) {
        if ((row + ' ' + word).length > 88) {
          page.drawText(row, { x: 40, y, size: 10, font });
          y -= 16;
          row = '';
        }
        row += (row ? ' ' : '') + word;
      }
      page.drawText(row, { x: 40, y, size: 10, font });
      y -= 28;
    }
    const bytes = await pdf.save({ useObjectStreams: false });
    const section =
      '<section aria-label="AI assistance">' +
      lines.map((x) => '<p>' + escape(x) + '</p>').join('') +
      '</section>';
    const html = /<\/body>/i.test(mail.html)
      ? mail.html.replace(/<\/body>/i, section + '$&')
      : mail.html + section;
    return Object.freeze(
      validateMail({
        ...mail,
        html,
        text: mail.text + '\n\n' + lines.join('\n'),
        pdf: Buffer.from(bytes).toString('base64'),
      }),
    );
  }
  return Object.freeze({
    hash,
    fixture: base.fixture,
    render(raw: DeliveryDocument) {
      if (raw.fixture !== base.fixture || Buffer.byteLength(JSON.stringify(raw)) > 524288)
        return Promise.reject(Error('Analysis presentation unavailable'));
      const document = structuredClone(raw),
        key = createHash('sha256').update(JSON.stringify(document)).digest('hex'),
        prior = active.get(key);
      if (prior) return prior;
      if (active.size >= 4) return Promise.reject(Error('Analysis renderer busy'));
      const task = Promise.resolve()
        .then(() => render(document))
        .finally(() => active.delete(key));
      active.set(key, task);
      return task;
    },
  });
}
