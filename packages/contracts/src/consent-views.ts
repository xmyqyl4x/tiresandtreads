import './browser-runtime.ts';
import {
  strictObject,
  literal,
  boolean,
  string,
  regex,
  minLength,
  maxLength,
  uuid,
  type infer as Infer,
} from 'zod/mini';
export const browserConsentView = strictObject({
  necessary: literal(true),
  analytics: boolean(),
  ads: boolean(),
  targeted_ads: boolean(),
  identity_sharing: literal(false),
  revision: string().check(regex(/^[0-9]{1,19}$/)),
});
export const consentPolicyView = strictObject({
  version: string().check(minLength(1), maxLength(100)),
  notices: strictObject({
    necessary: uuid(),
    report: uuid(),
    offers: uuid(),
    analytics: uuid(),
    ads: uuid(),
    targeted_ads: uuid(),
  }),
});
export type BrowserConsentView = Infer<typeof browserConsentView>;
