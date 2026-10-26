import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readServiceHostSettings } from '../../packages/config/src/service-host-settings.ts';
import { loadServiceHostSettings } from '../../packages/integrations/src/service-host-config.ts';
import { hostSettings } from '../fixtures/service-host/settings.ts';
function settings() {
  return hostSettings(
    (r) => `postgresql://${r}:fixture@postgres/app`,
    'postgresql://tt_cms_runtime:fixture@postgres/cms',
  );
}
it('loads the complete strict local settings with separate persistent key rings and no provider activation', () => {
  expect(readServiceHostSettings(settings()).policy.fixture).toBe(true);
});
it('refuses real activation, send/source actions, remote origins, duplicate cycles and invalid key coverage', () => {
  const p = settings();
  for (const patch of [
    { policy: { ...p.policy, fixture: false } },
    { origin: 'https://example.com' },
    { origin: 'http://localhost/?token=secret' },
    { maintenance: { enabled: ['delivery'], cycle: ['privacy'] } },
    { maintenance: { enabled: ['sources'], cycle: ['privacy'] } },
    { maintenance: { enabled: ['privacy', 'privacy'], cycle: ['privacy'] } },
    { maintenance: { enabled: [], cycle: ['privacy', 'privacy'] } },
    { maintenance: { enabled: [], cycle: [] } },
    { keys: { ...p.keys, token: { current: 'retired', values: p.keys.token.values } } },
    { applyRetention: true },
  ])
    expect(() => readServiceHostSettings({ ...p, ...patch })).toThrow();
});
it('reads only an explicit bounded regular secret file and redacts malformed contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-host-config-')),
    file = join(dir, 'host.json'),
    env = { APP_ENV: 'test-local', PROVIDER_MODE: 'fixtures', SERVICE_HOST_CONFIG_FILE: file };
  try {
    writeFileSync(file, JSON.stringify(settings()), { mode: 0o600 });
    expect(loadServiceHostSettings(env).schemaVersion).toBe(1);
    writeFileSync(file, '{"secret":"never-echo-this"');
    expect(() => loadServiceHostSettings(env)).toThrow(
      /^Local service host configuration unavailable$/,
    );
    writeFileSync(file, 'x'.repeat(65537));
    expect(() => loadServiceHostSettings(env)).toThrow();
    expect(() => loadServiceHostSettings({ ...env, SERVICE_HOST_CONFIG_FILE: dir })).toThrow();
    expect(() =>
      loadServiceHostSettings({ ...env, SERVICE_HOST_CONFIG_FILE: 'relative.json' }),
    ).toThrow();
    expect(() => loadServiceHostSettings({ ...env, PROVIDER_MODE: 'live' })).toThrow();
    if (process.platform !== 'win32') {
      writeFileSync(file, JSON.stringify(settings()));
      chmodSync(file, 0o644);
      expect(() => loadServiceHostSettings(env)).toThrow();
    }
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'tt-host-config-'))
      throw Error('Unexpected fixture cleanup path');
    rmSync(dir, { recursive: true, force: true });
  }
});
