export const serviceHostRoles = {
  report: 'tt_private_runtime',
  worker: 'tt_private_runtime',
  asset: 'tt_asset_runtime',
  catalog: 'tt_catalog_runtime',
  report_source: 'tt_report_source_runtime',
  ingest: 'tt_ingest_runtime',
  publish: 'tt_publish_runtime',
  content: 'tt_content_runtime',
  public: 'tt_public_runtime',
  privacy: 'tt_privacy_runtime',
  collector: 'tt_analytics_runtime',
  aggregate: 'tt_analytics_runtime',
  limiter: 'tt_limiter_runtime',
  operations: 'tt_operations_runtime',
  staff: 'tt_staff_service_runtime',
  commercial: 'tt_commercial_runtime',
  cms: 'tt_cms_runtime',
} as const;
export type ServiceHostLane = keyof typeof serviceHostRoles;
export interface ServiceHostPlan {
  readonly urls: Readonly<Record<ServiceHostLane, string>>;
  readonly max: Readonly<Record<ServiceHostLane, number>>;
  readonly replicas: number;
  readonly reserve: number;
  readonly external: readonly {
    readonly name: string;
    readonly database: 'application' | 'cms';
    readonly max: number;
    readonly replicas: number;
  }[];
}
export function validateServiceHostPlan(p: ServiceHostPlan) {
  const bad = () => {
    throw Error('Invalid service host plan');
  };
  const integer = (v: number, min: number, max: number) =>
    Number.isSafeInteger(v) && v >= min && v <= max;
  const names = Object.keys(serviceHostRoles) as ServiceHostLane[];
  const complete = (v: object) => Object.keys(v).sort().join(',') === [...names].sort().join(',');
  if (
    !complete(p.urls) ||
    !complete(p.max) ||
    !integer(p.replicas, 1, 100) ||
    !integer(p.reserve, 10, 1000) ||
    !Array.isArray(p.external) ||
    p.external.length > 20
  )
    bad();
  let server = '',
    application = '',
    cms = '';
  const perReplica = { application: 0, cms: 0 };
  for (const n of names) {
    let u: URL;
    try {
      u = new URL(p.urls[n]);
    } catch {
      return bad();
    }
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      !['postgres', '127.0.0.1', 'localhost'].includes(u.hostname) ||
      decodeURIComponent(u.username) !== serviceHostRoles[n] ||
      !u.password ||
      u.search ||
      u.hash ||
      !/^\/[A-Za-z0-9_-]+$/.test(u.pathname) ||
      !integer(p.max[n], 1, 10)
    )
      bad();
    const endpoint = u.hostname + ':' + (u.port || '5432');
    if (server && endpoint !== server) bad();
    server = endpoint;
    if (n === 'cms') cms = u.pathname;
    else {
      if (application && application !== u.pathname) bad();
      application = u.pathname;
    }
    perReplica[n === 'cms' ? 'cms' : 'application'] += p.max[n];
  }
  if (cms === application) bad();
  const totals = {
    application: perReplica.application * p.replicas,
    cms: perReplica.cms * p.replicas,
  };
  let external = 0;
  const seen = new Set<string>();
  for (const x of p.external) {
    if (
      !/^[a-z][a-z0-9_-]{0,39}$/.test(x.name) ||
      seen.has(x.name) ||
      !['application', 'cms'].includes(x.database) ||
      !integer(x.max, 1, 100) ||
      !integer(x.replicas, 1, 100)
    )
      bad();
    seen.add(x.name);
    const count = x.max * x.replicas;
    totals[x.database] += count;
    external += count;
  }
  return Object.freeze({
    ownedPools: names.length,
    perReplica: Object.freeze(perReplica),
    ...totals,
    external,
    reserve: p.reserve,
    required: totals.application + totals.cms + p.reserve,
  });
}
