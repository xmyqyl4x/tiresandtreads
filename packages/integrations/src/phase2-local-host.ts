import { createRuntimePool } from '../../db/src/runtime-pool.ts';
import { createTransactions } from '../../db/src/transactions.ts';
import { createJobRepository } from '../../db/src/repositories/jobs.ts';
import { id, revision, ok } from '../../domain/src/values/core.ts';
import { composePhase2LocalServices, type Phase2LocalBindings } from './phase2-local-services.ts';
import { readLocalPhase2Material, createLocalEncryptedObjects } from './local-encrypted-objects.ts';
const roles = {
  partner: 'tt_p2_partner_service',
  pilot: 'tt_p2_pilot_service',
  coupon: 'tt_p2_coupon_worker',
  analysis: 'tt_p2_analysis_service',
  insights: 'tt_p2_insights_service',
  private: 'tt_private_runtime',
  privacy: 'tt_privacy_runtime',
  asset: 'tt_asset_runtime',
  staff: 'tt_p2_csv_staff',
  ingest: 'tt_ingest_runtime',
  publish: 'tt_publish_runtime',
} as const;
export type Phase2LocalLane = keyof typeof roles;
export type Phase2LocalScopes = Readonly<
  Record<Phase2LocalLane, ReturnType<typeof createTransactions>>
>;
export interface Phase2LocalHostOptions {
  readonly mode: 'local-opt-in';
  readonly effects: 'synthetic-injected';
  readonly urls: Readonly<Record<Phase2LocalLane, string>>;
  readonly otherConnections: number;
  readonly reserve: number;
  readonly materialFile: string;
  readonly objectsDirectory: string;
  readonly bind: (
    context: Readonly<{
      scopes: Phase2LocalScopes;
      material: Awaited<ReturnType<typeof readLocalPhase2Material>>;
      objects: Awaited<ReturnType<typeof createLocalEncryptedObjects>>;
    }>,
  ) => Promise<Phase2LocalBindings>;
}
// Opt-in disposable local host only. No migration/bootstrap/role/account/provider provisioning.
export async function createPhase2LocalHost(o: Phase2LocalHostOptions) {
  if (
    o.mode !== 'local-opt-in' ||
    o.effects !== 'synthetic-injected' ||
    !Number.isSafeInteger(o.otherConnections) ||
    o.otherConnections < 0 ||
    o.otherConnections > 100 ||
    !Number.isSafeInteger(o.reserve) ||
    o.reserve < 4 ||
    o.reserve > 100 ||
    Object.keys(o.urls).sort().join(',') !== Object.keys(roles).sort().join(',')
  )
    throw Error('Local Phase 2 configuration refused');
  let address: string | undefined;
  for (const lane of Object.keys(roles) as Phase2LocalLane[]) {
    let u: URL;
    try {
      u = new URL(o.urls[lane]);
    } catch {
      throw Error('Local Phase 2 database refused');
    }
    const target = u.hostname + ':' + (u.port || '5432') + u.pathname;
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      !['postgres', 'localhost', '127.0.0.1'].includes(u.hostname) ||
      decodeURIComponent(u.username) !== roles[lane] ||
      !u.password ||
      u.search ||
      u.hash ||
      !/^\/tt_app_(catalog|p2_[a-z0-9_]{1,48})$/.test(u.pathname) ||
      (address && address !== target)
    )
      throw Error('Local Phase 2 database refused');
    address = target;
  }
  const material = await readLocalPhase2Material(o.materialFile),
    objects = await createLocalEncryptedObjects(o.objectsDirectory, material);
  const pools = Object.fromEntries(
    (Object.keys(roles) as Phase2LocalLane[]).map((lane) => [
      lane,
      createRuntimePool(o.urls[lane], 1, 4, 'tt-p2-local:' + lane),
    ]),
  ) as Record<Phase2LocalLane, ReturnType<typeof createRuntimePool>>;
  const scopes = Object.freeze(
    Object.fromEntries(
      (Object.keys(roles) as Phase2LocalLane[]).map((lane) => [
        lane,
        createTransactions(pools[lane].pool, {
          transactionMs: 15000,
          statementMs: 8000,
          lockMs: 3000,
        }),
      ]),
    ),
  ) as Phase2LocalScopes;
  let stopping = false,
    closed: Promise<void> | undefined,
    ticking = false;
  const active = new Set<Promise<unknown>>();
  async function activity<T>(work: () => Promise<T>): Promise<T> {
    if (stopping || active.size >= 32) throw Error('Local Phase 2 host unavailable');
    const task = Promise.resolve().then(work);
    active.add(task);
    try {
      return await task;
    } finally {
      active.delete(task);
    }
  }
  async function shutdown() {
    stopping = true;
    return (closed ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...active]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        await Promise.all(Object.values(pools).map((p) => p.drain(1000)));
      }
    })());
  }
  let phase = 'database';
  const required = Object.keys(roles).length + o.otherConnections + o.reserve;
  try {
    for (const lane of Object.keys(roles) as Phase2LocalLane[]) {
      phase = 'database:' + lane;
      const s = scopes[lane],
        proof = await s.unitOfWork.run(async (tx) =>
          ok(
            (
              await s.query(
                tx,
                "SELECT current_user AS role,current_database() AS database,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,current_setting('max_connections')::int-current_setting('superuser_reserved_connections')::int-current_setting('reserved_connections')::int AS available,(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('app','partners','admin','privacy','email','analytics','migration_meta')) AS tables,EXISTS(SELECT 1 FROM pg_class h JOIN pg_namespace ns ON ns.oid=h.relnamespace WHERE ns.nspname='admin' AND h.relname='ai_operation_commands' AND h.relkind='r') AS latest FROM pg_roles r WHERE r.rolname=current_user",
              )
            ).rows[0],
          ),
        );
      if (
        !proof.ok ||
        proof.value?.role !== roles[lane] ||
        proof.value.tables !== 225 ||
        !proof.value.latest ||
        proof.value.rolsuper ||
        proof.value.rolbypassrls ||
        proof.value.rolcreaterole ||
        proof.value.rolcreatedb ||
        typeof proof.value.available !== 'number' ||
        proof.value.available < required
      )
        throw Error('Local Phase 2 database readiness refused');
    }
    phase = 'bindings';
    const b = await o.bind({ scopes, material, objects });
    const bound = [
      ['partner', b.partner.uow],
      ['pilot', b.pilot.uow],
      ['coupon', b.couponWorker.uow],
      ['analysis', b.report.uow],
      ['analysis', b.photo.uow],
      ['analysis', b.generic.uow],
      ['analysis', b.operations.uow],
      ['insights', b.insights.uow],
      ['private', b.delivery.uow],
      ['privacy', b.privacy.scope.unitOfWork],
      ['analysis', b.privacy.ownerScope.unitOfWork],
      ['staff', b.csv.staff.unitOfWork],
      ['ingest', b.csv.ingest.unitOfWork],
      ['publish', b.csv.publish.unitOfWork],
    ] as const;
    if (
      bound.some(([lane, uow]) => scopes[lane].unitOfWork !== uow) ||
      b.partner.objects !== objects ||
      b.couponWorker.objects !== objects ||
      b.photo.objects !== objects ||
      b.privacy.objects !== objects
    )
      throw Error('Local Phase 2 dependency binding refused');
    const methods = [
      ['analyze', b.report.provider],
      ['analyze', b.generic.provider],
      ['extract', b.photo.provider],
      ['scan', b.photo.scanner],
      ['append', b.privacy.analysisJournal],
      ['append', b.privacy.journal],
      ['erase', b.privacy.provider],
      ['erase', b.privacy.mail],
      ['verify', b.privacy.mail],
      ['send', b.delivery.provider],
      ['send', b.pilot.provider],
      ['render', b.pilot.renderer],
      ['render', b.delivery.renderer],
      ['verify', b.partner.authority],
    ] as const;
    if (
      methods.some(
        ([name, port]) =>
          !port || typeof (port as unknown as Record<string, unknown>)[name] !== 'function',
      )
    )
      throw Error('Local Phase 2 required port missing');
    let verifiedObjectKeyVersions = 0;
    async function probeObjectKeys() {
      const s = scopes.asset,
        rows = await s.unitOfWork.run(async (tx) =>
          ok(
            (
              await s.query(
                tx,
                "SELECT DISTINCT ON(key_version) id,revision::text,object_key,mime_type,sha256,size_bytes::text,object_version,key_version FROM app.object_assets WHERE bucket=$1 AND state='ready' ORDER BY key_version,id LIMIT 5",
                [b.partner.policy.assetBucket],
              )
            ).rows,
          ),
        );
      if (!rows.ok || rows.value.length > 4) throw Error('Local private object readiness refused');
      // Release SQL before filesystem I/O. One authenticated representative per retained key version.
      for (const row of rows.value) {
        const asset = id('asset', row.id),
          rev = revision(row.revision);
        if (
          !asset.ok ||
          !rev.ok ||
          typeof row.key_version !== 'string' ||
          !material.keys[row.key_version] ||
          row.key_version !== b.partner.policy.assetKeyVersion ||
          typeof row.object_version !== 'string'
        )
          throw Error('Local private object readiness refused');
        await objects.get({
          id: asset.value,
          revision: rev.value,
          key: String(row.object_key),
          mime: String(row.mime_type),
          sha256: String(row.sha256),
          size: Number(row.size_bytes),
          version: row.object_version,
          state: 'ready',
        });
      }
      verifiedObjectKeyVersions = rows.value.length;
    }
    await probeObjectKeys();
    phase = 'services';
    const services = await composePhase2LocalServices(b);
    function guard<T extends object>(service: T): T {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(service).map(([k, v]) => [
            k,
            typeof v === 'function'
              ? (...args: unknown[]) => activity(async () => Reflect.apply(v, service, args))
              : v,
          ]),
        ),
      ) as T;
    }
    async function tick() {
      return activity(async () => {
        if (ticking) throw Error('Local Phase 2 tick already active');
        ticking = true;
        try {
          const refreshed = await services.generic.refreshPopular(),
            expired = await services.photo.expire();
          if (!refreshed.ok || !expired.ok) throw Error('Local Phase 2 maintenance unavailable');
          let attemptedJobs = 0,
            deferred = 0;
          const observe = (r: { ok: boolean }) => {
            attemptedJobs++;
            if (!r.ok) deferred++;
          };
          for (const lane of ['analysis', 'coupon'] as const) {
            phase = 'database:' + lane;
            const s = scopes[lane],
              jobs = createJobRepository(s),
              due = await s.unitOfWork.run(async (tx) => ok(await jobs.reconcile(tx)));
            if (!due.ok) throw Error('Local Phase 2 job discovery unavailable');
            for (const job of due.value) {
              const result = await s.unitOfWork.run(async (tx) =>
                ok(
                  (
                    await s.query(
                      tx,
                      'SELECT job_type,schema_version,resource_id FROM app.job_runs WHERE id=$1',
                      [job],
                    )
                  ).rows[0],
                ),
              );
              if (!result.ok || !result.value || result.value.schema_version !== 1) continue;
              const row = result.value,
                request = id('ai_request', row.resource_id);
              if (!request.ok) continue;
              if (lane === 'coupon' && row.job_type === 'partner.coupon_import') {
                const lease = await services.couponWorker.lease(job);
                if (lease.ok && lease.value) {
                  observe(await services.couponWorker.process(lease.value));
                }
              } else if (lane === 'analysis' && row.job_type === 'ai.report-analysis') {
                observe(await services.report.execute(request.value));
              } else if (lane === 'analysis' && row.job_type === 'ai.generic-analysis') {
                observe(await services.generic.execute(request.value));
              } else if (lane === 'analysis' && row.job_type === 'p2.photo.extract') {
                const found = await s.unitOfWork.run(async (tx) =>
                  ok(
                    (
                      await s.query(
                        tx,
                        'SELECT request_id FROM app.photo_extractions WHERE id=$1',
                        [row.resource_id],
                      )
                    ).rows[0],
                  ),
                );
                const rid = id('ai_request', found.ok ? found.value?.request_id : null);
                if (rid.ok) {
                  observe(await services.photo.execute(rid.value));
                }
              }
            }
          }
          const erased = await services.erasure.sweep();
          if (!erased.ok) throw Error('Local Phase 2 erasure sweep unavailable');
          const pending = await services.erasure.pending();
          if (!pending.ok) throw Error('Local Phase 2 erasure discovery unavailable');
          for (const job of pending.value.slice(0, 4)) await services.erasure.workOne(job);
          const rights = await services.privacy.ready(4);
          if (!rights.ok) throw Error('Local privacy work discovery unavailable');
          for (const request of rights.value) observe(await services.privacy.workOne(request));
          const pilot = scopes.pilot,
            due = await pilot.unitOfWork.run(async (tx) =>
              ok(
                (
                  await pilot.query(
                    tx,
                    "SELECT w.send_id FROM partners.pilot_work w WHERE w.state IN('queued','reserved','dispatching') AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp()) AND EXISTS(SELECT 1 FROM partners.pilot_due(w.send_id)) ORDER BY w.send_id LIMIT 4",
                  )
                ).rows,
              ),
            );
          if (!due.ok) throw Error('Local pilot discovery unavailable');
          for (const row of due.value) {
            const send = id('send', row.send_id);
            if (send.ok) observe(await services.pilot.dispatch(send.value));
          }
          const sends = await services.delivery.reconcile();
          if (!sends.ok) throw Error('Local Phase 2 delivery discovery unavailable');
          // A captured pilot owns this send even when terminal/uncertain. Never also dispatch through P1.
          const pilotOwned = await pilot.unitOfWork.run(async (tx) =>
            ok(
              (
                await pilot.query(
                  tx,
                  'SELECT send_id FROM partners.pilot_requests WHERE send_id=ANY($1::uuid[])',
                  [sends.value],
                )
              ).rows,
            ),
          );
          if (!pilotOwned.ok) throw Error('Local delivery ownership unavailable');
          const owned = new Set(pilotOwned.value.map((x) => x.send_id));
          for (const send of sends.value.filter((send) => !owned.has(send)).slice(0, 4))
            observe(await services.delivery.dispatch(send));
          return { attemptedJobs, deferred, activation: false as const };
        } finally {
          ticking = false;
        }
      });
    }
    return {
      services: Object.freeze(
        Object.fromEntries(
          Object.entries(services)
            .filter(([k]) => k !== 'couponWorker')
            .map(([k, v]) => [k, guard(v)]),
        ),
      ) as Omit<typeof services, 'couponWorker'>,
      tick,
      shutdown,
      readiness: async () => {
        if (stopping) return false;
        try {
          const p = await scopes.analysis.unitOfWork.run(async (tx) =>
            ok((await scopes.analysis.query(tx, 'SELECT 1 AS ready')).rows[0]?.ready),
          );
          if (!p.ok || p.value !== 1) return false;
          await probeObjectKeys();
          return true;
        } catch {
          return false;
        }
      },
      metadata: Object.freeze({
        mode: 'local-opt-in',
        effects: 'synthetic-injected',
        connections: 11,
        verifiedObjectKeyVersions,
        requiredConnections: required,
        workerTickConcurrency: 1,
        maximumActiveCalls: 32,
        defaultMigrationsPromoted: false,
        activation: false,
      }),
    };
  } catch {
    await shutdown();
    throw Error('Local Phase 2 host unavailable:' + phase);
  }
}
