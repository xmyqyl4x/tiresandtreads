import { renderToString } from 'react-dom/server';
import { PageView, pageTitle } from './ui/pages.tsx';
import { locale } from './locale.ts';
import manifest from '../node_modules/.cache/tt-preview/assets.json';
import { EditorialWorkbench } from './editorial/workbench.tsx';
import { PartnerPortal } from './phase2/partner/portal.tsx';
import { StaffConsole } from './staff/console.tsx';
import { CommercialView, AffiliateDisclosure } from './commercial/view.tsx';
import { EducationLayout } from './education/view.tsx';
import type { PublicCommerceView } from '../../../packages/contracts/src/public-commerce.ts';
import { EducationView } from './education/view.tsx';
import {
  jsonForHtml,
  type EducationPage,
  type EducationTool,
  type ChecklistTool,
} from '../../../packages/contracts/src/education.ts';

function SiteHead({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: import('react').ReactNode;
}) {
  return (
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <meta name="referrer" content="no-referrer" />
      <meta name="description" content={description} />
      <title>{title + ' | Tires & Tread'}</title>
      <link rel="stylesheet" href={'/local-preview-assets/' + manifest.css} />
      {children}
    </head>
  );
}
export function editorialDocument() {
  return (
    '<!doctype html>' +
    renderToString(
      <html lang="en-US">
        <SiteHead title="Editorial workspace" description="Local editorial authoring and review.">
          <script type="module" src={'/local-preview-assets/' + manifest.editorial} />
        </SiteHead>
        <body>
          <div id="editorial-root">
            <EditorialWorkbench />
          </div>
        </body>
      </html>,
    )
  );
}
export function educationDocument(
  page: EducationPage,
  options: {
    tool?: EducationTool;
    checklist?: ChecklistTool;
    verification?: string;
    commerce?: PublicCommerceView;
  } = {},
) {
  const p = page.content,
    origin = new URL(page.metadata.canonical).origin;
  const primary =
    p.kind === 'glossary'
      ? {
          '@context': 'https://schema.org',
          '@type': 'DefinedTerm',
          name: p.title,
          description: p.summary,
          url: origin + p.path,
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: p.title,
          description: p.summary,
          url: origin + p.path,
          author: { '@type': 'Person', name: p.author },
          reviewedBy: { '@type': 'Person', name: p.reviewer },
          dateModified: p.modifiedAt,
          lastReviewed: p.reviewedAt,
        };
  const structured = [
    primary,
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Tires & Tread',
      url: origin,
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Tires & Tread', url: origin },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Tires & Tread', item: origin + '/' },
        { '@type': 'ListItem', position: 2, name: p.title, item: origin + p.path },
      ],
    },
  ];
  return (
    '<!doctype html>' +
    renderToString(
      <html lang={p.locale}>
        <SiteHead title={p.title} description={p.summary}>
          <link rel="canonical" href={page.metadata.canonical} />
          {p.questions ? (
            <script type="module" src={'/local-preview-assets/' + manifest.checklist} />
          ) : null}
          {options.commerce &&
          (options.commerce.slots.length || options.commerce.affiliates.length) ? (
            <script type="module" src={'/local-preview-assets/' + manifest.commercial} />
          ) : null}
          {page.hreflang.map((h) => (
            <link key={h.locale} rel="alternate" hrefLang={h.locale} href={h.url} />
          ))}
          {options.verification ? (
            <meta name="google-site-verification" content={options.verification} />
          ) : null}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonForHtml(structured) }}
          />
        </SiteHead>
        <body>
          <EducationView
            page={page}
            {...(options.commerce ? { commerce: <CommercialView value={options.commerce} /> } : {})}
            {...(options.tool ? { tool: options.tool } : {})}
            {...(options.checklist ? { checklist: options.checklist } : {})}
          />
        </body>
      </html>,
    )
  );
}
export function htmlDocument(page: string) {
  const title = pageTitle(page);
  if (title === null) return null;
  return (
    '<!doctype html>' +
    renderToString(
      <html lang={locale}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="noindex,nofollow" />
          <meta name="referrer" content="no-referrer" />
          <meta name="description" content="Local preview of the Tires & Tread design system." />
          <title>{title + ' | Tires & Tread'}</title>
          <link rel="stylesheet" href={'/local-preview-assets/' + manifest.css} />
          <script type="module" src={'/local-preview-assets/' + manifest.entry} />
        </head>
        <body>
          <div id="preview-root" data-page={page}>
            <PageView page={page} />
          </div>
        </body>
      </html>,
    )
  );
}
export function getAsset(name: string) {
  return Object.hasOwn(manifest.files, name)
    ? (manifest.files as Readonly<Record<string, { body: string; type: string }>>)[name]!
    : null;
}
export function staffDocument() {
  return (
    '<!doctype html>' +
    renderToString(
      <html lang={locale}>
        <SiteHead title="Local staff workspace" description="Private local staff operations">
          <script type="module" src={'/local-preview-assets/' + manifest.staff} />
        </SiteHead>
        <body>
          <div id="staff-root">
            <StaffConsole />
          </div>
        </body>
      </html>,
    )
  );
}

export function affiliateDisclosureDocument() {
  return (
    '<!doctype html>' +
    renderToString(
      <html lang="en-US">
        <SiteHead
          title="How retailer links work"
          description="Optional retailer links, commissions and independent tire evidence."
        />
        <body>
          <EducationLayout>
            <AffiliateDisclosure />
          </EducationLayout>
        </body>
      </html>,
    )
  );
}

export function partnerDocument() {
  return (
    '<!doctype html>' +
    renderToString(
      <html lang={locale}>
        <SiteHead
          title="Reseller workspace"
          description="Private reseller onboarding, offers and noncharging pilot activity"
        >
          <link rel="stylesheet" href={'/local-preview-assets/' + manifest.partnerCss} />
          <script type="module" src={'/local-preview-assets/' + manifest.partner} />
        </SiteHead>
        <body>
          <div id="p2-partner-root">
            <PartnerPortal />
          </div>
        </body>
      </html>,
    )
  );
}
