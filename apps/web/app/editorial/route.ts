import { editorialResponse } from '../../src/editorial/response.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => editorialResponse(request);
