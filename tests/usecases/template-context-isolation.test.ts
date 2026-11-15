import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { createReportTemplateRenderer } from '../../packages/integrations/src/report-templates/renderer.ts';
import {
  templateContext,
  templateDocument,
  templateProfile,
} from '../fixtures/templates/report.ts';

const fonts = {
  regular: readFileSync(
    new URL(
      '../../packages/integrations/assets/report-fonts/NotoSans-Regular.ttf',
      import.meta.url,
    ),
  ),
  bold: readFileSync(
    new URL('../../packages/integrations/assets/report-fonts/NotoSans-Bold.ttf', import.meta.url),
  ),
};
function renderer(context: () => ReturnType<typeof templateContext>) {
  return createReportTemplateRenderer({
    hash: 'b'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context,
  });
}

it('keeps simultaneous recipient preference contexts separate for the same saved report', async () => {
  const first = templateContext(),
    second = {
      ...first,
      preferencesUrl: first.preferencesUrl.replace('a'.repeat(64), 'c'.repeat(64)),
    };
  let current = first;
  const r = renderer(() => current),
    a = r.render(templateDocument());
  current = second;
  const b = r.render(templateDocument()),
    [left, right] = await Promise.all([a, b]);
  expect(left.html).toContain(first.preferencesUrl);
  expect(left.html).not.toContain(second.preferencesUrl);
  expect(right.html).toContain(second.preferencesUrl);
  expect(right.html).not.toContain(first.preferencesUrl);
}, 30000);

it('captures the link context before asynchronous rendering can observe a later mutation', async () => {
  const current = templateContext(),
    original = current.preferencesUrl,
    r = renderer(() => current),
    task = r.render(templateDocument());
  current.preferencesUrl = current.preferencesUrl.replace('a'.repeat(64), 'd'.repeat(64));
  const out = await task;
  expect(out.html).toContain(original);
  expect(out.html).not.toContain(current.preferencesUrl);
}, 30000);

it('validates each supplied context even while a valid copy of the report is already rendering', async () => {
  let current = templateContext();
  const r = renderer(() => current),
    valid = r.render(templateDocument());
  current = { ...current, reportId: '10000000-0000-4000-8000-000000000099' };
  const invalid = r.render(templateDocument()),
    results = await Promise.allSettled([valid, invalid]);
  expect(results[0]!.status).toBe('fulfilled');
  expect(results[1]!.status).toBe('rejected');
}, 30000);

it('refuses a failed context lookup without reusing or poisoning another request', async () => {
  let unavailable = false;
  const r = renderer(() => {
      if (unavailable) throw Error('Synthetic context unavailable');
      return templateContext();
    }),
    valid = r.render(templateDocument());
  unavailable = true;
  const refused = r.render(templateDocument()),
    results = await Promise.allSettled([valid, refused]);
  expect(results[0]!.status).toBe('fulfilled');
  expect(results[1]!.status).toBe('rejected');
}, 30000);
