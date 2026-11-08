import { it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { securityRenderer } from '../fixtures/phase2/security-renderer.ts';
import { templateDocument } from '../fixtures/templates/report.ts';
it.each(['2026-12-03T12:00:00.000Z', '2035-05-06T07:08:09.000Z'])(
  'renders and retries a frozen report dated %s without inheriting a fixed fixture expiry',
  async (asOf) => {
    const renderer = securityRenderer(),
      document = templateDocument();
    document.template.rendererHash = renderer.hash;
    (document.report.result as { asOf: string }).asOf = asOf;
    // The security composition has no education-link snapshot; isolate its report expiry.
    document.learning = [];
    const mail = await renderer.render(document),
      pdf = await PDFDocument.load(Buffer.from(mail.pdf, 'base64'));
    expect(mail.fixture).toBe(true);
    expect(mail.commercial).toBe(false);
    expect(pdf.getCreationDate()).toEqual(new Date(asOf));
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(mail.html).toContain('Private-link expiry:');
    expect(await renderer.render(structuredClone(document))).toEqual(mail);
  },
  30000,
);
