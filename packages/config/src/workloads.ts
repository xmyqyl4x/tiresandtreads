export const workloadRoles = {
  report: 'tt_private_runtime',
  worker: 'tt_private_runtime',
  collector: 'tt_analytics_runtime',
  aggregate: 'tt_analytics_runtime',
  limiter: 'tt_limiter_runtime',
  operations: 'tt_operations_runtime',
} as const;
export type Workload = keyof typeof workloadRoles;
export interface WorkloadPlan {
  readonly urls: Readonly<Record<Workload, string>>;
  readonly max: Readonly<Record<Workload, number>>;
  readonly replicas: number;
  readonly otherConnections: number;
  readonly reserve: number;
}
export function validateWorkloads(p: WorkloadPlan) {
  const integer = (x: number, min: number, max: number) =>
    Number.isSafeInteger(x) && x >= min && x <= max;
  if (
    !integer(p.replicas, 1, 100) ||
    !integer(p.otherConnections, 0, 10000) ||
    !integer(p.reserve, 10, 1000)
  )
    throw Error('Invalid workload budget');
  let db: string | undefined,
    total = 0;
  for (const lane of Object.keys(workloadRoles) as Workload[]) {
    let u: URL;
    try {
      u = new URL(p.urls[lane]);
    } catch {
      throw Error('Invalid workload budget');
    }
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      decodeURIComponent(u.username) !== workloadRoles[lane] ||
      !u.password ||
      u.hash ||
      !integer(p.max[lane], 1, 10)
    )
      throw Error('Invalid workload budget');
    const identity = u.hostname + ':' + u.port + u.pathname;
    if (db !== undefined && db !== identity) throw Error('Workload databases must match');
    db = identity;
    total += p.max[lane];
  }
  return p.replicas * total + p.otherConnections + p.reserve;
}
