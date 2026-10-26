import type { ReportRenderer } from '../../application/src/ports/delivery-services.ts';
// S3/S4 fixture only. Product email and PDF presentation belongs to S5.
export function createFixtureReportRenderer(hash: string): ReportRenderer {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid fixture renderer');
  return {
    hash,
    fixture: true,
    async render(document) {
      if (!document.fixture || document.template.rendererHash !== hash)
        throw Error('Fixture renderer unavailable');
      const label = 'TECHNICAL FIXTURE - NOT TIRE ADVICE';
      const stream = `BT /F1 12 Tf 40 740 Td (${label}) Tj ET`;
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
      let pdf = '%PDF-1.4\n';
      const offsets = [0];
      for (const [i, o] of objects.entries()) {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
      }
      const xref = pdf.length;
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
        .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return {
        subject: '[Technical fixture] Tires & Tread report',
        html: `<p>${label}</p>`,
        text: label,
        pdf: Buffer.from(pdf).toString('base64'),
        fixture: true,
        commercial: false,
      };
    },
  };
}
