import { educationResponse } from '../../src/education/response.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => educationResponse(request);
