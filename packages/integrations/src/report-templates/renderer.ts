import { createHash } from 'node:crypto';
import type {
  ReportRenderer,
  DeliveryDocument,
} from '../../../application/src/ports/delivery-services.ts';
import { validateMail, type FixedMail } from '../../../domain/src/delivery-policy.ts';
import { presentReport } from './presentation.ts';
import { renderReportEmail } from './email.ts';
import { renderReportPdf } from './pdf.ts';
import type { TemplateProfile, TemplateContext, TemplateFonts } from './types.ts';
export type { TemplateProfile, TemplateContext, TemplateFonts } from './types.ts';
// Composition supplies a reviewed installed-artifact hash and an already-frozen context lookup.
// It must not mint/extend grants or query latest data. This factory does not select a provider.
export function createReportTemplateRenderer(o: {
  readonly hash: string;
  readonly fixture: boolean;
  readonly profile: TemplateProfile;
  readonly fonts: TemplateFonts;
  readonly context: (document: DeliveryDocument) => TemplateContext;
}): ReportRenderer {
  if (!/^[a-f0-9]{64}$/.test(o.hash) || typeof o.fixture !== 'boolean')
    throw Error('Invalid report renderer');
  const profile = structuredClone(o.profile),
    fonts = { regular: new Uint8Array(o.fonts.regular), bold: new Uint8Array(o.fonts.bold) };
  const active = new Map<string, Promise<FixedMail>>();
  return Object.freeze({
    hash: o.hash,
    fixture: o.fixture,
    render(raw: DeliveryDocument): Promise<FixedMail> {
      if (raw.fixture !== o.fixture || raw.template.rendererHash !== o.hash)
        return Promise.reject(Error('Report template version unavailable'));
      if (Buffer.byteLength(JSON.stringify(raw)) > 524288)
        return Promise.reject(Error('Report template size unavailable'));
      const document = structuredClone(raw),
        digest = createHash('sha256').update(JSON.stringify(document)).digest('hex');
      const previous = active.get(digest);
      if (previous) return previous;
      if (active.size >= 4) return Promise.reject(Error('Report renderer busy'));
      const task = Promise.resolve()
        .then(async () => {
          const v = presentReport(document, profile, o.context(structuredClone(document)));
          const [email, pdf] = await Promise.all([renderReportEmail(v), renderReportPdf(v, fonts)]);
          return Object.freeze(
            validateMail({
              ...email,
              pdf: Buffer.from(pdf).toString('base64'),
              fixture: o.fixture,
              commercial: false,
            }),
          );
        })
        .finally(() => {
          active.delete(digest);
        });
      active.set(digest, task);
      return task;
    },
  });
}
