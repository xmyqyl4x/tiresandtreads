import { it, expect } from 'vitest';
import { localPreview } from '../../apps/web/src/local-preview.ts';
const valid = {
  LOCAL_WEB_PREVIEW: 'enabled',
  APP_ENV: 'dev-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_ORIGIN: 'http://127.0.0.1:8380',
  LOCAL_API_ORIGIN: 'http://127.0.0.1:43127',
};
it.each([
  { LOCAL_WEB_PREVIEW: 'disabled' },
  { APP_ENV: 'production' },
  { PROVIDER_MODE: 'live' },
  { LOCAL_WEB_ORIGIN: 'https://example.invalid' },
  { LOCAL_WEB_ORIGIN: 'http://127.0.0.1:8380/private' },
  { LOCAL_API_ORIGIN: 'http://example.invalid:43127' },
  { LOCAL_API_ORIGIN: 'https://127.0.0.1:43127' },
  { LOCAL_API_ORIGIN: 'http://user:secret@127.0.0.1:43127' },
  { LOCAL_API_ORIGIN: 'http://127.0.0.1:43127/#fragment' },
  { LOCAL_API_ORIGIN: 'http://127.0.0.1:80' },
  { LOCAL_API_ORIGIN: 'garbage' },
])('keeps preview disabled for an unsafe or nonlocal activation input %j', (patch) => {
  expect(localPreview({ ...valid, ...patch })).toBeNull();
});
it('accepts only the exact explicit local fixture origins', () => {
  expect(localPreview(valid)).toEqual({ web: valid.LOCAL_WEB_ORIGIN, api: valid.LOCAL_API_ORIGIN });
  expect(localPreview({})).toBeNull();
});
