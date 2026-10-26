import { it, expect } from 'vitest';
import {
  validateWorkloads,
  workloadRoles,
  type Workload,
  type WorkloadPlan,
} from '../../packages/config/src/workloads.ts';
const names = Object.keys(workloadRoles) as Workload[];
const plan: WorkloadPlan = {
  urls: Object.fromEntries(
    names.map((n) => [n, 'postgresql://' + workloadRoles[n] + ':fixture@postgres/app']),
  ) as Record<Workload, string>,
  max: Object.fromEntries(names.map((n) => [n, 1])) as Record<Workload, number>,
  replicas: 2,
  otherConnections: 3,
  reserve: 10,
};
it('accounts for every replica, lane, other connection and reserved slot', () => {
  expect(validateWorkloads(plan)).toBe(25);
});
it.each([0, 11, 1.5])('refuses invalid per-lane pool maximum %s', (aggregate) => {
  expect(() => validateWorkloads({ ...plan, max: { ...plan.max, aggregate } })).toThrow();
});
it('refuses role mismatch, split databases and invalid budget dimensions', () => {
  expect(() =>
    validateWorkloads({ ...plan, urls: { ...plan.urls, collector: plan.urls.report } }),
  ).toThrow();
  expect(() =>
    validateWorkloads({
      ...plan,
      urls: { ...plan.urls, collector: plan.urls.collector.replace('/app', '/other') },
    }),
  ).toThrow();
  for (const bad of [{ reserve: 0 }, { replicas: 0 }, { otherConnections: -1 }])
    expect(() => validateWorkloads({ ...plan, ...bad })).toThrow();
});
