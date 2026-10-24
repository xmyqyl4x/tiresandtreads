import { readRuntimeConfig } from '@tt/config/runtime';
import { healthSchema } from '@tt/contracts/health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  readRuntimeConfig(process.env);
  // Bootstrap readiness only. Database/provider readiness is introduced with those adapters.
  return Response.json(healthSchema.parse({ status: 'ok', scope: 'bootstrap' }), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
