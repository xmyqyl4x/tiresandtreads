import { commerceResponse } from '../../../src/commercial/read.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return commerceResponse(request, 'affiliate', (await params).key);
}
export const HEAD = GET;
