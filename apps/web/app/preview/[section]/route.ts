import { previewPage } from '../../../src/preview-response.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ section: string }> }) {
  return previewPage(request, (await params).section);
}
