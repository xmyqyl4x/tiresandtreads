import { staffResponse } from '../../src/staff/response.ts';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => staffResponse(request);
