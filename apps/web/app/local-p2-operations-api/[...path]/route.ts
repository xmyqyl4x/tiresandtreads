import { forwardP2 } from '../../../src/phase2/proxy.ts';
export const dynamic = 'force-dynamic';
export const GET = (r: Request) => forwardP2(r, process.env, fetch, 'operations');
export const POST = GET;
