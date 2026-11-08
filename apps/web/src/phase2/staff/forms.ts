import { csvApiInputs } from '../../../../../packages/contracts/src/phase2-partners.ts';
import { text, utcDate } from '../partner/forms.ts';
export const csvMetadata = (f: FormData) =>
  csvApiInputs.upload.parse({
    templateId: text(f, 'template'),
    providerId: text(f, 'provider'),
    licenseId: text(f, 'license'),
    market: 'US',
    effectiveAt: utcDate(f, 'effective'),
    externalVersion: text(f, 'externalVersion'),
  });
export const templateInput = (f: FormData) =>
  csvApiInputs.template.parse({
    mapping: text(f, 'mapping'),
    version: Number(text(f, 'version')),
    maxRows: Number(text(f, 'maxRows')),
    maxBytes: Number(text(f, 'maxBytes')),
    state: 'active',
  });
