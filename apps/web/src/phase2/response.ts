import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
import {
  partnerDocument,
  p2StaffDocument,
} from '../../node_modules/.cache/tt-preview/renderer.mjs';
export function partnerResponse(
  request: Request,
  env: PreviewEnvironment = process.env,
  surface: 'partner' | 'staff' = 'partner',
) {
  const c = localPreview(env),
    allowed =
      c &&
      env[surface === 'partner' ? 'LOCAL_P2_UI' : 'LOCAL_P2_STAFF_UI'] === 'enabled' &&
      request.headers.get('host') === new URL(c.web).host;
  return new Response(
    allowed ? (surface === 'partner' ? partnerDocument() : p2StaffDocument()) : 'Not found',
    {
      status: allowed ? 200 : 404,
      headers: {
        'content-type': allowed ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
      },
    },
  );
}
