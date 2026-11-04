import { comparisonCopy } from '../../../contracts/src/report-display.ts';
import { messages } from './messages.ts';
import { createElement as h, type ReactNode } from 'react';
import { render, toPlainText } from '@react-email/render';
import type { ReportPresentation, PresentedOption } from './types.ts';
const style = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '16px',
  lineHeight: '1.55',
  color: '#1c2023',
};
const css =
  '@media(prefers-color-scheme:dark){.email-body,.email-card{background:#1c2023!important;color:#f3f4f4!important}.email-link{color:#9ec5ff!important}}@media(max-width:620px){.email-shell{width:100%!important}.email-content{padding:20px!important}}';
const paragraph = (value: ReactNode) => h('p', { style: { margin: '0 0 16px' } }, value);
const link = (url: string, label: string) =>
  h(
    'a',
    {
      className: 'email-link',
      href: url,
      style: {
        color: '#1d4e9e',
        textDecoration: 'underline',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      },
    },
    label,
  );
function glossary(value: string, v: ReportPresentation): ReactNode {
  const l = v.learning.find(
    (x) =>
      x.url.includes('/glossary/') &&
      value.toLocaleLowerCase('en-US').includes(x.title.toLocaleLowerCase('en-US')),
  );
  if (!l) return value;
  const start = value.toLocaleLowerCase('en-US').indexOf(l.title.toLocaleLowerCase('en-US'));
  return [
    value.slice(0, start),
    h(
      'a',
      { href: l.url, key: 'term', className: 'email-link', style: { color: '#1d4e9e' } },
      value.slice(start, start + l.title.length),
    ),
    value.slice(start + l.title.length),
  ];
}
function Option({ option, v }: { option: PresentedOption; v: ReportPresentation }) {
  return h(
    'section',
    { style: { borderTop: '1px solid #d8dee3', paddingTop: '20px', marginTop: '20px' } },
    h(
      'h3',
      {
        style: {
          fontSize: '20px',
          lineHeight: '1.3',
          margin: '0 0 12px',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        },
      },
      option.label,
    ),
    paragraph(option.status),
    paragraph(option.size),
    option.product ? paragraph(option.product) : null,
    option.fitment ? paragraph('Fitment: ' + option.fitment) : null,
    option.climate ? paragraph('Climate: ' + option.climate) : null,
    paragraph(
      'Preference score: ' + option.score + '; ' + option.evidenceLabel + ': ' + option.evidence,
    ),
    paragraph('Installed estimate (' + option.quantity + '): ' + option.installed),
    paragraph(
      (option.kind === 'quote' ? comparisonCopy.quoteBase : comparisonCopy.catalogBase) +
        ': ' +
        option.merchandise,
    ),
    option.kind === 'quote' ? paragraph(comparisonCopy.quoteInclusion) : null,
    option.difference
      ? paragraph('Quote minus observed installed range: ' + option.difference)
      : null,
    h(
      'ul',
      { style: { paddingLeft: '22px' } },
      ...option.reasons.map((r, i) => h('li', { key: i }, glossary(r, v))),
    ),
  );
}
export async function renderReportEmail(v: ReportPresentation) {
  const html = await render(
    h(
      'html',
      { lang: 'en' },
      h(
        'head',
        null,
        h('meta', { charSet: 'utf-8' }),
        h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        h('meta', { name: 'color-scheme', content: 'light dark' }),
        h('meta', { name: 'supported-color-schemes', content: 'light dark' }),
        h('title', null, v.subject),
        h('style', null, css),
      ),
      h(
        'body',
        { className: 'email-body', style: { ...style, margin: 0, backgroundColor: '#f3f4f4' } },
        h(
          'table',
          { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0, border: 0 },
          h(
            'tbody',
            null,
            h(
              'tr',
              null,
              h(
                'td',
                { align: 'center' },
                h(
                  'table',
                  {
                    role: 'presentation',
                    width: 600,
                    cellPadding: 0,
                    cellSpacing: 0,
                    border: 0,
                    className: 'email-shell email-card',
                    style: { width: '600px', maxWidth: '100%', backgroundColor: '#ffffff' },
                  },
                  h(
                    'tbody',
                    null,
                    h(
                      'tr',
                      null,
                      h(
                        'td',
                        { className: 'email-content', style: { padding: '32px' } },
                        paragraph(h('strong', null, v.senderName)),
                        v.fixture ? paragraph(messages.preview) : null,
                        h(
                          'h1',
                          { style: { fontSize: '28px', lineHeight: '1.2', margin: '0 0 16px' } },
                          v.title,
                        ),
                        paragraph(
                          'Saved report version ' +
                            v.reference.version +
                            ' - assessed ' +
                            new Date(v.asOf).toUTCString(),
                        ),
                        paragraph(v.disclosure),
                        paragraph(v.inputSummary),
                        paragraph(link(v.links.view, 'Open private report and PDF options')),
                        paragraph(
                          'Private-link expiry: ' +
                            new Date(v.links.expiresAt).toUTCString() +
                            '. Expiry, revocation and current access checks still apply.',
                        ),
                        h('h2', { style: { fontSize: '23px' } }, messages.options),
                        v.options.length
                          ? v.options.map((o) => h(Option, { key: o.id, option: o, v }))
                          : paragraph(messages.empty),
                        v.comparison.length
                          ? h(
                              'section',
                              null,
                              h(
                                'h2',
                                { style: { fontSize: '23px' } },
                                'Comparison revision ' + v.reference.comparisonRevision,
                              ),
                              ...v.comparison.map((o) => h(Option, { key: o.id, option: o, v })),
                              paragraph(comparisonCopy.noScenario),
                            )
                          : null,
                        v.decisions.length
                          ? h(
                              'section',
                              null,
                              h('h2', null, messages.decisions),
                              ...v.decisions.map((d, i) => h('p', { key: i }, d)),
                              paragraph(messages.compact),
                            )
                          : null,
                        h('h2', null, messages.maintenanceHeading),
                        paragraph(messages.maintenance),
                        h('h2', null, messages.learn),
                        v.learning.length
                          ? h(
                              'ul',
                              { style: { paddingLeft: '22px' } },
                              ...v.learning.map((l) =>
                                h('li', { key: l.url }, link(l.url, l.title)),
                              ),
                            )
                          : paragraph(messages.noLearning),
                        h('h2', null, messages.provenance),
                        ...v.provenance.map((p) => h('p', { key: p }, p)),
                        v.links.confirmation
                          ? h(
                              'section',
                              null,
                              h('h2', null, 'Your separate offers request'),
                              paragraph(
                                'This does not subscribe you to offers. Only confirm if you made this separate request. It does not grant analytics or identity sharing.',
                              ),
                              paragraph(link(v.links.confirmation, 'Confirm offers request')),
                            )
                          : null,
                        h('hr', {
                          style: { border: 0, borderTop: '1px solid #d8dee3', margin: '24px 0' },
                        }),
                        paragraph(
                          'This is the one report copy requested. It does not confirm offers or grant analytics, advertising or identity sharing.',
                        ),
                        paragraph(link(v.links.preferences, 'Manage this report email purpose')),
                        paragraph(link(v.links.privacy, messages.privacy)),
                        paragraph(
                          'Opening these links only reads state; purpose changes require an explicit action. Contact the sender for help if your private link has expired.',
                        ),
                        h(
                          'address',
                          { style: { fontStyle: 'normal', fontSize: '14px' } },
                          v.senderName,
                          ...v.postalAddress.map((p, i) => h('div', { key: i }, p)),
                        ),
                        paragraph(
                          'Report reference: ' +
                            v.reference.reportId +
                            '; version ' +
                            v.reference.version,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  const text = toPlainText(html, {
    wordwrap: 100,
    selectors: [
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
    ],
  });
  if (Buffer.byteLength(html) >= 100000 || Buffer.byteLength(text) > 65536)
    throw Error('Report template size unavailable');
  return Object.freeze({ subject: v.subject, html, text });
}
