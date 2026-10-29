import { afterEach, beforeEach, expect, it } from 'vitest';
import { bootstrapDatabase, databaseRoles } from '../../scripts/database/bootstrap.ts';
import { restrictedAdminFixture } from '../fixtures/restricted-admin/database.ts';

let f: Awaited<ReturnType<typeof restrictedAdminFixture>> | undefined;
beforeEach(async () => {
  f = await restrictedAdminFixture();
});
afterEach(async () => {
  await f?.cleanup();
  f = undefined;
});

it('uses a real restricted PostgreSQL 18 creator that cannot assume the fixture superuser or create elevated roles', async () => {
  const { restricted } = f!;
  expect((await restricted.query('SHOW server_version_num')).rows[0]?.server_version_num).toBe(
    '180006',
  );
  expect(
    (
      await restricted.query(
        'SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0],
  ).toEqual({
    rolsuper: false,
    rolcreatedb: true,
    rolcreaterole: true,
    rolreplication: false,
    rolbypassrls: false,
    rolinherit: false,
  });
  await expect(restricted.query('SET ROLE local_harness')).rejects.toMatchObject({ code: '42501' });
  for (const flag of ['SUPERUSER', 'REPLICATION', 'BYPASSRLS']) {
    await expect(
      restricted.query(`CREATE ROLE restricted_probe_elevated ${flag}`),
    ).rejects.toMatchObject({ code: '42501' });
  }
  expect(
    (await f!.root.query("SELECT 1 FROM pg_roles WHERE rolname='restricted_probe_elevated'"))
      .rowCount,
  ).toBe(0);
});

it('observes automatic creator ADMIN membership without SET or INHERIT and cannot remove the bootstrap-superuser grant', async () => {
  await f!.createChild();
  expect(await f!.memberships('restricted_probe_child')).toEqual([
    {
      member: 'restricted_probe_admin',
      grantor: 'local_harness',
      admin_option: true,
      inherit_option: false,
      set_option: false,
    },
  ]);
  await expect(f!.restricted.query('SET ROLE restricted_probe_child')).rejects.toMatchObject({
    code: '42501',
  });
  const before = await f!.memberships('restricted_probe_child');
  await f!.restricted.query('REVOKE restricted_probe_child FROM restricted_probe_admin');
  expect(await f!.memberships('restricted_probe_child')).toEqual(before);
});

it.each(['app', 'cms'] as const)(
  'refuses an admin-owned %s database before changing scoped roles or ACLs',
  async (target) => {
    await f!.root.query(`ALTER DATABASE ${f!.database(target)} OWNER TO restricted_probe_admin`);
    const before = await f!.snapshot();
    await expect(
      bootstrapDatabase(f!.url(target), target, f!.database(target), f!.passwords),
    ).rejects.toThrow('Refusing unexpected database or ownership');
    expect(await f!.snapshot()).toEqual(before);
    expect(await f!.scopedRoleCount()).toBe(0);
  },
);

it.each(['app', 'cms'] as const)(
  'rolls back a fresh restricted %s bootstrap when privileged ownership/configuration requirements cannot be met',
  async (target) => {
    const before = await f!.snapshot();
    await expect(
      bootstrapDatabase(f!.url(target), target, f!.database(target), f!.passwords),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await f!.snapshot()).toEqual(before);
    expect(await f!.scopedRoleCount()).toBe(0);
  },
);

it.each(['app', 'cms'] as const)(
  'refuses creator-precreated %s roles with actual automatic memberships without changing their state',
  async (target) => {
    await f!.precreateScopedRoles();
    expect(await f!.scopedRoleCount()).toBe(19);
    expect(await f!.scopedMembershipCount()).toBe(19);
    const before = await f!.snapshot();
    await expect(
      bootstrapDatabase(f!.url(target), target, f!.database(target), f!.passwords),
    ).rejects.toThrow('Existing role has unexpected memberships');
    expect(await f!.snapshot()).toEqual(before);
  },
);

it('distinguishes a SET grant from actually assuming the owner for default ACLs; both leave membership behind', async () => {
  await f!.createChild();
  await f!.root.query(`ALTER DATABASE ${f!.database('app')} OWNER TO restricted_probe_admin`);
  await f!.restricted.query("ALTER ROLE restricted_probe_child SET statement_timeout TO '15s'");
  await expect(
    f!.restricted.query(`ALTER DATABASE ${f!.database('app')} OWNER TO restricted_probe_child`),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f!.restricted.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE restricted_probe_child REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await f!.restricted.query(
    'GRANT restricted_probe_child TO restricted_probe_admin WITH SET TRUE, INHERIT FALSE',
  );
  await f!.restricted.query(`ALTER DATABASE ${f!.database('app')} OWNER TO restricted_probe_child`);
  await expect(
    f!.restricted.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE restricted_probe_child REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await f!.restricted.query('SET ROLE restricted_probe_child');
  try {
    await f!.restricted.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE restricted_probe_child REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    );
  } finally {
    await f!.restricted.query('RESET ROLE');
  }
  expect((await f!.memberships('restricted_probe_child')).some((row) => row.set_option)).toBe(true);
});

it('requires the fixture superuser to clear all 19 creator grants; clean bootstrap/replay succeeds only as a privileged control', async () => {
  await f!.precreateScopedRoles();
  for (const role of Object.values(databaseRoles).flat()) {
    await f!.root.query(`REVOKE ${role} FROM restricted_probe_admin GRANTED BY local_harness`);
  }
  expect(await f!.scopedMembershipCount()).toBe(0);
  await f!.bootstrapAsRoot();
  const clean = await f!.snapshot();
  // Separate connection admission from role-administration authority in this diagnostic.
  await f!.allowAdminConnect();
  expect(await f!.snapshot()).not.toEqual(clean);
  const before = await f!.snapshot();
  await f!.bootstrapAsRoot();
  expect(await f!.snapshot()).toEqual(before);
  expect(await f!.scopedRoleCount()).toBe(19);
  expect(await f!.scopedMembershipCount()).toBe(0);
  await expect(
    bootstrapDatabase(f!.url('app'), 'app', f!.database('app'), f!.passwords),
  ).rejects.toMatchObject({ code: '42501' });
  expect(await f!.snapshot()).toEqual(before);
});

it.each(['app', 'cms'] as const)(
  'does not mistake a clean restricted %s owner for an administrator able to replay other roles',
  async (target) => {
    await f!.bootstrapAsRoot();
    // Force an observable early GUC update so the later role refusal must roll it back.
    await f!.withClient(target, `tt_${target}_migrator`, async (owner) => {
      await owner.query(
        `ALTER ROLE tt_${target}_migrator IN DATABASE ${f!.database(target)} SET statement_timeout TO '27s'`,
      );
    });
    const before = await f!.snapshot();
    await expect(
      bootstrapDatabase(
        f!.url(target, `tt_${target}_migrator`),
        target,
        f!.database(target),
        f!.passwords,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await f!.snapshot()).toEqual(before);
  },
);

it('preserves default function/type restrictions, row policy and cross-database denial after privileged control replay', async () => {
  await f!.bootstrapAsRoot();
  const scoped = (await f!.snapshot()).roleState.filter((row) =>
    Object.values(databaseRoles).flat().includes(row.rolname),
  );
  expect(scoped).toHaveLength(19);
  for (const row of scoped)
    expect(row).toMatchObject({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcanlogin: true,
    });
  await f!.withClient('app', 'tt_app_migrator', async (owner) => {
    await owner.query(
      "CREATE TABLE public.restricted_probe_rows(id int PRIMARY KEY); INSERT INTO public.restricted_probe_rows VALUES (1); ALTER TABLE public.restricted_probe_rows ENABLE ROW LEVEL SECURITY; CREATE POLICY deny_rows ON public.restricted_probe_rows USING (false); GRANT USAGE ON SCHEMA public TO tt_app_runtime; GRANT SELECT ON public.restricted_probe_rows TO tt_app_runtime; CREATE FUNCTION public.restricted_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'; CREATE TYPE public.restricted_probe_type AS ENUM ('synthetic')",
    );
  });
  const before = await f!.snapshot();
  await f!.bootstrapAsRoot();
  expect(await f!.snapshot()).toEqual(before);
  await f!.withClient('app', 'tt_app_runtime', async (runtime) => {
    expect((await runtime.query('SELECT * FROM public.restricted_probe_rows')).rows).toEqual([]);
    expect(
      (
        await runtime.query(
          "SELECT has_function_privilege(current_user,'public.restricted_probe_fn()','EXECUTE') AS fn, has_type_privilege(current_user,'public.restricted_probe_type','USAGE') AS type",
        )
      ).rows[0],
    ).toEqual({ fn: false, type: false });
    await expect(runtime.query('SELECT public.restricted_probe_fn()')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime.query('CREATE TABLE public.restricted_probe_forbidden(id int)'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('SET ROLE tt_app_migrator')).rejects.toMatchObject({
      code: '42501',
    });
  });
  await expect(f!.withClient('cms', 'tt_app_runtime', async () => undefined)).rejects.toMatchObject(
    { code: '42501' },
  );
  await expect(f!.withClient('app', 'tt_cms_runtime', async () => undefined)).rejects.toMatchObject(
    { code: '42501' },
  );
  expect(await f!.scopedMembershipCount()).toBe(0);
  console.log(
    'RESTRICTED_ADMIN_EVIDENCE',
    JSON.stringify({
      scope: 'disposable PostgreSQL 18.6 only',
      scopedRoles: 19,
      ordinaryCreatorBootstrapAccepted: false,
      automaticMembershipReplayRefused: true,
      privilegedControlReplay: true,
      runtimeElevated: false,
      actualProviderTest: false,
      hostedAccepted: false,
      productActivation: false,
      operatorAssignmentsConfirmed: false,
      actualRecipientNotifications: 0,
    }),
  );
});
