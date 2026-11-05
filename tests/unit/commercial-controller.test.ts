import { it, expect, vi } from 'vitest';
import {
  commercialController,
  deniedSignals,
  type CommercialConsent,
} from '../../apps/web/src/commercial/controller.ts';
const consent: CommercialConsent = {
  ads: true,
  analytics: false,
  targeted: false,
  cmpVerified: true,
  gpc: false,
  under13: false,
  internal: false,
  bot: false,
};
function setup(extra: Partial<Parameters<typeof commercialController>[0]> = {}) {
  const signals = vi.fn(),
    house = vi.fn(),
    hide = vi.fn(),
    dispose = vi.fn(),
    mount = vi.fn(async (signal: AbortSignal) => {
      void signal;
      return 'filled' as const;
    });
  const readConsent = vi.fn(async () => consent);
  const p = {
    signals,
    house,
    hide,
    adapter: { mount, dispose },
    activationApproved: true,
    networkReady: true,
    readConsent,
    ...extra,
  };
  return { ...p, mount, dispose, controller: commercialController(p) };
}
it('denies all four Google signals before any tag work and grants only consented purposes', async () => {
  const f = setup();
  expect(f.signals).toHaveBeenNthCalledWith(1, deniedSignals);
  expect(f.mount).not.toHaveBeenCalled();
  await f.controller.refresh(true, true);
  expect(f.signals).toHaveBeenLastCalledWith({
    ad_storage: 'granted',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  expect(f.mount).toHaveBeenCalledOnce();
  f.controller.close();
  expect(f.signals).toHaveBeenLastCalledWith(deniedSignals);
});
it.each([{ activationApproved: false }, { networkReady: false }, { adapter: null }])(
  'makes no consent/tag request while readiness is held: %j',
  async (extra) => {
    const f = setup(extra);
    await f.controller.refresh(true, true);
    expect(f.readConsent).not.toHaveBeenCalled();
    expect(f.mount).not.toHaveBeenCalled();
  },
);
it.each(['ads', 'cmpVerified', 'gpc', 'under13', 'internal', 'bot'] as const)(
  'refuses disallowed %s context',
  async (key) => {
    const f = setup({ readConsent: async () => ({ ...consent, [key]: !consent[key] }) });
    await f.controller.refresh(true, true);
    expect(f.mount).not.toHaveBeenCalled();
    if (key === 'under13') expect(f.hide).toHaveBeenCalledOnce();
  },
);
it.each([
  [false, true],
  [true, false],
])('loads lazily only with visibility and density admission', async (visible, density) => {
  const f = setup();
  await f.controller.refresh(visible, density);
  expect(f.readConsent).not.toHaveBeenCalled();
});
it('ignores stale consent after withdrawal and aborts an admitted in-flight creative', async () => {
  let release!: (c: CommercialConsent) => void;
  const f = setup({
    readConsent: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const read = f.controller.refresh(true, true);
  f.controller.invalidate();
  release(consent);
  await read;
  expect(f.mount).not.toHaveBeenCalled();
  let done!: (s: 'filled' | 'empty') => void;
  let signal!: AbortSignal;
  const g = setup({
    adapter: {
      mount: (s) => {
        signal = s;
        return new Promise((r) => {
          done = r;
        });
      },
      dispose: vi.fn(),
    },
  });
  const request = g.controller.refresh(true, true);
  await vi.waitFor(() => expect(signal).toBeDefined());
  g.controller.invalidate();
  expect(signal.aborted).toBe(true);
  done('filled');
  await request;
  expect(g.controller.externalAllowed).toBe(false);
  expect(g.signals).toHaveBeenLastCalledWith(deniedSignals);
});
it.each(['empty', 'blocked'])(
  'retains useful house content on no-fill or blocked SDK: %s',
  async (status) => {
    const f = setup({
      adapter: {
        mount: async () => {
          if (status === 'blocked') throw Error('blocked');
          return 'empty';
        },
        dispose: vi.fn(),
      },
    });
    await f.controller.refresh(true, true);
    expect(f.controller.externalAllowed).toBe(false);
    expect(f.signals).toHaveBeenLastCalledWith(deniedSignals);
  },
);
it('hides all inventory for a trusted known-child context even while activation is held', async () => {
  const f = setup({ knownUnder13: true, activationApproved: false });
  await f.controller.refresh(true, true);
  expect(f.hide).toHaveBeenCalledOnce();
  expect(f.readConsent).not.toHaveBeenCalled();
  expect(f.mount).not.toHaveBeenCalled();
});
it.each([
  null,
  { ...consent, ads: 'yes' },
  { ...consent, gpc: undefined },
  { ...consent, cmpVerified: 1 },
])('refuses malformed CMP context without granting purposes: %j', async (value) => {
  const f = setup({ readConsent: async () => value as unknown as CommercialConsent });
  await f.controller.refresh(true, true);
  expect(f.mount).not.toHaveBeenCalled();
  expect(f.signals).toHaveBeenLastCalledWith(deniedSignals);
});
it.each(['consent', 'creative'])(
  'bounds stalled %s work and returns to denied house content',
  async (phase) => {
    vi.useFakeTimers();
    try {
      const f = setup(
        phase === 'consent'
          ? { readConsent: () => new Promise(() => {}) }
          : { adapter: { mount: () => new Promise(() => {}), dispose: vi.fn() } },
      );
      const run = f.controller.refresh(true, true);
      await vi.advanceTimersByTimeAsync(5000);
      await run;
      expect(f.controller.externalAllowed).toBe(false);
      expect(f.signals).toHaveBeenLastCalledWith(deniedSignals);
      f.controller.close();
    } finally {
      vi.useRealTimers();
    }
  },
);
