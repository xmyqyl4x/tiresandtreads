import { publicReport } from '../../packages/application/src/services/report-records.ts';
import { it, expect } from 'vitest';
import { presentReport } from '../../packages/integrations/src/report-templates/presentation.ts';
import { renderReportEmail } from '../../packages/integrations/src/report-templates/email.ts';
import {
  templateContext,
  templateProfile,
  templateDocument,
  ref,
  pick,
} from '../fixtures/templates/report.ts';
it('projects exact frozen report/version, historical USD estimates and independent purpose links', async () => {
  const view = presentReport(templateDocument(), templateProfile, templateContext());
  expect(view.reference).toEqual({ reportId: ref, version: 1, comparisonRevision: null });
  expect(view.options[0]).toMatchObject({
    id: pick,
    label: 'Synthetic Example Touring',
    quantity: '4 tires',
    installed: '$700.00-$950.00 USD',
    merchandise: '$600.00-$800.00 USD',
    score: '73.12 / 100',
  });
  const out = await renderReportEmail(view);
  expect(out.html).toContain('width="600"');
  expect(out.html).toContain('Not a physical inspection or safety clearance');
  expect(out.text).toContain('$700.00-$950.00 USD');
  expect(out.html).toContain('SYNTHETIC ADDRESS');
  expect(out.html).toContain('Manage this report email purpose');
  expect(out.html).not.toMatch(/<script|<img|utm_|tracking|mailto:/i);
});
it('does not invent quantity, zero cost, rankings, a vehicle identity or an offer confirmation', async () => {
  const d = templateDocument();
  d.report.prices = [];
  d.report.products = [];
  const view = presentReport(d, templateProfile, templateContext());
  expect(view.options[0]).toMatchObject({
    label: 'Option 1',
    quantity: 'Quantity unavailable',
    installed: 'Unavailable',
    merchandise: 'Unavailable',
  });
  const out = await renderReportEmail(view);
  expect(out.text).toContain('Vehicle and condition details are unavailable in this frozen copy');
  expect(out.text).not.toContain('$0.00');
  expect(out.html).not.toContain('Confirm offers');
});
it('keeps private fields out of HTML/text and escapes long untrusted labels', async () => {
  const d = templateDocument();
  d.report.privateNotes = 'SECRET PRIVATE NOTE';
  d.report.email = 'private@example.invalid';
  (d.report.products as Record<string, unknown>[])[0]!.model =
    '<script>unsafe()</script>' + 'VeryLongLabel'.repeat(20);
  const out = await renderReportEmail(presentReport(d, templateProfile, templateContext()));
  expect(out.html).toContain('&lt;script&gt;');
  expect(out.html + out.text).not.toContain('SECRET PRIVATE NOTE');
  expect(out.html + out.text).not.toContain('private@example.invalid');
  expect(out.html).not.toContain('<script>unsafe');
  expect(Buffer.byteLength(out.html)).toBeLessThan(100000);
});
it.each([
  'https://evil.example/preview/shared#share.a.b.c',
  'https://preview.example.invalid/preview/shared?token=private',
  'javascript:alert(1)',
])('refuses invalid private link %s', (viewUrl) => {
  expect(() =>
    presentReport(templateDocument(), templateProfile, { ...templateContext(), viewUrl }),
  ).toThrow();
});
it('refuses stale or mismatched context, locale, template and malformed money rather than guessing', () => {
  const d = templateDocument();
  expect(() => presentReport(d, templateProfile, { ...templateContext(), version: 2 })).toThrow();
  expect(() =>
    presentReport(d, templateProfile, {
      ...templateContext(),
      expiresAt: '2026-01-01T00:00:00.000Z',
    }),
  ).toThrow();
  expect(() =>
    presentReport({ ...d, locale: 'unreviewed' }, templateProfile, templateContext()),
  ).toThrow();
  (d.report.prices as Record<string, unknown>[])[0]!.installed = {
    low: '95000',
    high: '70000',
    currency: 'USD',
  };
  expect(() => presentReport(d, templateProfile, templateContext())).toThrow();
});
it('renders comparison snapshots without private shop notes or invented totals', async () => {
  const d = templateDocument();
  d.comparison = {
    revision: '3',
    items: [
      {
        slot: 1,
        kind: 'quote',
        snapshot: {
          notes: 'PRIVATE SHOP',
          price: { quantity: null, installed: null, merchandise: null },
          verdict: {
            fit: 'unverified',
            climate: 'unknown',
            relation: 'not_comparable',
            score: null,
            evidenceMissing: true,
          },
        },
      },
    ],
  };
  const view = presentReport(d, templateProfile, { ...templateContext(), comparisonRevision: '3' });
  expect(view.comparison[0]).toMatchObject({
    label: 'Private quote 1',
    quantity: 'Quantity unavailable',
    installed: 'Unavailable',
  });
  const out = await renderReportEmail(view);
  expect(out.text).toContain('Comparison revision 3');
  expect(out.html + out.text).not.toContain('PRIVATE SHOP');
});
it('takes an immutable snapshot and never reads the clock, chooses links or changes the source', () => {
  const d = templateDocument(),
    before = structuredClone(d),
    context = templateContext();
  const a = presentReport(d, templateProfile, context);
  context.viewUrl = 'bad';
  expect(d).toEqual(before);
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(a.options[0])).toBe(true);
  expect(a.links.view).toContain('/preview/shared#share.');
});

it('prefers an exact SKU match when multiple products share a model and never aligns prices by position', () => {
  const d = templateDocument();
  const products = d.report.products as Record<string, unknown>[];
  products.push({ ...products[0], id: ref, model: 'Different SKU' });
  const row = (d.report.prices as Record<string, unknown>[])[0]!;
  row.planId = ref;
  const view = presentReport(d, templateProfile, templateContext());
  expect(view.options[0]!.label).toBe('Synthetic Example Touring');
  expect(view.options[0]!.installed).toBe('Unavailable');
});
it('shows offers confirmation only with its distinct frozen purpose proof', async () => {
  const c = templateContext();
  c.offersConfirmationUrl = c.preferencesUrl
    .replace('email-preferences', 'email-confirmation')
    .replace('#unsubscribe.', '#verify.');
  const out = await renderReportEmail(presentReport(templateDocument(), templateProfile, c));
  expect(out.html).toContain(c.offersConfirmationUrl);
  expect(out.html).toContain(c.preferencesUrl);
  expect(() =>
    presentReport(templateDocument(), templateProfile, { ...c, offersConfirmationUrl: c.viewUrl }),
  ).toThrow();
});

it.each([0, 1, 2, 3])(
  'preserves validated confidence %s only in internal delivery capture',
  (confidenceValue) => {
    const d = templateDocument();
    (d.report.result as Record<string, unknown>).decisions = [
      { id: pick, status: 'eligible', reasons: [], scoreBp: 0, confidence: confidenceValue },
    ];
    const internal = publicReport(d.report, true),
      external = publicReport(d.report);
    expect(
      ((internal.result as Record<string, unknown>).decisions as Record<string, unknown>[])[0]!
        .confidence,
    ).toBe(confidenceValue);
    expect(
      ((external.result as Record<string, unknown>).decisions as Record<string, unknown>[])[0]!,
    ).not.toHaveProperty('confidence');
  },
);
it('refuses corrupt stored confidence in internal delivery presentation', () => {
  const d = templateDocument();
  (d.report.result as Record<string, unknown>).decisions = [
    { id: pick, status: 'eligible', reasons: [], scoreBp: 0, confidence: 4 },
  ];
  expect(() => publicReport(d.report, true)).toThrow();
});

it('keeps absent and null confidence unknown without coercing corrupt values', () => {
  const d = templateDocument();
  for (const confidenceValue of [undefined, null]) {
    (d.report.result as Record<string, unknown>).decisions = [
      { id: pick, status: 'eligible', reasons: [], scoreBp: 0, confidence: confidenceValue },
    ];
    const internal = publicReport(d.report, true);
    expect(
      ((internal.result as Record<string, unknown>).decisions as Record<string, unknown>[])[0]!,
    ).not.toHaveProperty('confidence');
  }
  for (const confidenceValue of ['2', -1, 1.5]) {
    (d.report.result as Record<string, unknown>).decisions = [
      { id: pick, status: 'eligible', reasons: [], scoreBp: 0, confidence: confidenceValue },
    ];
    expect(() => publicReport(d.report, true)).toThrow();
  }
});

it('distinguishes an inclusive quote base from a catalog merchandise estimate', async () => {
  const d = templateDocument();
  d.comparison = {
    revision: '1',
    items: [
      {
        slot: 1,
        kind: 'quote',
        snapshot: {
          productKnown: true,
          fit: 'eligible',
          climate: 'suitable',
          scoreBp: null,
          price: {
            quantity: 4,
            merchandise: { low: '74900', high: '74900', currency: 'USD' },
            installed: { low: '74900', high: '74900', currency: 'USD' },
          },
          verdict: {
            fit: 'eligible',
            climate: 'suitable',
            relation: 'not_comparable',
            evidenceMissing: true,
            delta: null,
          },
        },
      },
    ],
  };
  const view = presentReport(d, templateProfile, { ...templateContext(), comparisonRevision: '1' });
  expect(view.comparison[0]!.kind).toBe('quote');
  const out = await renderReportEmail(view);
  const quote = out.text.slice(out.text.indexOf('Private quote 1'));
  expect(quote).toContain('Recorded quote base: $749.00 USD');
  expect(quote).toContain('not a tires-only breakdown');
  expect(quote).not.toContain('Tires-only estimate: $749.00');
});
it.each(
  ['eligible', 'blocked', 'unverified'].flatMap((fit) =>
    ['suitable', 'unsuitable', 'unknown'].map((climate) => ({ fit, climate })),
  ),
)(
  'retains recorded fitment $fit and climate $climate independently of missing price evidence',
  async ({ fit, climate }) => {
    const d = templateDocument();
    d.comparison = {
      revision: '1',
      items: [
        {
          slot: 1,
          kind: 'quote',
          snapshot: {
            productKnown: true,
            fit,
            climate,
            scoreBp: null,
            price: null,
            verdict: { fit, climate, relation: 'not_comparable', evidenceMissing: true },
          },
        },
      ],
    };
    const v = presentReport(d, templateProfile, { ...templateContext(), comparisonRevision: '1' });
    expect(v.comparison[0]!.fitment).toBe(fit);
    expect(v.comparison[0]!.climate).toBe(climate);
    if (fit === 'blocked') expect(v.comparison[0]!.status).toContain('Blocked');
    const out = await renderReportEmail(v);
    expect(out.text).toContain('Fitment: ' + fit);
    expect(out.text).toContain('Climate: ' + climate);
    expect(out.text).toContain('Required comparison evidence is missing');
  },
);

it('preserves signed service deltas, leaves missing outcomes unavailable and refuses malformed comparison evidence', () => {
  const d = templateDocument();
  const snapshot: Record<string, unknown> = {
    price: null,
    verdict: { delta: { lowMinor: '-10000', highMinor: '5000', currency: 'USD' } },
  };
  d.comparison = {
    revision: '1',
    items: [{ slot: 1, kind: 'quote', snapshot: snapshot as never }],
  };
  const context = { ...templateContext(), comparisonRevision: '1' };
  const view = presentReport(d, templateProfile, context);
  expect(view.comparison[0]).toMatchObject({
    fitment: 'Unavailable',
    climate: 'Unavailable',
    score: 'Unavailable',
    difference: '-$100.00 to $50.00 USD',
  });
  snapshot.scoreBp = 100;
  expect(() => presentReport(d, templateProfile, context)).toThrow();
  delete snapshot.scoreBp;
  snapshot.fit = 'approved';
  expect(() => presentReport(d, templateProfile, context)).toThrow();
  delete snapshot.fit;
  snapshot.verdict = { delta: { lowMinor: '100', highMinor: '-100', currency: 'USD' } };
  expect(() => presentReport(d, templateProfile, context)).toThrow();
  snapshot.verdict = { delta: { lowMinor: '0', highMinor: '100', currency: 'EUR' } };
  expect(() => presentReport(d, templateProfile, context)).toThrow();
});
