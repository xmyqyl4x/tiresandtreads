import { createHash } from 'node:crypto';
import { createReportTemplateRenderer } from '../../../packages/integrations/src/report-templates/renderer.ts';
import { templateContext, templateDocument, templateProfile } from './report.ts';
import { fonts } from './fonts.ts';
let networkAttempts = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (
    typeof input === 'string' &&
    (input.startsWith('data:font/ttf;base64,') ||
      input.startsWith('data:application/octet-stream;base64,'))
  )
    return nativeFetch(input, init);
  networkAttempts++;
  throw Error('No external I/O in the template proof');
};
const r = createReportTemplateRenderer({
  hash: 'b'.repeat(64),
  fixture: true,
  profile: templateProfile,
  fonts,
  context: () => templateContext(),
});
const out = await r.render(templateDocument());
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
console.log(
  JSON.stringify({
    html: hash(out.html),
    text: hash(out.text),
    pdf: hash(out.pdf),
    networkAttempts,
    fixture: out.fixture,
  }),
);
