import type { PublicCommerceView } from '../../../../packages/contracts/src/public-commerce.ts';
export function CommercialView({ value }: { value: PublicCommerceView }) {
  if (!value.slots.length && !value.affiliates.length) return null;
  return (
    <section
      className="commercial-resources"
      aria-label="Additional resources"
      data-commercial-inventory
    >
      <h2>Explore before you buy</h2>
      <div className="commercial-grid">
        {value.slots.map((slot) => (
          <aside className="commercial-slot" key={slot.key} data-commercial-slot={slot.key}>
            <span className="commercial-label">{slot.label}</span>
            <a className="commercial-house" href={slot.housePath}>
              <span aria-hidden="true" className="commercial-mark">
                T&amp;T
              </span>
              <span>
                {slot.houseLabel}
                <small>Independent learning · no advertiser tracking</small>
              </span>
              <span aria-hidden="true">↗</span>
            </a>
          </aside>
        ))}
      </div>
      {value.affiliates.map((link) => (
        <div className="affiliate-resource" key={link.key}>
          <p>
            {link.disclosure} <a href="/affiliate-disclosure">How retailer links work</a>
          </p>
          <a
            href={link.href}
            rel="sponsored nofollow noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {link.label} · commission link
          </a>
          <p>Check current availability, fitment and the retailer’s terms before buying.</p>
        </div>
      ))}
    </section>
  );
}
// No context, report identifier, ad loader or third-party destination enters these resources.
export function PrivateLearningLinks() {
  return (
    <section
      className="private-learning"
      data-private-learning
      aria-label="Learning after your results"
    >
      <h2>Keep learning</h2>
      <p>From Tires &amp; Tread</p>
      <div className="private-learning-grid">
        <a href="/guides/how-we-choose">
          How we compare tires<span>Understand the evidence and its limits.</span>
        </a>
        <a href="/guides/before-you-buy">
          Before you buy<span>Review the questions to ask your installer.</span>
        </a>
      </div>
    </section>
  );
}
export function AffiliateDisclosure() {
  return (
    <main id="education-main" className="container commercial-disclosure" tabIndex={-1}>
      <p className="eyebrow">TIRES &amp; TREAD · TRANSPARENCY</p>
      <h1>How retailer links work</h1>
      <p>
        We may earn a commission when you use a link explicitly marked as a commission link. The
        disclosure appears next to the link so you can decide before leaving this site.
      </p>
      <h2>Evidence comes first</h2>
      <p>
        Commercial arrangements do not change tire eligibility, scores, ranking or the advice in a
        saved report. A link does not guarantee fitment, stock, price or an installed total.
      </p>
      <h2>Your choice</h2>
      <p>
        Retailer links are optional. You can use the assessment and learning tools without following
        them. No private report details are added to retailer links.
      </p>
      <h2>When a link is unavailable</h2>
      <p>
        Links require current approved terms and a recent successful check. An unavailable link is
        withheld; it is not replaced with an unreviewed destination.
      </p>
      <p>
        <a href="/learn/tire-basics">Return to tire basics</a> ·{' '}
        <a href="/preview/privacy">Privacy choices</a>
      </p>
    </main>
  );
}
