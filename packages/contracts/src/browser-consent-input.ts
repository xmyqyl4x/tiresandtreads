import './browser-runtime.ts';
import {
  strictObject,
  string,
  regex,
  array,
  enum as enumeration,
  maxLength,
  boolean,
  uuid,
  type input as Input,
} from 'zod/mini';
export const browserChoicesInput = strictObject({
  expectedRevision: string().check(regex(/^[1-9][0-9]{0,18}$/)),
  allowed: array(enumeration(['analytics', 'ads', 'targeted_ads'])).check(maxLength(3)),
  gpc: boolean(),
  notices: strictObject({
    necessary: uuid(),
    analytics: uuid(),
    ads: uuid(),
    targeted_ads: uuid(),
  }),
});
export type BrowserChoicesInput = Input<typeof browserChoicesInput>;
