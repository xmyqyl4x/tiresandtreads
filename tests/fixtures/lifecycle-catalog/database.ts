import pg from 'pg';
import { lifecycleFixture } from '../lifecycle-validation/database.ts';
import { disposableTargets } from '../foundation/target.ts';
import { databaseRoles } from '../../../packages/config/src/database-roles.ts';
import { digest } from '../../../scripts/database/inventory.ts';
import {
  lifecycleCatalog,
  lifecyclePhases,
  inspectLifecycle,
  readLifecycleRequest,
  withReadOnlyLifecycle,
  type LifecyclePhase,
  type LifecycleTarget,
} from '../lifecycle-validation/reader.ts';

// Fixed synthetic probes only. The unchanged reader receives this trusted baseline
// before any fault; no production entry point imports this fixture or accepts it.
export async function catalogFixture(phase: LifecyclePhase) {
  if (!lifecyclePhases.includes(phase)) throw Error('Invalid disposable catalog profile');
  const targets = disposableTargets(process.env);
  const f = await lifecycleFixture(phase);
  const grantors = ['catalog_probe_grantor_a', 'catalog_probe_grantor_b'] as const;
  const roles = [...grantors, 'catalog_probe_owner_sink'];
  const created: string[] = [];
  async function cleanup() {
    const admin = new pg.Client({
      connectionString: targets.app,
      connectionTimeoutMillis: 1500,
      statement_timeout: 3000,
    });
    try {
      // Close/drop the exact owned probe DBs first, removing their grant dependencies.
      // This connection is to the disposable source DB, never a DB being dropped.
      try {
        await f.cleanup();
      } finally {
        if (created.length) {
          await admin.connect();
          for (const role of created) await admin.query(`DROP ROLE ${role}`);
        }
      }
    } finally {
      await admin.end().catch(() => {});
    }
  }
  try {
    if ((await f.root.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [roles])).rowCount)
      throw Error('Catalog fixture refuses pre-existing probe grantors');
    for (const role of roles) {
      await f.root.query(
        `CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      created.push(role);
    }
    for (const target of ['app', 'cms'] as const) {
      await f.withOwner(target, (c) =>
        c.query(`
          CREATE SCHEMA catalog_probe;
          CREATE TABLE public.catalog_probe(id int PRIMARY KEY,v int NOT NULL,
            CONSTRAINT catalog_probe_nonnegative CHECK(v >= 0));
          INSERT INTO public.catalog_probe VALUES(1,7),(2,7);
          ALTER TABLE public.catalog_probe ENABLE ROW LEVEL SECURITY;
          CREATE POLICY catalog_probe_read ON public.catalog_probe
            TO ${databaseRoles[target][1]} USING (id > 0);
          CREATE SEQUENCE public.catalog_probe_seq;
          CREATE TYPE public.catalog_probe_type AS ENUM ('synthetic');
          CREATE FUNCTION public.catalog_probe_fn() RETURNS int LANGUAGE sql
            SECURITY INVOKER SET search_path=pg_catalog AS 'SELECT 1';
          CREATE FUNCTION public.catalog_probe_trigger() RETURNS trigger LANGUAGE plpgsql
            SET search_path=pg_catalog AS $$BEGIN RETURN NEW; END$$;
          GRANT USAGE ON SCHEMA public TO ${grantors.join(',')};
          GRANT SELECT ON public.catalog_probe TO ${grantors.join(',')} WITH GRANT OPTION;
        `),
      );
      await f.withRoot(target, (c) =>
        c.query(
          `SET ROLE ${grantors[0]}; GRANT SELECT ON public.catalog_probe TO ${databaseRoles[target][1]}`,
        ),
      );
    }
    const catalogs = {} as Record<LifecycleTarget, string>;
    for (const target of ['app', 'cms'] as const)
      catalogs[target] = await withReadOnlyLifecycle(
        readLifecycleRequest(f.input(target), process.env),
        async (c) => digest(await lifecycleCatalog(c)),
      );
    // Only the active fixture profile receives the curated probe inventory. Original
    // fixture/source/DB-ACL/history contracts stay unchanged. Never recapture after a fault.
    const baseline = Object.freeze({
      ...f.baseline,
      ...(phase === 'foundation'
        ? { foundation: Object.freeze(catalogs) }
        : { migrated: Object.freeze(catalogs) }),
    });
    return {
      ...f,
      baseline,
      cleanup,
      inspect: (target: LifecycleTarget) =>
        inspectLifecycle(f.input(target), process.env, baseline),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
