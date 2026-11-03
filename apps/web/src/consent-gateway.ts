import { ownerSession } from './owner-session.ts';
import { createBrowserConsentClient, type BrowserConsentView } from '@tt/contracts/browser-consent';
export interface BrowserChoices {
  readonly analytics: boolean;
  readonly ads: boolean;
  readonly targeted_ads: boolean;
}
export async function loadChoices(origin: string, send: typeof fetch = fetch) {
  const consent = createBrowserConsentClient(origin, send);
  const [session, policy] = await Promise.all([ownerSession(origin, send), consent.policy()]);
  const who = { data: session };
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
