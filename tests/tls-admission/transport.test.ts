import { expect, it } from 'vitest';
import { publicPlan, transportControl } from '../fixtures/tls-admission/observer.ts';
it('refuses the independently prepared fixed invalid server transport without SQL', async () => {
  const mode = process.env.TLS_ADMISSION_PHASE;
  const r = await transportControl(publicPlan(), 'server-transport');
  expect(r).toMatchObject({ connections: 1, connected: false, ended: true, sqlQueries: 0 });
  expect(r.code).toBe(
    mode === 'expired'
      ? 'CERT_HAS_EXPIRED'
      : mode === 'future'
        ? 'CERT_NOT_YET_VALID'
        : 'transport-refused',
  );
  console.log('TLS_TRANSPORT_EVIDENCE ' + JSON.stringify({ mode, ...r }));
});
