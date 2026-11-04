import { comparisonCopy } from '../../../contracts/src/report-display.ts';
import { messages } from './messages.ts';
import { createElement as h, type ReactNode } from 'react';
import { Document, Page, Text, View, Link, Font, renderToBuffer } from '@react-pdf/renderer';
import { createHash } from 'node:crypto';
import type { ReportPresentation, TemplateFonts, PresentedOption } from './types.ts';
let tail = Promise.resolve(),
  pending = 0;
const registered = new Set<string>();
const ink = '#1c2023',
  blue = '#1d4e9e';
const p = (value: string) =>
  h(
    Text,
    { style: { fontSize: 10, lineHeight: 1.5, marginBottom: 9 }, orphans: 3, widows: 3 },
    value,
  );
const heading = (title: string) =>
  h(
    Text,
    {
      style: { fontWeight: 700, fontSize: 16, marginTop: 14, marginBottom: 8 },
      minPresenceAhead: 200,
    },
    title,
  );
function option(o: PresentedOption): ReactNode {
  return h(
    View,
    {
      key: o.id,
      wrap: false,
      style: {
        borderTopWidth: 1,
        borderTopColor: '#d8dee3',
        paddingTop: 12,
        marginTop: 8,
        marginBottom: 8,
      },
    },
    h(Text, { style: { fontWeight: 700, fontSize: 13, marginBottom: 7 } }, o.label),
    p(o.status),
    p(o.size),
    o.product ? p(o.product) : null,
    o.fitment ? p('Fitment: ' + o.fitment) : null,
    o.climate ? p('Climate: ' + o.climate) : null,
    p('Preference score: ' + o.score + '; ' + o.evidenceLabel + ': ' + o.evidence),
    p('Installed estimate (' + o.quantity + '): ' + o.installed),
    p(
      (o.kind === 'quote' ? comparisonCopy.quoteBase : comparisonCopy.catalogBase) +
        ': ' +
        o.merchandise,
    ),
    o.kind === 'quote' ? p(comparisonCopy.quoteInclusion) : null,
    o.difference ? p('Quote minus observed installed range: ' + o.difference) : null,
    ...o.reasons.map((r, i) =>
      h(Text, { key: i, style: { fontSize: 10, lineHeight: 1.4, marginBottom: 5 } }, '- ' + r),
    ),
  );
}
// Serializes the renderer's shared font store. No remote fonts/images, mutation dispatch or clock.
export async function renderReportPdf(
  v: ReportPresentation,
  fonts: TemplateFonts,
): Promise<Uint8Array> {
  if (pending >= 4) throw Error('Report renderer busy');
  pending++;
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (
      fonts.regular.length < 32 ||
      fonts.bold.length < 32 ||
      fonts.regular.length > 2000000 ||
      fonts.bold.length > 2000000
    )
      throw Error('Report fonts unavailable');
    const family =
      'TT-' +
      createHash('sha256').update(fonts.regular).update(fonts.bold).digest('hex').slice(0, 16);
    if (!registered.has(family)) {
      if (registered.size >= 8) throw Error('Report font capacity unavailable');
      Font.register({
        family,
        fonts: [
          {
            src: 'data:font/ttf;base64,' + Buffer.from(fonts.regular).toString('base64'),
            fontWeight: 400,
          },
          {
            src: 'data:font/ttf;base64,' + Buffer.from(fonts.bold).toString('base64'),
            fontWeight: 700,
          },
        ],
      });
      registered.add(family);
    }
    Font.registerHyphenationCallback((word) => {
      const chars = [...word];
      if (chars.length <= 24) return [word];
      const parts: string[] = [];
      for (let i = 0; i < chars.length; i += 16) parts.push(chars.slice(i, i + 16).join(''));
      return parts;
    });
    const body = [
      h(
        Text,
        {
          key: 'title',
          style: { fontSize: 25, fontWeight: 700, marginBottom: 12 },
        },
        v.title,
      ),
      v.fixture ? p(messages.preview) : null,
      p(
        'Saved report version ' +
          v.reference.version +
          ' - assessed ' +
          new Date(v.asOf).toUTCString(),
      ),
      p(v.disclosure),
      p(v.inputSummary),
      heading(messages.options),
      v.options.length ? v.options.map(option) : p(messages.empty),
      v.comparison.length
        ? [
            heading('Comparison revision ' + v.reference.comparisonRevision),
            ...v.comparison.map(option),
            p(comparisonCopy.noScenario),
          ]
        : null,
      v.decisions.length
        ? [heading(messages.decisions), ...v.decisions.map(p), p(messages.compact)]
        : null,
      heading(messages.maintenanceHeading),
      p(messages.maintenance),
      heading(messages.learn),
      v.learning.length
        ? v.learning.map((l) =>
            h(
              Link,
              {
                key: l.url,
                src: l.url,
                style: { color: blue, fontSize: 10, marginBottom: 10, textDecoration: 'underline' },
              },
              l.title,
            ),
          )
        : p(messages.noLearning),
      h(View, { wrap: false }, heading(messages.provenance), ...v.provenance.map(p)),
      heading('About this saved copy'),
      p('Report reference: ' + v.reference.reportId + '; version ' + v.reference.version),
      p(
        'This PDF contains no email preference proofs or recipient address. Access to current source evidence or private downloads remains subject to expiry and revocation.',
      ),
      h(
        Link,
        {
          key: 'privacy',
          src: v.links.privacy,
          style: { color: blue, fontSize: 10, textDecoration: 'underline' },
        },
        messages.privacy,
      ),
    ];
    const doc = h(
      Document,
      {
        title: v.title,
        author: v.senderName,
        subject: 'Saved historical tire assessment - version ' + v.reference.version,
        creator: 'Tires & Tread template v1',
        producer: 'Tires & Tread template v1',
        language: 'en-US',
        pdfVersion: '1.7',
        creationDate: new Date(v.asOf),
        modificationDate: new Date(v.asOf),
      },
      h(
        Page,
        {
          size: 'LETTER',
          wrap: true,
          style: {
            fontFamily: family,
            color: ink,
            paddingTop: 54,
            paddingBottom: 58,
            paddingHorizontal: 42,
          },
        },
        h(
          Text,
          {
            fixed: true,
            style: { position: 'absolute', top: 20, left: 42, fontSize: 10, fontWeight: 700 },
          },
          v.senderName,
        ),
        ...body.flat(),
        h(Text, {
          fixed: true,
          style: {
            position: 'absolute',
            bottom: 25,
            left: 42,
            right: 42,
            fontSize: 9,
            color: '#52606d',
          },
          render: ({ pageNumber, totalPages }) =>
            'Saved version ' + v.reference.version + ' | Page ' + pageNumber + ' of ' + totalPages,
        }),
      ),
    );
    const bytes = await renderToBuffer(doc);
    if (bytes.length > 4 * 1024 * 1024) throw Error('Report PDF size unavailable');
    return new Uint8Array(bytes);
  } finally {
    pending--;
    release();
  }
}
