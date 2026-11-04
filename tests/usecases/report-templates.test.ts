import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
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
function renderer(context = templateContext()) {
  return createReportTemplateRenderer({
    hash: 'b'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context: () => context,
  });
}
it('creates a real readable PDF with a fixed document date and safe public annotations', async () => {
  const out = await renderer().render(templateDocument());
  expect(out.fixture).toBe(true);
  expect(out.commercial).toBe(false);
  const bytes = Buffer.from(out.pdf, 'base64'),
    pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  expect(pdf.getPageCount()).toBeLessThan(8);
  expect(pdf.getCreationDate()!.toISOString()).toBe('2026-11-03T12:00:00.000Z');
  expect(pdf.getTitle()).toBe('Your tire assessment');
  expect(pdf.catalog.get(PDFName.of('Lang'))?.toString()).toContain('en-US');
  expect(pdf.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined(); // No PDF/UA claim.
  const links: string[] = [];
  for (const page of pdf.getPages()) {
    expect(page.getWidth()).toBe(612);
    expect(page.getHeight()).toBe(792);
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annotations)
      for (let i = 0; i < annotations.size(); i++) {
        const a = annotations.lookup(i, PDFDict),
          action = a.lookupMaybe(PDFName.of('A'), PDFDict);
        if (action?.get(PDFName.of('URI'))) links.push(action.get(PDFName.of('URI'))!.toString());
      }
  }
  expect(links.length).toBeGreaterThan(0);
  expect(links.join()).not.toMatch(/#share|#unsubscribe|#verify|preferences/);
  expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
}, 30000);
it('re-renders identical frozen bytes across repeated documents and coalesces duplicate in-flight calls', async () => {
  const r = renderer(),
    d = templateDocument();
  const [a, b] = await Promise.all([r.render(d), r.render(structuredClone(d))]);
  expect(a).toBe(b);
  const later = await r.render(d);
  expect(later).toEqual(a);
  expect(await renderer().render(d)).toEqual(a);
}, 30000);
it('refuses a wrong template/fixture mode and a changed private context without emitting mail', async () => {
  const r = renderer(),
    d = templateDocument();
  await expect(r.render({ ...d, fixture: false })).rejects.toThrow();
  await expect(
    r.render({ ...d, template: { ...d.template, rendererHash: 'c'.repeat(64) } }),
  ).rejects.toThrow();
  await expect(renderer({ ...templateContext(), version: 2 }).render(d)).rejects.toThrow();
});
it('keeps long labels, extreme exact USD ranges, missing data and a four-item comparison inside bounded pages', async () => {
  const d = templateDocument();
  (d.report.products as Record<string, unknown>[])[0]!.model =
    'Éléphant ' + 'LongLabelWithoutSpaces'.repeat(12);
  const prices = d.report.prices as Record<string, unknown>[];
  prices[0]!.installed = {
    low: '9999999999999999900',
    high: '9999999999999999999',
    currency: 'USD',
  };
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
  const out = await renderer({ ...templateContext(), comparisonRevision: '2' }).render(d);
  expect(out.text).toContain('$99,999,999,999,999,999.99 USD');
  expect(out.text).toContain('Quantity unavailable');
  const pdf = await PDFDocument.load(Buffer.from(out.pdf, 'base64'));
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  expect(pdf.getPageCount()).toBeLessThan(12);
  expect(out.html).not.toMatch(/<img|<script|<iframe|@import/i);
}, 30000);

it('produces the same mail bytes in two fresh child processes without any external I/O', () => {
  const children = [0, 1].map(() =>
    spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/templates/render-child.ts'], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 16384,
    }),
  );
  const records = children.map((c) => {
    expect(c.error, c.stderr).toBeUndefined();
    expect(c.status, c.stderr).toBe(0);
    return JSON.parse(c.stdout.trim());
  });
  expect(records[0]).toEqual(records[1]);
  expect(records[0]).toMatchObject({ networkAttempts: 0, fixture: true });
}, 35000);

it('bounds distinct concurrent work and releases refused work before a later valid render', async () => {
  let refuse = true;
  const r = createReportTemplateRenderer({
    hash: 'b'.repeat(64),
    fixture: true,
    profile: templateProfile,
    fonts,
    context: () => {
      if (refuse) throw Error('Frozen context unavailable');
      return templateContext();
    },
  });
  const tasks = Array.from({ length: 5 }, (_, i) =>
    r.render({ ...templateDocument(), policyVersion: 'variant-' + i }),
  );
  const outcomes = await Promise.allSettled(tasks);
  expect(outcomes.every((x) => x.status === 'rejected')).toBe(true);
  expect((outcomes[4] as PromiseRejectedResult).reason.message).toBe('Report renderer busy');
  refuse = false;
  expect((await r.render(templateDocument())).html).toContain('Recorded options');
}, 30000);

it('renders from an actual portable bundled entry point without network or production composition', async () => {
  const parent = resolve('packages/integrations/.local');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'tt-template-bundle-'));
  if (!resolve(directory).startsWith(parent + sep + 'tt-template-bundle-'))
    throw Error('Unexpected fixture cleanup target');
  try {
    const out = await build({
      entryPoints: ['tests/fixtures/templates/render-child.ts'],
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      write: false,
      banner: {
        js: "import { createRequire as __ttCreateRequire } from 'node:module'; const require = __ttCreateRequire(import.meta.url);",
      },
    });
    const file = join(directory, 'render.mjs');
    writeFileSync(file, out.outputFiles[0]!.contents);
    const child = spawnSync(process.execPath, [file], {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 16384,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ networkAttempts: 0, fixture: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 35000);
