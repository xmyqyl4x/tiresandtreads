import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
import { staffDocument } from '../../node_modules/.cache/tt-preview/renderer.mjs';
const headers = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
export function staffResponse(request: Request, env: PreviewEnvironment = process.env) {
  const c = localPreview(env),
    allowed =
      c &&
      env.LOCAL_STAFF_CONSOLE === 'enabled' &&
      request.headers.get('host') === new URL(c.web).host;
  return new Response(allowed ? staffDocument() : 'Not found', {
    status: allowed ? 200 : 404,
    headers: {
      ...headers,
      'content-type': allowed ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    },
  });
}
