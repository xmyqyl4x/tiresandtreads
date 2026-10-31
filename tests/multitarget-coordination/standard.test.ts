import { expect, it, afterAll } from 'vitest';
import { candidate, control } from '../fixtures/multitarget-coordination/proof.ts';
import { channels, type Id } from '../fixtures/multitarget-coordination/contract.ts';
import { publicPlan } from '../fixtures/multitarget-coordination/transport.ts';

async function successful(raw = publicPlan()) {
  const p = await candidate(raw);
  try {
    await p.openCommons();
    for (const c of channels) expect(await p.acquire(c.id)).toBe(true);
    await p.read();
  } finally {
    const r = await p.finish();
    expect(r).toMatchObject({
      status: 'observed',
      opened: 6,
      ended: 6,
      workStarted: 4,
      workCompleted: 4,
      cleanupUnknown: false,
      backendAbsent: true,
      locksAbsent: true,
      baselineParity: true,
      casesClosed: 0,
      gatesClosed: 0,
    });
    expect(r.trace.filter((x) => x.startsWith('close:'))).toEqual([
      'close:i1c',
      'close:i1a',
      'close:i0c',
      'close:i0a',
      'close:c1',
      'close:c0',
    ]);
    expect(r.acquired).toEqual(channels.map((c) => c.id));
    console.log('MC_SUCCESS_EVIDENCE ' + JSON.stringify(r));
  }
}
it.each([false, true])(
  'acquires canonical sessions for either plan enumeration: %s',
  async (reverse) => {
    const raw = JSON.parse(publicPlan());
    if (reverse) raw.domains.reverse();
    await successful(JSON.stringify(raw));
  },
);
it.each(['app', 'cms'] as const)(
  'first common busy refuses either private entry label: %s',
  async (entry) => {
    const blocker = await control('blocker', 'c0'),
      p = await candidate(publicPlan(), entry);
    try {
      await p.openCommons();
      expect(await p.acquire('c0')).toBe(false);
    } finally {
      const r = await p.finish();
      expect(r).toMatchObject({
        opened: 2,
        ended: 2,
        workStarted: 0,
        cleanupUnknown: false,
        backendAbsent: true,
        locksAbsent: true,
      });
      expect(r.attempted).toEqual(['c0']);
      expect((await blocker.finish()).cleanupUnknown).toBe(false);
    }
  },
);
it.each(['c1', 'i0a', 'i0c', 'i1a', 'i1c'] as Id[])(
  'busy %s stops at the acquired prefix without retries',
  async (busy) => {
    const blocker = await control('blocker', busy),
      p = await candidate();
    try {
      await p.openCommons();
      for (const c of channels) {
        const granted = await p.acquire(c.id);
        if (c.id === busy) {
          expect(granted).toBe(false);
          break;
        }
        expect(granted).toBe(true);
      }
    } finally {
      const r = await p.finish();
      expect(r.cleanupUnknown).toBe(false);
      expect(r.workStarted).toBe(0);
      expect(r.attempted).toEqual(
        channels.slice(0, channels.findIndex((c) => c.id === busy) + 1).map((c) => c.id),
      );
      expect((await blocker.finish()).cleanupUnknown).toBe(false);
    }
  },
);
it('equal two-integer keys independently grant in app and CMS databases', async () => {
  const app = await control('negative', 'c0'),
    cms = await control('negative', 'i0c');
  try {
    expect(await app.alive()).toBe(true);
    expect(await cms.alive()).toBe(true);
  } finally {
    expect((await cms.finish()).cleanupUnknown).toBe(false);
    expect((await app.finish()).cleanupUnknown).toBe(false);
  }
});
it('a second full candidate opens only its two commons before refusing the current holder', async () => {
  const holder = await candidate();
  try {
    await holder.openCommons();
    for (const c of channels) expect(await holder.acquire(c.id)).toBe(true);
    await holder.read();
    const contender = await candidate();
    try {
      await contender.openCommons();
      expect(await contender.acquire('c0')).toBe(false);
    } finally {
      expect(await contender.finish()).toMatchObject({
        opened: 2,
        ended: 2,
        attempted: ['c0'],
        workStarted: 0,
        cleanupUnknown: false,
      });
    }
  } finally {
    expect((await holder.finish()).cleanupUnknown).toBe(false);
  }
});
it.each(['early-inner', 'early-read', 'reentrant', 'reverse'] as const)(
  'refuses invalid sequence %s before forbidden work',
  async (mode) => {
    const p = await candidate();
    try {
      await p.openCommons();
      if (mode === 'reentrant') expect(await p.acquire('c0')).toBe(true);
      if (mode === 'early-read')
        await expect(p.read()).rejects.toThrow('Coordination proof refused');
      else
        await expect(
          p.acquire(mode === 'early-inner' ? 'i0a' : mode === 'reverse' ? 'c1' : 'c0'),
        ).rejects.toThrow('Coordination proof refused');
    } finally {
      const r = await p.finish();
      expect(r.workStarted).toBe(0);
      expect(r.cleanupUnknown).toBe(false);
      expect(r.attempted).toEqual(mode === 'reentrant' ? ['c0'] : []);
      await expect(p.openCommons()).rejects.toThrow();
    }
  },
);
it('cleanup leaves an unrelated registered witness alive, then permits a fresh participant', async () => {
  const witness = await control('witness', 'c0');
  try {
    await successful();
    expect(await witness.alive()).toBe(true);
  } finally {
    expect((await witness.finish()).cleanupUnknown).toBe(false);
  }
  await successful();
});
it.each(['wrong-ca', 'wrong-host', 'wrong-password'] as const)(
  'retained-channel factory rejects %s',
  async (fault) => {
    await expect(control('witness', 'c0', fault)).rejects.toThrow('Coordination proof refused');
    await successful();
  },
);
it('refuses caller transport or effect instructions before connecting', async () => {
  const p = JSON.parse(publicPlan());
  p.sql = 'SELECT 1';
  await expect(candidate(JSON.stringify(p))).rejects.toThrow();
});
afterAll(async () => {
  // A final fresh owner read rechecks role/ACL/GUC/catalog/quarantine baselines
  // after every contention, failed transport and cleanup control in this profile.
  await successful();
});
