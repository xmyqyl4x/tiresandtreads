import { expect, it } from 'vitest';
import { observe, publicPlan, transportControl } from '../fixtures/tls-admission/observer.ts';
import { evidenceFlags } from '../fixtures/tls-admission/contract.ts';

it('observes four verified owner TLS/read-only endpoints and preserves the declared foundation twice', async () => {
  const first = await observe(publicPlan()),
    second = await observe(publicPlan());
  for (const r of [first, second]) {
    expect(r).toMatchObject({
      status: 'observed',
      connections: 4,
      ended: 4,
      cleanupUnknown: false,
      workUnknown: false,
      ...evidenceFlags,
    });
    expect(r.observations).toHaveLength(4);
    expect(r.elapsedMs).toBeLessThan(4000);
  }
  expect(second.observations).toEqual(first.observations);
  console.log(
    'TLS_ADMISSION_EVIDENCE ' +
      JSON.stringify({
        mode: 'standard',
        attempts: 2,
        verifiedEndpoints: 4,
        ownerSessionsOpened: 8,
        ownerSessionsEnded: 8,
        baselineParity: true,
        scope: 'foundation-only; both domains runtime-quarantined',
        attemptMs: [first.elapsedMs, second.elapsedMs],
        ...evidenceFlags,
      }),
  );
});
it.each(['wrong-ca', 'source-hostname', 'target-hostname', 'wrong-password'] as const)(
  'refuses the fixed %s transport control without SQL or fallback',
  async (control) => {
    const r = await transportControl(publicPlan(), control);
    expect(r).toMatchObject({
      connections: 1,
      connected: false,
      ended: true,
      sqlQueries: 0,
      ...evidenceFlags,
    });
    const codes =
      control === 'wrong-ca'
        ? [
            'SELF_SIGNED_CERT_IN_CHAIN',
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
          ]
        : control === 'wrong-password'
          ? ['28P01']
          : ['ERR_TLS_CERT_ALTNAME_INVALID'];
    expect(codes).toContain(r.code);
    console.log('TLS_TRANSPORT_EVIDENCE ' + JSON.stringify(r));
  },
);
it('rejects a retained/raw-URI envelope before any connection or resource admission', async () => {
  const r = await observe(JSON.stringify({ url: 'postgresql://retained.invalid/private' }));
  expect(r).toMatchObject({
    status: 'refused',
    connections: 0,
    ended: 0,
    observations: [],
    ...evidenceFlags,
  });
});
