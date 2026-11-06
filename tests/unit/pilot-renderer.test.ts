import { it, expect, vi } from 'vitest';
import { createPilotRenderer } from '../../packages/integrations/src/pilot-renderer.ts';
import { createReportTemplateRenderer } from '../../packages/integrations/src/report-templates/renderer.ts';
import {
  templateDocument,
  templateContext,
  templateProfile,
} from '../fixtures/templates/report.ts';
import { fonts } from '../fixtures/templates/fonts.ts';
import { candidate, audience } from '../fixtures/phase2/matching.ts';
import type {
  PilotContext,
  PilotOffer,
} from '../../packages/application/src/ports/pilot-delivery.ts';
import { uuid } from '../fixtures/phase2/compose-partner-services.ts';
const report = createReportTemplateRenderer({
  hash: templateDocument().template.rendererHash,
  fixture: true,
  profile: templateProfile,
  fonts,
  context: () => templateContext(),
});
const options = {
  report,
  fixture: true,
  preferences: () => 'https://preview.example.invalid/unsubscribe?token=synthetic',
  senderName: 'Synthetic Tires',
  postalAddress: ['SYNTHETIC ADDRESS'],
};
const context = {
  reportAllowed: true,
  document: templateDocument(),
  audience,
  sendId: templateDocument().report.reportId,
} as unknown as PilotContext;
const block = {
  offer: {
    ...candidate(),
    poolId: uuid('coupon_pool'),
    mode: 'shared',
    prefix: null,
    caps: [],
  } as PilotOffer,
  code: 'LOCAL-CODE',
  reasons: ['exact_sku'],
};
it('renders real report HTML/text/PDF with a labeled sponsored block and visible one-click preference endpoint', async () => {
  const result = await createPilotRenderer(options).render(context, [block]);
  expect(result.commercial).toBe(true);
  expect(result.html).toContain('Sponsored tire offer');
  expect(result.text).toContain('Why this matches: exact_sku');
  expect(result.pdf).toMatch(/^JVBERi0/);
  expect(result.unsubscribeUrl).toBe(options.preferences());
  expect(result.html).toContain('SYNTHETIC ADDRESS');
  expect(result.stream).toBe('commercial');
  expect(result.headers).toEqual({
    'List-Unsubscribe': '<' + options.preferences() + '>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
});
it('omits every commercial block when there are no eligible offers', async () => {
  const r = await createPilotRenderer(options).render(context, []);
  expect(r.commercial).toBe(false);
  expect(r.html).not.toContain('Sponsored tire offer');
  expect(r.unsubscribeUrl).toBeNull();
  expect(r.stream).toBe('report');
  expect(r.headers).toEqual({});
});
it('does not include the report or a PDF in an offers-only message', async () => {
  const result = await createPilotRenderer(options).render(
    { ...context, reportAllowed: false, document: null },
    [block],
  );
  expect(result.pdf).toBeNull();
  expect(result.subject).toBe('Your tire offers');
  expect(result.text).not.toContain('73.12');
});
it('escapes seller terms and coupon plaintext without executing markup or loading images', async () => {
  const dirty = {
    ...block,
    code: '<img src=x onerror=alert(1)>',
    offer: { ...block.offer, offer: { ...block.offer.offer, title: '<script>bad</script>' } },
  };
  const r = await createPilotRenderer(options).render({ ...context, reportAllowed: false }, [
    dirty,
  ]);
  expect(r.html).not.toMatch(/<script|<img/i);
  expect(r.html).toContain('&lt;script&gt;');
  expect(r.text).toContain('<script>');
});
it.each([
  'http://unsafe.invalid',
  'https://u:p@unsafe.invalid',
  'https://preview.example.invalid/#token',
  'https://preview.example.invalid/a\r\nInjected: x',
  'https://preview.example.invalid/<injected>',
])('refuses unsafe preference URL %s', async (url) => {
  await expect(
    createPilotRenderer({ ...options, preferences: () => url }).render(
      { ...context, reportAllowed: false },
      [block],
    ),
  ).rejects.toThrow();
});
it('refuses missing sender identity and mismatched renderer environments', () => {
  expect(() => createPilotRenderer({ ...options, postalAddress: [] })).toThrow();
  expect(() => createPilotRenderer({ ...options, fixture: false })).toThrow();
});
it('refuses an empty message or an unknown report insertion point', async () => {
  await expect(
    createPilotRenderer(options).render({ ...context, reportAllowed: false }, []),
  ).rejects.toThrow();
  const renderer = createPilotRenderer({
    ...options,
    report: {
      ...report,
      render: vi.fn(async () => ({
        subject: 'x',
        html: '<p>no body</p>',
        text: 'x',
        pdf: 'JVBERi0=',
        commercial: false as const,
        fixture: true,
      })),
    },
  });
  await expect(renderer.render(context, [block])).rejects.toThrow();
});
