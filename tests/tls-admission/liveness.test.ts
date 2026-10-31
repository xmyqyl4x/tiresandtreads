import { expect, it } from 'vitest';
import { publicPlan, observe } from '../fixtures/tls-admission/observer.ts';
it('refuses stale incarnation or unavailable live supervision before opening an owner connection', async () => {
  const r = await observe(publicPlan());
  expect(r).toMatchObject({
    status: 'refused',
    connections: 0,
    ended: 0,
    observations: [],
    cleanupUnknown: false,
  });
  expect(r.elapsedMs).toBeLessThan(4000);
  console.log(
    'TLS_LIVENESS_EVIDENCE ' + JSON.stringify({ mode: process.env.TLS_ADMISSION_PHASE, ...r }),
  );
});
