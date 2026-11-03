import { previewPage } from '../../src/preview-response.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return previewPage(request, 'design-system');
}
