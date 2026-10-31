import { expect, it } from 'vitest';
import { candidate } from '../fixtures/multitarget-coordination/proof.ts';
import { channels } from '../fixtures/multitarget-coordination/contract.ts';
import { profile } from '../fixtures/multitarget-coordination/transport.ts';
it('refuses the fixed adverse profile, discards late work and reports cleanup honestly', async () => {
  const mode = profile(),
    p = await candidate();
  try {
    await p.openCommons();
    if (mode === 'unknown-ack') await expect(p.acquire('c0')).rejects.toThrow();
    else {
      for (const c of channels) expect(await p.acquire(c.id)).toBe(true);
      if (['loss-source', 'loss-target', 'map-loss', 'inspection-loss'].includes(mode))
        await expect(p.read(mode === 'loss-target' ? 0 : 1)).rejects.toThrow();
      else await expect(p.read()).rejects.toThrow();
    }
    await expect(p.read()).rejects.toThrow();
  } finally {
    const r = await p.finish();
    expect(r.opened).toBe(mode === 'unknown-ack' ? 2 : 6);
    expect(r.ended).toBe(r.opened);
    expect(r.workStarted).toBe(mode === 'unknown-ack' ? 0 : 1);
    expect(r.workCompleted).toBe(mode === 'unknown-ack' ? 0 : 1);
    expect(r.lateResults).toBe(mode === 'unknown-ack' ? 0 : 1);
    expect(r.cleanupUnknown).toBe(mode === 'inspection-loss');
    expect(r.unknownGrant).toBe(mode === 'unknown-ack');
    if (mode !== 'inspection-loss')
      expect(r).toMatchObject({ backendAbsent: true, locksAbsent: true });
    expect(r).toMatchObject({
      casesClosed: 0,
      gatesClosed: 0,
      lifecycleMutationDispatches: 0,
      providerDispatches: 0,
      targetFencing: false,
    });
    if (mode === 'deadline') expect(r.elapsedMs).toBeGreaterThanOrEqual(4000);
    console.log('MC_ADVERSE_EVIDENCE ' + JSON.stringify({ profile: mode, ...r }));
    if (mode === 'inspection-loss') await expect(candidate()).rejects.toThrow();
  }
});
