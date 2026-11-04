import { forwardStaff } from '../../../src/staff/response.ts';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => forwardStaff(request);
export const POST = (request: Request) => forwardStaff(request);
