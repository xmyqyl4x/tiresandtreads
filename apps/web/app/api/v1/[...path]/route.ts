import { forwardLocalApi } from '../../../../src/bridge.ts';
export const dynamic = 'force-dynamic';
const route = (request: Request) => forwardLocalApi(request, process.env);
export { route as GET, route as POST, route as DELETE };
