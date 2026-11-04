import { forwardEditorial } from '../../../src/editorial/response.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => forwardEditorial(request);
export const POST = (request: Request) => forwardEditorial(request);
