import { z } from 'zod';
// Configure before constructing any browser schemas: even a caught eval probe violates CSP.
if (typeof window !== 'undefined') z.config({ jitless: true });
export { z } from 'zod';
export const p2Uuid = z
  .string()
  .regex(
    /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
export const p2Revision = z.string().regex(/^[1-9][0-9]{0,17}$/);
