import type { PartnerOfferPreview } from '../../application/src/ports/partner-services.ts';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
// An inert preview renderer: no provider, recipient, tracking pixel or coupon secret.
export const partnerPreview: PartnerOfferPreview = {
  async render({ offer, eligible }) {
    const money = (m: Readonly<{ minor: bigint; currency: string }>) =>
      `${m.currency} ${(m.minor / 100n).toString()}.${(m.minor % 100n).toString().padStart(2, '0')}`;
    const discount = offer.discount;
    let label: string;
    switch (discount.kind) {
      case 'percent_off':
        label = `Percent off: ${discount.basisPoints / 100}%`;
        break;
      case 'amount_off':
        label = 'Amount off: ' + money(discount.money);
        break;
      case 'set_of_four_off':
        label = 'Set of four discount: ' + money(discount.money);
        break;
      case 'mail_in_rebate':
        label = 'Mail-in rebate: ' + money(discount.money);
        break;
      case 'free_service':
        label = 'Free service: ' + discount.service;
        break;
      case 'buy_three_get_one':
        label = 'Buy three, get one';
        break;
      case 'price_match':
        label = 'Price match';
        break;
    }
    const terms = Object.entries(offer.terms).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : String(v)}`,
      ),
      lines = [
        eligible ? 'Offer preview' : 'Draft preview — unavailable for serving',
        offer.title,
        offer.description,
        label,
        `Minimum tires: ${offer.minimumTires}`,
        offer.minimumPurchase === null
          ? 'No minimum purchase'
          : `Minimum purchase: ${money(offer.minimumPurchase)}`,
        `Redemption: ${offer.redemptionMethod.replaceAll('_', ' ')}`,
        ...(offer.redemptionUrl === null ? [] : [offer.redemptionUrl]),
        ...terms,
        `Valid ${offer.validFrom} to ${offer.validUntil}`,
      ];
    return Object.freeze({
      text: lines.join('\n'),
      html: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Offer preview</title><body>${lines.map((s) => `<p>${escape(s)}</p>`).join('')}</body></html>`,
    });
  },
};
