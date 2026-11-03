import { localPreview } from './local-preview.ts';
import { htmlDocument, getAsset } from '../node_modules/.cache/tt-preview/renderer.mjs';
const headers = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};
function allowed(request: Request) {
  const config = localPreview(process.env);
  return config !== null && request.headers.get('host') === new URL(config.web).host;
}
export function previewPage(request: Request, page: string) {
  const html = allowed(request) ? htmlDocument(page) : null;
  return new Response(html ?? 'Not found', {
    status: html === null ? 404 : 200,
    headers: {
      ...headers,
      'content-type': html === null ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8',
    },
  });
}
export function previewAsset(request: Request, name: string) {
  const asset = allowed(request) ? getAsset(name) : null;
  return new Response(asset?.body ?? 'Not found', {
    status: asset === null ? 404 : 200,
    headers: { ...headers, 'content-type': asset?.type ?? 'text/plain; charset=utf-8' },
  });
}
