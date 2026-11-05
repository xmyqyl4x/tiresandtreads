import { localPreview } from '../local-preview.ts';
import { affiliateDisclosureDocument } from '../../node_modules/.cache/tt-preview/renderer.mjs';
export function disclosureResponse(request: Request) {
  const c = localPreview(process.env);
  const allowed =
    c &&
    process.env.LOCAL_COMMERCIAL_UI === 'enabled' &&
    request.headers.get('host') === new URL(c.web).host;
  return new Response(allowed ? affiliateDisclosureDocument() : 'Not found', {
    status: allowed ? 200 : 404,
    headers: {
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      'content-type': allowed ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-security-policy':
        "default-src 'self'; script-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    },
  });
}
