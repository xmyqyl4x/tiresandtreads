import { forwardP2 } from '../../../src/phase2/proxy.ts';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => forwardP2(request);
export const POST = (request: Request) => forwardP2(request);
