export const deniedSignals = {
  ad_storage: 'denied',
  analytics_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const;
export interface CommercialConsent {
  readonly ads: boolean;
  readonly analytics: boolean;
  readonly targeted: boolean;
  readonly cmpVerified: boolean;
  readonly gpc: boolean;
  readonly under13: boolean;
  readonly internal: boolean;
  readonly bot: boolean;
}
export interface PlacementAdapter {
  mount(signal: AbortSignal): Promise<'filled' | 'empty'>;
  dispose(): void;
}
// Adapters are supplied by the trusted composition, never by URL, storage or a page message.
// The shipped local entry supplies null; a real CMP/provider binding remains an activation gate.
export function commercialController(ports: {
  readonly signals: (
    value: Readonly<Record<keyof typeof deniedSignals, 'granted' | 'denied'>>,
  ) => void;
  readonly house: () => void;
  readonly hide: () => void;
  readonly adapter: PlacementAdapter | null;
  readonly activationApproved: boolean;
  readonly networkReady: boolean;
  readonly knownUnder13?: boolean;
  readonly readConsent: () => Promise<CommercialConsent>;
}) {
  let epoch = 0,
    pending: AbortController | null = null,
    closed = false;
  let allowed = false;
  function revoke() {
    epoch++;
    allowed = false;
    pending?.abort();
    pending = null;
    ports.signals(deniedSignals);
    ports.adapter?.dispose();
    ports.house();
  }
  revoke();
  return {
    async refresh(visible: boolean, densityAllowed: boolean) {
      if (closed) return;
      revoke();
      const generation = epoch;
      if (ports.knownUnder13) {
        ports.hide();
        return;
      }
      if (
        !visible ||
        !densityAllowed ||
        !ports.activationApproved ||
        !ports.networkReady ||
        !ports.adapter
      )
        return;
      const request = new AbortController();
      pending = request;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stopped = new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => reject(Error('Placement cancelled')), {
          once: true,
        });
        timer = setTimeout(() => request.abort(), 5000);
      });
      try {
        const c = await Promise.race([ports.readConsent(), stopped]);
        if (closed || generation !== epoch) return;
        if (
          !c ||
          (
            [
              'ads',
              'analytics',
              'targeted',
              'cmpVerified',
              'gpc',
              'under13',
              'internal',
              'bot',
            ] as const
          ).some((key) => typeof c[key] !== 'boolean')
        )
          return;
        if (c.under13) {
          ports.hide();
          return;
        }
        if (!c.ads || !c.cmpVerified || c.gpc || c.internal || c.bot) return;
        allowed = true;
        ports.signals({
          ad_storage: 'granted',
          analytics_storage: c.analytics ? 'granted' : 'denied',
          ad_user_data: c.targeted ? 'granted' : 'denied',
          ad_personalization: c.targeted ? 'granted' : 'denied',
        });
        const result = await Promise.race([ports.adapter.mount(request.signal), stopped]);
        if (closed || generation !== epoch || request.signal.aborted) return;
        if (result !== 'filled') revoke();
      } catch {
        if (generation === epoch && !closed) revoke();
      } finally {
        clearTimeout(timer);
        if (pending === request) pending = null;
      }
    },
    invalidate: revoke,
    get externalAllowed() {
      return allowed;
    },
    close() {
      if (!closed) {
        closed = true;
        revoke();
      }
    },
  };
}
