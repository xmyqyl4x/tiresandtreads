import { Link } from './link.tsx';
import type { ReactNode } from 'react';
import { Navigation } from './navigation.tsx';
import { PrivacyChoices } from './privacy-choices.tsx';
export function Shell({ children, path = '/' }: { children: ReactNode; path?: string }) {
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to main content
      </a>
      <Navigation path={path} />
      <div className="preview-notice">
        Local design preview <span aria-hidden="true">·</span> Tire assessments are not live yet.
      </div>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Link href="/" className="footer-brand">
              TIRES &amp; TREAD
            </Link>
            <p>
              Understand your options.
              <br />
              Make your next choice with confidence.
            </p>
          </div>
          <nav aria-label="Footer">
            <Link href="/guides/how-we-choose">How we choose</Link>
            <Link href="/preview/privacy">Privacy</Link>
            <Link href="/design-system">Design system</Link>
            <PrivacyChoices />
          </nav>
          <p className="footer-note">
            No live recommendations, retailer endorsements or tire safety clearance are provided in
            this preview.
          </p>
        </div>
      </footer>
    </>
  );
}
