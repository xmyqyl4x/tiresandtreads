import { expect, it } from 'vitest';
import { disposableTargets } from '../fixtures/foundation/target.ts';

const fixture = {
  APP_ENV: 'test-local',
  ISOLATED_TEST_PROJECT: 'tt-test-aabbccdd',
  TEST_DATABASE_URL: 'postgresql://local_harness:synthetic@postgres:5432/tt_app',
  TEST_CMS_DATABASE_URL: 'postgresql://local_harness:synthetic@postgres:5432/tt_cms',
};

it('permits only the disposable harness databases before privileged proof setup', () => {
  expect(disposableTargets(fixture)).toEqual({
    app: fixture.TEST_DATABASE_URL,
    cms: fixture.TEST_CMS_DATABASE_URL,
  });
});

it.each([
  { APP_ENV: 'stage-local' },
  { ISOLATED_TEST_PROJECT: 'tt-dev' },
  { TEST_DATABASE_URL: undefined },
  { TEST_DATABASE_URL: fixture.TEST_DATABASE_URL.replace('postgres:5432', 'localhost:5432') },
  { TEST_DATABASE_URL: fixture.TEST_DATABASE_URL.replace('5432', '55432') },
  { TEST_DATABASE_URL: fixture.TEST_DATABASE_URL.replace('local_harness', 'postgres') },
  { TEST_DATABASE_URL: fixture.TEST_DATABASE_URL + '?host=external.invalid' },
  { TEST_CMS_DATABASE_URL: fixture.TEST_DATABASE_URL },
])('refuses redirected or non-test targets without echoing credentials (%j)', (change) => {
  expect(() => disposableTargets({ ...fixture, ...change })).toThrow();
  try {
    disposableTargets({ ...fixture, ...change });
  } catch (error) {
    expect(String(error)).not.toContain('synthetic');
  }
});
