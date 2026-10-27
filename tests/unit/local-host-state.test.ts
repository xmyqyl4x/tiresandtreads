import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { localHostSettings, readProviderState } from '../../scripts/runtime/local-host-state.ts';
import {
  serviceHostRoles,
  validateServiceHostPlan,
} from '../../packages/config/src/service-host-plan.ts';
const credentials = Object.fromEntries(
  Object.values(serviceHostRoles).map((r, i) => [
    `DB_PASSWORD_${r.toUpperCase()}`,
    i.toString(16).padStart(64, '0'),
  ]),
);
it('creates independent local custody and preserves existing restricted role credentials with a complete shared-server budget', () => {
  const a = localHostSettings('dev', credentials),
    b = localHostSettings('stage', credentials);
  expect(a.keys).not.toEqual(b.keys);
  expect(
    new Set([
      a.keys.token.values['local-v1'],
      a.keys.report.values['local-v1'],
      a.keys.privacy.values['local-v1'],
      a.keys.collection.values['local-v1'],
      a.keys.contactIdentity,
      a.keys.reportIdentity,
      a.keys.collectionIdentity,
      ...Object.values(a.keys.lookup),
    ]).size,
  ).toBe(8);
  for (const [lane, role] of Object.entries(serviceHostRoles))
    expect(new URL(a.plan.urls[lane as keyof typeof serviceHostRoles]).password).toBe(
      credentials[`DB_PASSWORD_${role.toUpperCase()}`],
    );
  expect(validateServiceHostPlan(a.plan)).toMatchObject({ required: 42, ownedPools: 17 });
  expect(a.policy.notices).not.toEqual(b.policy.notices);
  expect(a.maintenance).toEqual({ enabled: ['quotas'], cycle: ['quotas'] });
  expect(() => localHostSettings('production', credentials)).toThrow();
  expect(() => localHostSettings('dev', {})).toThrow();
});
it('refuses redirected, malformed, cross-environment or broadly readable persisted provider manifests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-persist-test-'));
  const file = join(dir, 'provider.json');
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'tt-persist-test-'))
    throw Error('Invalid cleanup');
  const body = {
    schemaVersion: 1,
    target: 'dev',
    keyId: 'local',
    ciphertext: 'AA==',
    plaintextHash: 'a'.repeat(64),
    objects: ['private', 'public'].flatMap((kind) =>
      [1, 2].map((n) => ({
        bucket: `local-host-${kind}-dev`,
        key: 'fixture/provider-canary',
        version: String(n),
        sha256: 'b'.repeat(64),
      })),
    ),
  };
  try {
    await writeFile(file, JSON.stringify(body), { mode: 0o600 });
    expect((await readProviderState(file, 'dev')).objects).toHaveLength(4);
    for (const invalid of [
      { ...body, unexpected: true },
      { ...body, objects: Array(4).fill(body.objects[0]) },
      { ...body, objects: [1, 2, 3, 4].map((n) => ({ ...body.objects[0], version: String(n) })) },
    ]) {
      await writeFile(file, JSON.stringify(invalid));
      await expect(readProviderState(file, 'dev')).rejects.toThrow();
    }
    await writeFile(file, JSON.stringify(body));
    await expect(readProviderState(file, 'stage')).rejects.toThrow();
    await expect(readProviderState('relative', 'dev')).rejects.toThrow();
    await writeFile(
      file,
      JSON.stringify({
        ...body,
        objects: [
          body.objects[0],
          ...body.objects.slice(1).map((o) => ({ ...o, bucket: 'local-host-public-stage' })),
        ],
      }),
    );
    await expect(readProviderState(file, 'dev')).rejects.toThrow();
    await writeFile(file, 'x'.repeat(16385));
    await expect(readProviderState(file, 'dev')).rejects.toThrow();
    if (process.platform !== 'win32') {
      await writeFile(file, JSON.stringify(body));
      await chmod(file, 0o644);
      await expect(readProviderState(file, 'dev')).rejects.toThrow();
      await chmod(file, 0o600);
      await symlink(file, join(dir, 'link'));
      await expect(readProviderState(join(dir, 'link'), 'dev')).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
