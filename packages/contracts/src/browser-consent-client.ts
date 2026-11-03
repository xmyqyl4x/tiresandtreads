import { createApiClient } from './transport.ts';
import { browserConsentView, consentPolicyView } from './consent-views.ts';
import { browserChoicesInput, type BrowserChoicesInput } from './browser-consent-input.ts';
export type { BrowserConsentView } from './consent-views.ts';
export function createBrowserConsentClient(base: string, send: typeof fetch = fetch) {
  const api = createApiClient(base, send);
  return {
    policy: () =>
      api
        .request<unknown>('/api/v1/consent/policy')
        .then((r) => ({ ...r, data: consentPolicyView.parse(r.data) })),
    browser: () =>
      api
        .request<unknown>('/api/v1/consent/browser?cmpAvailable=true', {
          credentials: 'same-origin',
        })
        .then((r) => ({ ...r, data: browserConsentView.parse(r.data) })),
    choices: (
      input: BrowserChoicesInput,
      command: { readonly csrf: string; readonly key: string },
    ) =>
      api.request('/api/v1/consent/browser', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': command.csrf,
          'idempotency-key': command.key,
        },
        body: JSON.stringify(browserChoicesInput.parse(input)),
      }),
  };
}
