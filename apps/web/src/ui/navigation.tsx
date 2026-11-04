import { Link } from './link.tsx';
import { useRef, type KeyboardEvent } from 'react';
const links = [
  ['Find tires', '/preview/find-tires'],
  ['Tire basics', '/learn/tire-basics'],
  ['Size decoder', '/guides/size-decoder'],
  ['Before you buy', '/guides/before-you-buy'],
  ['How we choose', '/guides/how-we-choose'],
] as const;
function NavigationLinks({ path, close }: { path: string; close?: () => void }) {
  return (
    <ul>
      {links.map(([label, slug]) => (
        <li key={slug}>
          <Link href={slug} aria-current={path === slug ? 'page' : undefined} onClick={close}>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function Navigation({ path = '/' }: { path?: string }) {
  const details = useRef<HTMLDetailsElement>(null),
    summary = useRef<HTMLElement>(null);
  function close() {
    if (details.current) details.current.open = false;
  }
  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && details.current?.open) {
      event.preventDefault();
      close();
      summary.current?.focus();
    }
  }
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="Tires & Tread home">
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
            <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="7" />
            <path
              d="M13 11l14 18M10 19l20 2M13 29l14-18"
              fill="none"
              stroke="#1C2023"
              strokeWidth="2"
            />
          </svg>
          <span>
            TIRES <span className="brand-and">&amp;</span> TREAD
          </span>
        </Link>
        <nav className="navigation desktop-navigation" aria-label="Main">
          <NavigationLinks path={path} />
        </nav>
        <details ref={details} className="mobile-navigation" onKeyDown={escape}>
          <summary ref={summary} aria-label="Menu">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </summary>
          <nav className="navigation is-open" aria-label="Main">
            <NavigationLinks path={path} close={close} />
          </nav>
        </details>
      </div>
    </header>
  );
}
