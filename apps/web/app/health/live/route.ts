import { healthSchema } from '@tt/contracts/health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(healthSchema.parse({ status: 'ok', scope: 'bootstrap' }), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
