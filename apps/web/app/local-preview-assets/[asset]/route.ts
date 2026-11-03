import { previewAsset } from '../../../src/preview-response.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ asset: string }> }) {
  return previewAsset(request, (await params).asset);
}
