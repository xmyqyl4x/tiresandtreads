import { partnerResponse } from '../../src/phase2/response.ts';
export const dynamic = 'force-dynamic';
export const GET = (r: Request) => partnerResponse(r, process.env, 'owner');
