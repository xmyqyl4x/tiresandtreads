import { createApiClient } from '@tt/contracts/transport';
import { createBrowserConsentClient, type BrowserConsentView } from '@tt/contracts/browser-consent';
export interface BrowserChoices {
  readonly analytics: boolean;
  readonly ads: boolean;
  readonly targeted_ads: boolean;
}
export async function loadChoices(origin: string, send: typeof fetch = fetch) {
  const api = createApiClient(origin, send),
    consent = createBrowserConsentClient(origin, send);
  const session = async () => {
    try {
      return await api.request<{ csrf: string }>('/api/v1/sessions/current', {
        credentials: 'same-origin',
      });
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'unauthorized'
      )
        throw error;
      return api.request<{ csrf: string }>('/api/v1/sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    }
  };
  const [who, policy] = await Promise.all([session(), consent.policy()]);
  if (!/^[a-f0-9]{64}$/.test(who.data.csrf)) throw Error('Invalid session reply');
  const { necessary, analytics, ads, targeted_ads } = policy.data.notices;
  let state: BrowserConsentView = (await consent.browser()).data;
  return {
    get current() {
      return state;
    },
    async save(allowed: BrowserChoices, gpc: boolean) {
      const selected = (['analytics', 'ads', 'targeted_ads'] as const).filter((p) => allowed[p]);
      await consent.choices(
        {
          expectedRevision: state.revision,
          allowed: selected,
          gpc,
          notices: { necessary, analytics, ads, targeted_ads },
        },
        { csrf: who.data.csrf, key: crypto.randomUUID() },
      );
      state = (await consent.browser()).data;
      return state;
    },
  };
}
