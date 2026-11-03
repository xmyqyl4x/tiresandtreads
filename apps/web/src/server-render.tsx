import { renderToString } from 'react-dom/server';
import { PageView, pageTitle } from './ui/pages.tsx';
import { locale } from './locale.ts';
import manifest from '../node_modules/.cache/tt-preview/assets.json';
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
