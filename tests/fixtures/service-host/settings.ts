import { serviceHostRoles } from '../../../packages/config/src/service-host-plan.ts';
const names = Object.keys(serviceHostRoles) as (keyof typeof serviceHostRoles)[];
export function hostSettings(app: (role: string) => string, cms: string) {
  const ring = (byte: string) => ({ current: 'local-v1', values: { 'local-v1': byte.repeat(32) } });
  const uuid = (n: number) => '00000000-0000-4000-8000-' + n.toString().padStart(12, '0');
  return {
    schemaVersion: 1,
    plan: {
      urls: Object.fromEntries(names.map((n) => [n, n === 'cms' ? cms : app(serviceHostRoles[n])])),
      max: Object.fromEntries(names.map((n) => [n, 1])),
      replicas: 1,
      reserve: 20,
      external: [
        { name: 'web', database: 'application', max: 2, replicas: 1 },
        { name: 'app-test-harness', database: 'application', max: 20, replicas: 1 },
        { name: 'cms-test-harness', database: 'cms', max: 6, replicas: 1 },
      ],
    },
    keys: {
      token: ring('11'),
      report: ring('22'),
      privacy: ring('33'),
      collection: ring('44'),
      lookup: { 'test-hmac-v1': '55'.repeat(32) },
      contactIdentity: '66'.repeat(32),
      reportIdentity: '77'.repeat(32),
      collectionIdentity: '88'.repeat(32),
    },
    policy: {
      fixture: true,
      version: 'synthetic',
      privacyVersion: 'host-fixture',
      jurisdiction: 'hostfixture',
      notices: {
        report: uuid(1),
        offers: uuid(2),
        analytics: uuid(3),
        ads: uuid(4),
        targeted_ads: uuid(5),
        necessary: uuid(6),
      },
      templateId: uuid(7),
      rendererHash: '99'.repeat(32),
    },
    origin: 'https://tiresandtreads.test',
    maintenance: { enabled: [] as string[], cycle: ['privacy', 'quotas', 'analytics', 'assets'] },
  };
}
