import { expect, it } from 'vitest';
import { runScenario, standard, special, type Scenario } from '../fixtures/io-inspection/proof.ts';

const profile = process.env.IO_PROFILE;
const selected: readonly Scenario[] =
  profile === 'standard' ? standard : special.filter((s) => s === profile);
if (!selected.length) throw Error('Fixed I/O profile required');
for (const scenario of selected) {
  it('observes the fixed native I/O disposition for ' + scenario, async () => {
    const r = await runScenario(scenario);
    const positive = scenario.startsWith('positive');
    expect(r.status).toBe(positive ? 'observed' : 'refused');
    expect(r.readAccepted).toBe(positive);
    expect(r.admissionSucceeded).toBe(positive);
    if (!positive && scenario !== 'end-hang') expect(r.errorCode).not.toBe('none');
    expect(r.casesClosed).toBe(0);
    expect(r.gatesClosed).toBe(0);
    expect(r.cleanupMsBeforeRelayDisposal).toBeLessThan(3000);
    if (scenario.startsWith('late')) {
      expect(r.admissionMs).toBeGreaterThanOrEqual(4000);
      expect(r.resultDiscarded).toBe(true);
    } else expect(r.admissionMs).toBeLessThan(4000);
    const unknown = ['end-hang', 'inspection-loss'].includes(scenario);
    expect(r.cleanupUnknown).toBe(unknown);
    if (unknown)
      await expect(runScenario('positive-source')).rejects.toThrow('I/O previous cleanup unknown');
    if (scenario === 'end-hang')
      expect(r).toMatchObject({
        endObserved: false,
        inspectionObserved: true,
        backendAbsent: true,
        locksAbsent: true,
      });
    else expect(r.endObserved).toBe(true);
    if (scenario === 'inspection-loss')
      expect(r).toMatchObject({
        inspectionObserved: false,
        backendAbsent: false,
        locksAbsent: false,
      });
    else if (r.registered)
      expect(r).toMatchObject({ inspectionObserved: true, backendAbsent: true, locksAbsent: true });
    if (scenario.startsWith('connect-')) {
      expect(r.ownerQueryCalls).toBe(0);
      expect(r.relay.clientBytes).toBeGreaterThanOrEqual(8);
      expect(r.relay.upstreamOpened).toBe(0);
      expect(r.readDispatched).toBe(false);
    }
    if (scenario.startsWith('read-')) {
      expect(r.relay.withheldBytes).toBeGreaterThan(0);
      expect(r.readCompleted).toBe(false);
    }
    if (scenario.startsWith('statement')) expect(r.errorCode).toBe('57014');
    if (
      scenario.startsWith('context-drift') ||
      scenario === 'map-loss' ||
      scenario === 'inspection-loss'
    )
      expect(r).toMatchObject({ readCompleted: true, resultDiscarded: true });
    if (scenario === 'preconnect-map-loss')
      expect(r).toMatchObject({ ownerConnectCalls: 0, ownerQueryCalls: 0, registered: false });
  });
}
