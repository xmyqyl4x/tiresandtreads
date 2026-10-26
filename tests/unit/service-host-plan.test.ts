import { it, expect } from 'vitest';
import {
  serviceHostRoles,
  validateServiceHostPlan,
  type ServiceHostPlan,
} from '../../packages/config/src/service-host-plan.ts';
const names = Object.keys(serviceHostRoles) as (keyof typeof serviceHostRoles)[];
function plan(): ServiceHostPlan {
  return {
    urls: Object.fromEntries(
      names.map((n) => [
        n,
        `postgresql://${serviceHostRoles[n]}:fixture@postgres/${n === 'cms' ? 'cms' : 'app'}`,
      ]),
    ) as ServiceHostPlan['urls'],
    max: Object.fromEntries(names.map((n) => [n, 1])) as ServiceHostPlan['max'],
    replicas: 2,
    reserve: 20,
    external: [{ name: 'web', database: 'application', max: 2, replicas: 2 }],
  };
}
it('budgets all 17 owned lanes, CMS, replicas and declared external pools against one cluster limit', () => {
  expect(validateServiceHostPlan(plan())).toMatchObject({
    ownedPools: 17,
    perReplica: { application: 16, cms: 1 },
    application: 36,
    cms: 2,
    external: 4,
    reserve: 20,
    required: 58,
  });
});
it('normalizes the default PostgreSQL port without combining different databases', () => {
  const p = plan();
  expect(
    validateServiceHostPlan({
      ...p,
      urls: { ...p.urls, cms: p.urls.cms.replace('@postgres/', '@postgres:5432/') },
    }).required,
  ).toBe(58);
});
it('refuses missing/extra lanes, wrong roles, query overrides, split application databases and CMS aliases', () => {
  const p = plan();
  for (const urls of [
    { ...p.urls, cms: p.urls.report },
    { ...p.urls, catalog: p.urls.report },
    { ...p.urls, catalog: p.urls.catalog + '?options=x' },
    { ...p.urls, catalog: p.urls.catalog.replace('/app', '/other') },
    { ...p.urls, cms: p.urls.cms.replace('postgres/', 'localhost/') },
    { ...p.urls, hidden: p.urls.report },
  ])
    expect(() => validateServiceHostPlan({ ...p, urls })).toThrow('Invalid service host plan');
  const urls = { ...p.urls };
  delete (urls as Partial<typeof urls>).cms;
  expect(() => validateServiceHostPlan({ ...p, urls: urls as typeof p.urls })).toThrow();
});
it('refuses duplicate/unknown external allocations, invalid bounds and unaccounted pool maxima', () => {
  const p = plan();
  for (const patch of [
    { max: { ...p.max, cms: 0 } },
    { max: { ...p.max, hidden: 1 } },
    { replicas: 0 },
    { reserve: 9 },
    { external: [...p.external, ...p.external] },
    { external: [{ name: 'unknown', database: 'other', max: 1, replicas: 1 }] },
    { external: [{ name: 'web', database: 'application', max: 0, replicas: 1 }] },
  ])
    expect(() => validateServiceHostPlan({ ...p, ...patch } as ServiceHostPlan)).toThrow();
});
