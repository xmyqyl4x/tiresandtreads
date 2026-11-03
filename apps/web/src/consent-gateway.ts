import { ownerSession } from './owner-session.ts';
import { commandAttempts } from './command-attempts.ts';
import { createBrowserConsentClient, type BrowserConsentView } from '@tt/contracts/browser-consent';
export interface BrowserChoices {
  readonly analytics: boolean;
  readonly ads: boolean;
  readonly targeted_ads: boolean;
}
export async function loadChoices(origin: string, send: typeof fetch = fetch) {
  const consent = createBrowserConsentClient(origin, send),
    run = commandAttempts();
  const [session, policy] = await Promise.all([ownerSession(origin, send), consent.policy()]);
  if (!/^[a-f0-9]{64}$/.test(session.csrf)) throw Error('Invalid session reply');
  const { necessary, analytics, ads, targeted_ads } = policy.data.notices;
  let state: BrowserConsentView = (await consent.browser()).data;
  return {
    get current() {
      return state;
    },
    save(allowed: BrowserChoices, gpc: boolean) {
      const body = {
        expectedRevision: state.revision,
        allowed: (['analytics', 'ads', 'targeted_ads'] as const).filter(
          (p) => allowed[p] && !(p === 'targeted_ads' && gpc),
        ),
        gpc,
        notices: { necessary, analytics, ads, targeted_ads },
      };
      return run('choices', body, async (input, key) => {
        const accepted = await consent.choices(input, { csrf: session.csrf, key }),
          current = (await consent.browser()).data;
        if (current.revision !== accepted.data.result_revision)
          throw Object.assign(Error('Choices changed concurrently; reload current choices'), {
            code: 'conflict',
            retryable: false,
          });
        state = current;
        return state;
      });
    },
  };
}
