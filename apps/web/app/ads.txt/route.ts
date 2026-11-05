import { commerceResponse } from '../../src/commercial/read.ts';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => commerceResponse(request, 'ads-txt');
export const HEAD = GET;
