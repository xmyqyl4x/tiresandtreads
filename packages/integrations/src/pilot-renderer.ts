import type { PilotRenderer } from '../../application/src/ports/pilot-delivery.ts';
import type { ReportRenderer } from '../../application/src/ports/delivery-services.ts';
import { partnerPreview } from './partner-preview.ts';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function createPilotRenderer(o: {
  readonly report: ReportRenderer;
  readonly fixture: boolean;
  readonly preferences: (send: string) => string;
  readonly senderName: string;
  readonly postalAddress: readonly string[];
}): PilotRenderer {
  if (o.fixture !== o.report.fixture || !o.senderName.trim() || !o.postalAddress.length)
    throw Error('Pilot sender identity required');
  const address = [...o.postalAddress],
    sender = o.senderName;
  return Object.freeze({
    fixture: o.fixture,
    async render(
      c: Parameters<PilotRenderer['render']>[0],
      offers: Parameters<PilotRenderer['render']>[1],
    ) {
      const base = c.reportAllowed && c.document ? await o.report.render(c.document) : null;
      const sections = [];
      for (const b of offers) {
        const preview = await partnerPreview.render({ offer: b.offer.offer, eligible: true });
        sections.push(
          [
            'Sponsored tire offer',
            preview.text,
            'Why this matches: ' + b.reasons.join(', '),
            'Code: ' + b.code,
          ].join('\n'),
        );
      }
      if (!sections.length) {
        if (!base) throw Error('No permitted message content');
        return { ...base, stream: 'report' as const, headers: {}, unsubscribeUrl: null };
      }
      const preferences = o.preferences(c.sendId),
        url = new URL(preferences);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        /[\r\n<>]/.test(preferences) ||
        url.href !== preferences
      )
        throw Error('HTTPS one-click preference endpoint required');
      const footer = [
          sender,
          ...address,
          'Manage offers: ' + preferences,
          'Unsubscribe from offers: ' + preferences,
        ].join('\n'),
        text =
          (base?.text ?? 'Your tire offers') + '\n\n' + sections.join('\n\n') + '\n\n' + footer,
        block =
          '<section aria-label="Sponsored tire offers">' +
          sections.map((s) => '<p>' + escape(s).replaceAll('\n', '<br>') + '</p>').join('') +
          '</section><footer><p>' +
          escape(sender) +
          '<br>' +
          address.map(escape).join('<br>') +
          '</p><a href="' +
          escape(preferences) +
          '">Unsubscribe from offers</a></footer>';
      const html = base
        ? base.html.replace(/<\/body>/i, block + '</body>')
        : '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Your tire offers</title></head><body>' +
          block +
          '</body></html>';
      if (base && html === base.html) throw Error('Report email insertion point unavailable');
      return {
        subject: base?.subject ?? 'Your tire offers',
        html,
        text,
        pdf: base?.pdf ?? null,
        commercial: true,
        stream: 'commercial' as const,
        headers: {
          'List-Unsubscribe': '<' + preferences + '>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        unsubscribeUrl: preferences,
        fixture: o.fixture,
      };
    },
  });
}
