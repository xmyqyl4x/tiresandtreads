import { describe, expect, it } from 'vitest';
import { readRuntimeConfig } from '../../packages/config/src/runtime';

describe('ENG-05 runtime configuration', () => {
  it.each(['dev-local', 'test-local', 'stage-local'])(
    'accepts explicit %s fixture mode',
    (appEnv) => {
      expect(readRuntimeConfig({ APP_ENV: appEnv, PROVIDER_MODE: 'fixtures' }).appEnv).toBe(appEnv);
    },
  );
  it.each([
    {},
    { APP_ENV: 'production', PROVIDER_MODE: 'fixtures' },
    { APP_ENV: 'stage-local', PROVIDER_MODE: 'live' },
    { NODE_ENV: 'production' },
    { APP_ENV: 'preview', PROVIDER_MODE: 'fixtures' },
  ])('rejects implicit, hosted or live-provider configuration', (env) => {
    expect(() => readRuntimeConfig(env)).toThrow('Invalid bootstrap runtime configuration');
  });
  it('does not include supplied secret values in configuration errors', () => {
    expect(() =>
      readRuntimeConfig({ APP_ENV: 'secret-canary', PROVIDER_MODE: 'secret-canary' }),
    ).toThrow(/^Invalid bootstrap runtime configuration$/);
  });
});
