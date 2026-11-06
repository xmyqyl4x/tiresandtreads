import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  partnerRepositoryFixture,
  partnerRepositoryRoles,
  partnerRepositorySources,
} from '../fixtures/phase2/partner-repositories.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { createPartnerTenantRepository } from '../../packages/db/src/repositories/partner-tenant.ts';
import { id, ok, type Id, type Instant } from '../../packages/domain/src/values/core.ts';
import type { TransactionContext as Tx } from '../../packages/application/src/ports/transactions.ts';
import type {
  PartnerAllocationPlan,
  OfferDraft,
} from '../../packages/application/src/ports/partner-repositories.ts';
import { createPartnerOfferRepository } from '../../packages/db/src/repositories/partner-offers.ts';
import { createPartnerAllocationRepository } from '../../packages/db/src/repositories/partner-allocations.ts';
import { createPartnerReportingRepository } from '../../packages/db/src/repositories/partner-reporting.ts';
import { createPartnerIdentityRepository } from '../../packages/db/src/repositories/partner-identity.ts';
import { revision } from '../../packages/domain/src/values/core.ts';
import { repositorySeeds } from '../fixtures/phase2/seed-partner-repositories.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
let f: Awaited<ReturnType<typeof partnerRepositoryFixture>>;
let seed: Awaited<ReturnType<typeof repositorySeeds>>,
  reader: ReturnType<typeof f.adapter>,
  writer: ReturnType<typeof f.adapter>,
  allocation: ReturnType<typeof f.adapter>;
beforeAll(async () => {
  f = await partnerRepositoryFixture();
  seed = await repositorySeeds(f);
  reader = f.adapter('tt_p2_pilot_reader', 2);
  writer = f.adapter('tt_p2_offer_writer', 2);
  allocation = f.adapter('tt_p2_allocation_runtime', 4);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
it('UC11 returns the current organization through a real restricted pilot role and typed repository', async () => {
  const org = randomUUID(),
    actor = 'synthetic:' + randomUUID();
  await f.admin.query(
    "INSERT INTO partners.organizations(id,legal_name,market) VALUES($1,'Synthetic repository partner','US')",
    [org],
  );
  await f.admin.query(
    "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,$2,'owner','active')",
    [org, actor],
  );
  const parsed = id('organization', org);
  if (!parsed.ok) throw Error('fixture id');
  const tx = f.adapter('tt_p2_pilot_reader'),
    repo = createPartnerTenantRepository(tx);
  const result = await tx.unitOfWork.run(async (t) =>
    ok(await repo.organization(t, { organizationId: parsed.value, actor })),
  );
  expect(result).toMatchObject({
    ok: true,
    value: { id: org, legalName: 'Synthetic repository partner', revision: 1n },
  });
});
function uuid<K extends string>(kind: K, value: string): Id<K> {
  const r = id(kind, value);
  if (!r.ok) throw Error('fixed test id');
  return r.value;
}
const scope = (org: { id: string; actor: string }) => ({
  organizationId: uuid('organization', org.id),
  actor: org.actor,
});
function page(limit = 2, after: string | null = null) {
  const r = pageRequest(limit, after);
  if (!r.ok) throw Error('fixed page');
  return r.value;
}
async function run<T>(adapter: typeof reader, work: (tx: Tx) => Promise<T>) {
  return adapter.unitOfWork.run(async (tx) => ok(await work(tx)));
}
async function value<T>(adapter: typeof reader, work: (tx: Tx) => Promise<T>) {
  const r = await run(adapter, work);
  expect(r).toMatchObject({ ok: true });
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
type Offer = Awaited<ReturnType<typeof seed.offer>>;
type Send = Awaited<ReturnType<typeof seed.send>>;
const allocations = () => createPartnerAllocationRepository(allocation);
async function plan(
  offer?: Offer,
  message?: Send,
  options: { limit?: number; units?: bigint; code?: boolean; endSeconds?: number } = {},
): Promise<{
  input: PartnerAllocationPlan;
  offer: Offer;
  message: Send;
  cap: string;
  code: string | null;
}> {
  const o = offer ?? (await seed.offer(await seed.company())),
    m = message ?? (await seed.send()),
    cap = randomUUID();
  const code = o.mode === 'shared' || options.code === false ? null : await seed.code(o);
  await f.admin.query(
    "INSERT INTO partners.offer_cap_windows(id,org_id,offer_id,kind,policy_version,window_start,window_end,limit_units) VALUES($1,$2,$3,'total','repository-v1',now()-interval '1 day',now()+($5::integer*interval '1 second'),$4)",
    [cap, o.org.id, o.id, String(options.limit ?? 20), options.endSeconds ?? 86400],
  );
  const input: PartnerAllocationPlan = {
    requestKey: randomUUID(),
    organizationId: uuid('organization', o.org.id),
    offerId: uuid('partner_offer', o.id),
    poolId: uuid('coupon_pool', o.pool),
    subjectId: uuid('subject', m.subject),
    sendId: uuid('send', m.id),
    version: 1,
    slot: 1,
    policyVersion: 'repository-v1',
    reasons: ['synthetic_selection'],
    caps: [{ id: uuid('offer_cap', cap), units: options.units ?? 1n }],
    frequencies: [
      {
        scope: 'overall_marketing',
        kind: 'calendar_month',
        timeZone: 'UTC',
        limit: 4,
      },
      {
        scope: 'offer:' + o.id,
        kind: 'rolling_30_days',
        timeZone: null,
        limit: 1,
      },
    ],
  };
  return { input, offer: o, message: m, cap, code };
}
it('uses the complete immutable history through local repository support and replays as a no-op', async () => {
  expect(f.repositoryApplied).toBe(2);
  const rows = (
    await f.admin.query('SELECT position,id FROM migration_meta.applied ORDER BY position')
  ).rows;
  expect(rows).toHaveLength(44);
  expect(rows.at(-1).id).toBe('0044_partner_repository_support');
  expect(await migrateApplication(f.target, partnerRepositorySources().sources)).toBe(0);
});
it('forces RLS on the receipt table and provisions only restricted purpose roles', async () => {
  const table = (
    await f.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='partners.allocation_receipts'::regclass",
    )
  ).rows[0];
  expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const roles = (
    await f.admin.query(
      'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1)',
      [partnerRepositoryRoles],
    )
  ).rows;
  expect(roles).toHaveLength(4);
  for (const r of roles)
    expect(Object.values(r).slice(1)).toEqual([false, false, false, false, false, false]);
});
it('uses the organization keyset index for a bounded query over 10000 synthetic locations', async () => {
  const org = await seed.company(),
    repo = createPartnerTenantRepository(reader);
  await f.admin.query(
    "INSERT INTO partners.locations(org_id,location_key,market,region_key,approved_address) SELECT $1,'bounded-'||g,'US','SYNTHETIC','{}' FROM generate_series(1,10000) g",
    [org.id],
  );
  await f.admin.query('ANALYZE partners.locations');
  const result = await value(reader, async (t) => {
    await repo.organization(t, scope(org));
    return reader.query(
      t,
      'EXPLAIN(ANALYZE,FORMAT JSON) SELECT id,market,region_key,status FROM partners.locations WHERE org_id=$1 ORDER BY id LIMIT 11',
      [org.id],
    );
  });
  const explain = (
      result.rows[0]!['QUERY PLAN'] as {
        Plan: { 'Actual Rows': number };
        'Execution Time': number;
      }[]
    )[0]!,
    planText = JSON.stringify(explain);
  expect(planText).toContain('locations_org_id_id_key');
  expect(explain.Plan['Actual Rows']).toBe(11);
  console.log(
    'P2_PARTNER_REPOSITORY_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        migrations: 44,
        purposeRoles: 4,
        syntheticLocations: 10000,
        boundedReturned: 11,
        organizationKeysetIndexed: true,
        executionMs: explain['Execution Time'],
        productionWiring: false,
        actualS1Approval: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
it('denies foreign and revoked actors, including after a pooled connection is reused', async () => {
  const a = await seed.company(),
    b = await seed.company(),
    repo = createPartnerTenantRepository(reader);
  expect(
    await value(reader, (t) => repo.organization(t, { ...scope(a), actor: b.actor })),
  ).toBeNull();
  expect(await value(reader, (t) => repo.organization(t, scope(a)))).toMatchObject({ id: a.id });
  await f.admin.query("UPDATE partners.memberships SET status='revoked' WHERE org_id=$1", [a.id]);
  expect(await value(reader, (t) => repo.organization(t, scope(a)))).toBeNull();
  expect(await value(reader, (t) => repo.organization(t, scope(b)))).toMatchObject({ id: b.id });
  const raw = await value(reader, (t) =>
    reader.query(
      t,
      "SELECT current_setting('tt.p2_org',true) AS org, current_setting('tt.p2_actor',true) AS actor",
    ),
  );
  expect(raw.rows[0]).toEqual({ org: '', actor: '' });
});
it('returns only the current member role and exact revision', async () => {
  const a = await seed.company(),
    repo = createPartnerTenantRepository(reader);
  await f.admin.query('UPDATE partners.memberships SET revision=9007199254740993 WHERE org_id=$1', [
    a.id,
  ]);
  expect(await value(reader, (t) => repo.membership(t, scope(a)))).toEqual({
    role: 'owner',
    revision: 9007199254740993n,
  });
  expect(
    await value(reader, (t) => repo.membership(t, { ...scope(a), actor: 'absent' })),
  ).toBeNull();
});
it('paginates scoped locations and refuses a cursor from another organization', async () => {
  const a = await seed.company(),
    b = await seed.company(),
    repo = createPartnerTenantRepository(reader);
  for (let i = 0; i < 3; i++)
    await f.admin.query(
      "INSERT INTO partners.locations(org_id,location_key,market,region_key,approved_address,status) VALUES($1,$2,'US','SYNTHETIC','{}','pending')",
      [a.id, 'extra' + i],
    );
  const first = await value(reader, (t) => repo.locations(t, scope(a), page(2))),
    second = await value(reader, (t) => repo.locations(t, scope(a), page(2, first.next)));
  expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(4);
  expect(second.next).toBeNull();
  expect(await run(reader, (t) => repo.locations(t, scope(b), page(2, first.next)))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it('persists reviewed immutable offer versions with a CAS pointer through the writer role', async () => {
  const org = await seed.company(),
    repo = createPartnerOfferRepository(writer),
    offerId = uuid('partner_offer', randomUUID()),
    from = new Date(Date.now() - 86400000).toISOString() as Instant,
    until = new Date(Date.now() + 7 * 86400000).toISOString() as Instant;
  const draft: OfferDraft = {
    organizationId: uuid('organization', org.id),
    offerId,
    version: 1,
    supersedesVersion: null,
    title: 'Typed offer',
    description: 'Synthetic persistence only',
    terms: { scope: 'local' },
    discount: { kind: 'percent_off', basisPoints: 1500 },
    minimumTires: 1,
    minimumPurchase: null,
    redemptionMethod: 'in_store_code',
    redemptionDomain: null,
    redemptionUrl: null,
    logoAssetId: null,
    logoRightsWarranted: false,
    validFrom: from,
    validUntil: until,
    createdBy: uuid('staff', f.staff),
  };
  const created = await value(writer, (t) => repo.appendDraft(t, draft));
  expect(created).toMatchObject({
    status: 'draft',
    discount: { kind: 'percent_off', basisPoints: 1500 },
  });
  await value(writer, (t) =>
    repo.addTargets(t, draft.organizationId, offerId, 1, [
      {
        id: uuid('offer_target', randomUUID()),
        market: 'US',
        strategy: 'store_wide',
        skuId: null,
        modelId: null,
        brandId: null,
        locationId: null,
        value: null,
        rimInches: null,
        radiusKm: null,
        rule: {},
      },
    ]),
  );
  await value(writer, (t) =>
    repo.recordReview(t, draft.organizationId, offerId, 1, uuid('staff', seed.reviewer)),
  );
  await value(writer, (t) => repo.selectPublished(t, draft.organizationId, offerId, 1, null));
  const read = createPartnerOfferRepository(reader);
  expect(await value(reader, (t) => read.version(t, scope(org), offerId, 1))).toMatchObject({
    status: 'published',
  });
  expect(
    await run(writer, (t) => repo.selectPublished(t, draft.organizationId, offerId, 1, null)),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    await run(writer, (t) =>
      repo.recordReview(t, draft.organizationId, offerId, 1, uuid('staff', seed.reviewer)),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  await value(writer, (t) =>
    repo.appendDraft(t, {
      ...draft,
      version: 2,
      supersedesVersion: 1,
      title: 'Second immutable version',
    }),
  );
  const versions = await value(reader, (t) => read.versions(t, scope(org), offerId, null, 1));
  expect(versions.map((x) => x.version)).toEqual([2]);
  expect(
    (await value(reader, (t) => read.versions(t, scope(org), offerId, 2, 2))).map((x) => x.version),
  ).toEqual([1]);
});
it.each(['unique', 'generated', 'shared'] as const)(
  'reserves %s code, counters, usage and frozen selection in one transaction',
  async (mode) => {
    const p = await plan(await seed.offer(await seed.company(), { mode })),
      repo = allocations();
    const a = await value(allocation, (t) => repo.reserve(t, p.input));
    expect(a).toMatchObject({ mode, state: 'reserved', codeId: p.code });
    expect(
      (
        await f.admin.query(
          'SELECT consumed_units::text FROM partners.offer_cap_windows WHERE id=$1',
          [p.cap],
        )
      ).rows[0].consumed_units,
    ).toBe('1');
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int AS n FROM partners.frequency_reservations WHERE send_id=$1',
          [p.message.id],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await f.admin.query('SELECT outcome FROM partners.offer_decisions WHERE send_id=$1', [
          p.message.id,
        ])
      ).rows,
    ).toEqual([{ outcome: 'selected' }]);
    expect(
      await value(allocation, (t) =>
        repo.reserve(t, {
          ...p.input,
          frequencies: [...p.input.frequencies].reverse(),
          caps: [...p.input.caps].reverse(),
        }),
      ),
    ).toEqual(a);
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int AS n FROM partners.allocation_receipts WHERE reservation_id=$1',
          [a.id],
        )
      ).rows[0].n,
    ).toBe(1);
  },
);
it('conflicts on a changed command under the same idempotency key without a second hold', async () => {
  const p = await plan(),
    repo = allocations();
  await value(allocation, (t) => repo.reserve(t, p.input));
  expect(await run(allocation, (t) => repo.reserve(t, { ...p.input, slot: 2 }))).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(1);
});
it.each([
  'closed_send',
  'wrong_owner',
  'withdrawn_company',
  'retired_pool',
  'stale_version',
  'missing_cap',
] as const)('rolls back %s admission without reserving a code or quota', async (kind) => {
  const p = await plan(),
    repo = allocations();
  let input = p.input;
  if (kind === 'closed_send')
    await f.admin.query("UPDATE email.email_sends SET dispatch_state='cancelled' WHERE id=$1", [
      p.message.id,
    ]);
  if (kind === 'wrong_owner') input = { ...input, subjectId: uuid('subject', randomUUID()) };
  if (kind === 'withdrawn_company')
    await f.admin.query("UPDATE partners.organizations SET status='suspended' WHERE id=$1", [
      p.offer.org.id,
    ]);
  if (kind === 'retired_pool')
    await f.admin.query("UPDATE partners.coupon_pools SET state='quarantined' WHERE id=$1", [
      p.offer.pool,
    ]);
  if (kind === 'stale_version') input = { ...input, version: 2 };
  if (kind === 'missing_cap')
    input = { ...input, caps: [{ id: uuid('offer_cap', randomUUID()), units: 1n }] };
  const result = await run(allocation, (t) => repo.reserve(t, input));
  expect(result.ok).toBe(false);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await f.admin.query('SELECT id FROM partners.coupon_reservations WHERE send_id=$1', [
        p.message.id,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM partners.coupon_codes WHERE id=$1 AND state='available'",
        [p.code],
      )
    ).rowCount,
  ).toBe(1);
});
it('only one contender gets the last exclusive code and the loser leaves no partial rows', async () => {
  const p = await plan(),
    other = await seed.send(),
    repo = allocations();
  const commands = [
    p.input,
    {
      ...p.input,
      requestKey: randomUUID(),
      sendId: uuid('send', other.id),
      subjectId: uuid('subject', other.subject),
    },
  ];
  const results = await Promise.all(
    commands.map((i) => run(allocation, (t) => repo.reserve(t, i))),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int AS n FROM partners.coupon_reservations WHERE pool_id=$1',
        [p.offer.pool],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('counts an issued per-offer use 29.5 days ago instead of resetting the rolling quota to a narrower caller window', async () => {
  const p = await plan(),
    repo = allocations(),
    old = await seed.send({ id: p.message.contact, subjectId: p.message.subject });
  await f.admin.query(
    'INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,$2,$3)',
    [p.message.subject, 'offer:' + p.offer.id, p.input.policyVersion],
  );
  await f.admin.query(
    "INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,reserved_at,window_start,window_end,window_kind,policy_version,state) VALUES($1,$2,$3,now()-interval '29 days 12 hours',now()-interval '30 days',now(),'rolling_30_days',$4,'issued')",
    [p.message.subject, 'offer:' + p.offer.id, old.id, p.input.policyVersion],
  );
  expect(await run(allocation, (t) => repo.reserve(t, p.input))).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('only one contender consumes the final cap unit even when distinct codes are available', async () => {
  const p = await plan(undefined, undefined, { limit: 1 }),
    other = await seed.send(),
    repo = allocations();
  await seed.code(p.offer);
  const results = await Promise.all(
    [
      p.input,
      {
        ...p.input,
        requestKey: randomUUID(),
        sendId: uuid('send', other.id),
        subjectId: uuid('subject', other.subject),
      },
    ].map((i) => run(allocation, (t) => repo.reserve(t, i))),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('shares overall notification usage across organizations while preserving per-offer usage', async () => {
  const first = await plan(),
    secondOffer = await seed.offer(await seed.company()),
    second = await plan(secondOffer, first.message),
    repo = allocations();
  second.input = { ...second.input, slot: 2 };
  const a = await value(allocation, (t) => repo.reserve(t, first.input)),
    b = await value(allocation, (t) => repo.reserve(t, second.input));
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int AS n FROM partners.frequency_reservations WHERE send_id=$1 AND scope_key='overall_marketing'",
        [first.message.id],
      )
    ).rows[0].n,
  ).toBe(1);
  const e = uuid('audit_event', await seed.evidence());
  await value(allocation, (t) =>
    repo.release(t, a.organizationId, a.id, 'cancelled_before_dispatch', e),
  );
  expect(
    (
      await f.admin.query(
        "SELECT state FROM partners.frequency_reservations WHERE send_id=$1 AND scope_key='overall_marketing'",
        [first.message.id],
      )
    ).rows[0].state,
  ).toBe('reserved');
  await value(allocation, (t) =>
    repo.release(t, b.organizationId, b.id, 'cancelled_before_dispatch', e),
  );
  expect(
    (
      await f.admin.query(
        "SELECT state FROM partners.frequency_reservations WHERE send_id=$1 AND scope_key='overall_marketing'",
        [first.message.id],
      )
    ).rows[0].state,
  ).toBe('released');
});
it('keeps uncertainty reserved until definitive non-use evidence and releases counters exactly once', async () => {
  const p = await plan(),
    repo = allocations(),
    a = await value(allocation, (t) => repo.reserve(t, p.input));
  await value(allocation, (t) => repo.recordOutcome(t, a.organizationId, a.id, 'uncertain'));
  const e = uuid('audit_event', await seed.evidence());
  expect(
    await run(allocation, (t) => repo.release(t, a.organizationId, a.id, 'expired_unstarted', e)),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  const released = await value(allocation, (t) =>
    repo.release(t, a.organizationId, a.id, 'definitively_not_sent', e),
  );
  expect(released.state).toBe('released');
  expect(
    await value(allocation, (t) =>
      repo.release(t, a.organizationId, a.id, 'definitively_not_sent', e),
    ),
  ).toEqual(released);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (await f.admin.query('SELECT state FROM partners.coupon_codes WHERE id=$1', [p.code])).rows[0]
      .state,
  ).toBe('available');
  expect(await value(allocation, (t) => repo.reserve(t, p.input))).toEqual(released);
});
it('poisons the whole transaction if a caller catches a later mutation failure', async () => {
  const p = await plan(),
    repo = allocations();
  const result = await allocation.unitOfWork.run(async (t) => {
    await repo.reserve(t, p.input);
    try {
      await repo.reserve(t, { ...p.input, slot: 2 });
    } catch {
      /* Must not allow a partial commit. */
    }
    return ok(true);
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    (
      await f.admin.query('SELECT id FROM partners.coupon_reservations WHERE send_id=$1', [
        p.message.id,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('appends idempotent reported redemption and correction ledgers without mutating history', async () => {
  const p = await plan(),
    repo = allocations(),
    a = await value(allocation, (t) => repo.reserve(t, p.input));
  await value(allocation, (t) => repo.recordOutcome(t, a.organizationId, a.id, 'issued'));
  const event = {
    organizationId: a.organizationId,
    assignmentId: a.id,
    eventKey: randomUUID(),
    kind: 'reported' as const,
    quantity: 2,
    previousId: null,
    occurredAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 123).toISOString() as Instant,
  };
  const first = await value(allocation, (t) => repo.appendRedemption(t, event));
  expect(await value(allocation, (t) => repo.appendRedemption(t, event))).toBe(first);
  expect(
    await run(allocation, (t) => repo.appendRedemption(t, { ...event, quantity: 3 })),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  await value(allocation, (t) =>
    repo.appendRedemption(t, {
      ...event,
      eventKey: randomUUID(),
      kind: 'reversal',
      quantity: -2,
      previousId: first,
    }),
  );
  expect(
    (
      await f.admin.query(
        'SELECT sum(quantity_delta)::int AS n,bool_or(verified_sale) AS verified FROM partners.redemption_events WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0],
  ).toEqual({ n: 0, verified: false });
  expect(
    await run(allocation, (t) =>
      repo.appendRedemption(t, {
        ...event,
        eventKey: randomUUID(),
        kind: 'correction',
        quantity: 1,
        previousId: first,
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('never attributes individual reported redemptions to a shared code', async () => {
  const p = await plan(await seed.offer(await seed.company(), { mode: 'shared' })),
    repo = allocations(),
    a = await value(allocation, (t) => repo.reserve(t, p.input));
  expect(
    await run(allocation, (t) =>
      repo.appendRedemption(t, {
        organizationId: a.organizationId,
        assignmentId: a.id,
        eventKey: randomUUID(),
        kind: 'reported',
        quantity: 1,
        previousId: null,
        occurredAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 123).toISOString() as Instant,
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('masks pilot counts and reviewed visitor/redemption aggregates without private identifiers', async () => {
  const org = await seed.company(),
    reporting = createPartnerReportingRepository(reader);
  await seed.offer(org);
  await f.admin.query(
    "INSERT INTO partners.insight_heads(org_id,revision,state) VALUES($1,1,'ready')",
    [org.id],
  );
  for (const [metric, sample, status] of [
    ['clicks', 10, 'reviewed'],
    ['reported_redemptions', 10, 'reviewed'],
    ['included', 9, 'reviewed'],
    ['complaints', 10, 'pending'],
  ] as const)
    await f.admin.query(
      "INSERT INTO partners.daily_metrics(org_id,generation,day,metric,market,total_count,sample_size,minimum_cohort,status,reviewed_by,reviewed_at) VALUES($1,1,current_date,$2,'US',9007199254740993,$3,10,$4,$5,clock_timestamp())",
      [org.id, metric, sample, status, seed.reviewer],
    );
  const summary = await value(reader, (t) => reporting.pilot(t, scope(org)));
  expect(summary).toMatchObject({
    approvedLocations: 1n,
    activeOffers: 1n,
    acceptedAgreements: 3n,
  });
  const today = new Date().toISOString().slice(0, 10),
    query = { from: today, through: today, metric: 'clicks' as const, after: null, limit: 10 };
  const clicks = await value(reader, (t) => reporting.metrics(t, scope(org), query));
  expect(clicks.items).toEqual([
    { day: today, metric: 'clicks', market: 'US', count: 9007199254740993n },
  ]);
  expect(
    (await value(reader, (t) => reporting.metrics(t, scope(org), { ...query, metric: 'included' })))
      .items,
  ).toEqual([]);
  expect(
    (
      await value(reader, (t) =>
        reporting.metrics(t, scope(org), { ...query, metric: 'complaints' }),
      )
    ).items,
  ).toEqual([]);
  expect(
    (
      await value(reader, (t) =>
        reporting.metrics(t, scope(org), { ...query, metric: 'reported_redemptions' }),
      )
    ).items,
  ).toHaveLength(1);
  expect(Object.keys(clicks.items[0]!).sort()).toEqual(['count', 'day', 'market', 'metric']);
  await f.admin.query("UPDATE partners.insight_heads SET state='dirty' WHERE org_id=$1", [org.id]);
  expect((await value(reader, (t) => reporting.metrics(t, scope(org), query))).items).toEqual([]);
});
it.each([
  'privacy.contacts',
  'email.email_sends',
  'partners.coupon_codes',
  'partners.coupon_reservations',
  'partners.frequency_reservations',
  'partners.daily_metrics',
])('denies the pilot reader raw access to %s', async (table) => {
  expect(await run(reader, (t) => reader.query(t, `SELECT * FROM ${table} LIMIT 1`))).toMatchObject(
    { ok: false },
  );
});
it('keeps writer and allocation credentials out of each other and rejects forged or expired transaction contexts', async () => {
  expect(
    await run(writer, (t) => writer.query(t, 'SELECT * FROM partners.coupon_codes LIMIT 1')),
  ).toMatchObject({ ok: false });
  expect(
    await run(allocation, (t) => allocation.query(t, 'SELECT * FROM privacy.contacts LIMIT 1')),
  ).toMatchObject({ ok: false });
  const org = await seed.company(),
    repo = createPartnerTenantRepository(reader);
  let expired: Tx | undefined;
  await value(reader, async (t) => {
    expired = t;
    return true;
  });
  await expect(repo.organization({} as Tx, scope(org))).rejects.toMatchObject({
    failure: { code: 'transaction_context' },
  });
  await expect(repo.organization(expired!, scope(org))).rejects.toMatchObject({
    failure: { code: 'transaction_context' },
  });
});
function revisionValue(n: bigint) {
  const r = revision(n.toString());
  if (!r.ok) throw Error('fixed revision');
  return r.value;
}
it('atomically registers a pending tenant and owner and refuses stale identity edits', async () => {
  const admin = f.adapter('tt_p2_identity_writer'),
    repo = createPartnerIdentityRepository(admin),
    org = uuid('organization', randomUUID()),
    actor = 'synthetic:' + randomUUID();
  const created = await value(admin, (t) =>
    repo.registerPending(t, {
      id: org,
      legalName: 'Synthetic registered',
      market: 'US',
      owner: actor,
    }),
  );
  expect(created).toMatchObject({
    id: org,
    status: 'pending',
    verification: 'pending',
    revision: 1n,
  });
  expect(
    await value(reader, (t) =>
      createPartnerTenantRepository(reader).organization(t, { organizationId: org, actor }),
    ),
  ).toBeNull();
  expect(
    await value(admin, (t) =>
      repo.reviseMembership(t, {
        organizationId: org,
        actor,
        expectedRevision: revisionValue(1n),
        role: 'owner',
        status: 'active',
      }),
    ),
  ).toBe(2n);
  const input = {
    id: org,
    expectedRevision: revisionValue(1n),
    legalName: 'Synthetic revised',
    status: 'active' as const,
    verification: 'verified' as const,
  };
  expect(await value(admin, (t) => repo.reviseOrganization(t, input))).toMatchObject({
    revision: 2n,
    status: 'active',
  });
  expect(await run(admin, (t) => repo.reviseOrganization(t, input))).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(
    await run(admin, (t) =>
      repo.reviseMembership(t, {
        organizationId: org,
        actor,
        expectedRevision: revisionValue(1n),
        role: 'analyst',
        status: 'active',
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    await run(admin, (t) => admin.query(t, 'SELECT * FROM partners.coupon_codes LIMIT 1')),
  ).toMatchObject({ ok: false });
  expect(
    await run(reader, (t) =>
      createPartnerIdentityRepository(reader).registerPending(t, {
        id: uuid('organization', randomUUID()),
        legalName: 'Forbidden',
        market: 'US',
        owner: actor,
      }),
    ),
  ).toMatchObject({ ok: false });
});
it('rolls back pending organization creation when its owner insert fails', async () => {
  const admin = f.adapter('tt_p2_identity_writer'),
    repo = createPartnerIdentityRepository(admin),
    org = uuid('organization', randomUUID());
  // The first statement succeeds; an explicit later transaction failure must undo it.
  const result = await admin.unitOfWork.run(async (t) => {
    await repo.registerPending(t, {
      id: org,
      legalName: 'Rollback',
      market: 'US',
      owner: 'synthetic:rollback',
    });
    try {
      await repo.reviseOrganization(t, {
        id: org,
        expectedRevision: revisionValue(2n),
        legalName: 'Conflict',
        status: 'pending',
        verification: 'pending',
      });
    } catch {
      /* poisoned */
    }
    return ok(true);
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    (await f.admin.query('SELECT id FROM partners.organizations WHERE id=$1', [org])).rowCount,
  ).toBe(0);
});
it('pins aggregate pagination to organization, actor, filters and a ready generation', async () => {
  const a = await seed.company(),
    b = await seed.company(),
    repo = createPartnerReportingRepository(reader);
  await f.admin.query(
    "INSERT INTO partners.insight_heads(org_id,revision,state) VALUES($1,1,'ready')",
    [a.id],
  );
  await f.admin.query(
    "INSERT INTO partners.daily_metrics(org_id,generation,day,metric,market,total_count,sample_size,minimum_cohort,status,reviewed_by,reviewed_at) SELECT $1,1,current_date-i,'clicks','US',i+10,10,10,'reviewed',$2,clock_timestamp() FROM generate_series(0,2) i",
    [a.id, seed.reviewer],
  );
  const through = new Date().toISOString().slice(0, 10),
    from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    query = { from, through, metric: 'clicks' as const, after: null, limit: 2 };
  const first = await value(reader, (t) => repo.metrics(t, scope(a), query));
  expect(first.items).toHaveLength(2);
  expect(first.next).not.toBeNull();
  const second = await value(reader, (t) =>
    repo.metrics(t, scope(a), { ...query, after: first.next }),
  );
  expect(second.items).toHaveLength(1);
  expect(second.next).toBeNull();
  expect(new Set([...first.items, ...second.items].map((x) => x.day)).size).toBe(3);
  for (const [actorScope, filters] of [
    [scope(b), query],
    [scope(a), { ...query, metric: 'included' as const }],
  ] as const)
    expect(
      await run(reader, (t) => repo.metrics(t, actorScope, { ...filters, after: first.next })),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  await f.admin.query("UPDATE partners.insight_heads SET state='dirty' WHERE org_id=$1", [a.id]);
  expect(
    await run(reader, (t) => repo.metrics(t, scope(a), { ...query, after: first.next })),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  await f.admin.query(
    "UPDATE partners.insight_heads SET state='ready',revision=2 WHERE org_id=$1",
    [a.id],
  );
  expect(
    await run(reader, (t) => repo.metrics(t, scope(a), { ...query, after: first.next })),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('returns only masked dispute columns and refuses cross-tenant dispute cursors', async () => {
  const a = await seed.company(),
    b = await seed.company(),
    repo = createPartnerReportingRepository(reader);
  const offer = await seed.offer(a),
    message = await seed.send(),
    reservation = await seed.directReservation(offer, message, await seed.code(offer));
  await f.admin.query(
    "INSERT INTO partners.disputes(org_id,reservation_id,reason_code,encrypted_details,key_version) SELECT $1,$2,'other',decode(repeat('ab',32),'hex'),'synthetic-v1' FROM generate_series(1,3)",
    [a.id, reservation],
  );
  const first = await value(reader, (t) => repo.disputes(t, scope(a), page(2))),
    second = await value(reader, (t) => repo.disputes(t, scope(a), page(2, first.next)));
  expect(first.items).toHaveLength(2);
  expect(second.items).toHaveLength(1);
  expect(Object.keys(first.items[0]!).sort()).toEqual([
    'closedAt',
    'createdAt',
    'id',
    'reason',
    'state',
  ]);
  expect(await run(reader, (t) => repo.disputes(t, scope(b), page(2, first.next)))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  await f.admin.query("UPDATE partners.memberships SET status='revoked' WHERE org_id=$1", [a.id]);
  expect((await value(reader, (t) => repo.disputes(t, scope(a), page(2)))).items).toEqual([]);
});
it.each(['missing_code', 'exhausted_second_cap', 'changed_frequency_policy'] as const)(
  'leaves no quota or receipt after %s',
  async (kind) => {
    const p = await plan(undefined, undefined, { code: kind !== 'missing_code' }),
      repo = allocations();
    let input = p.input;
    if (kind === 'exhausted_second_cap') {
      const cap = randomUUID();
      await f.admin.query(
        "INSERT INTO partners.offer_cap_windows(id,org_id,offer_id,kind,policy_version,window_start,window_end,limit_units,consumed_units) VALUES($1,$2,$3,'day',$4,now()-interval '1 hour',now()+interval '1 hour',1,1)",
        [cap, p.offer.org.id, p.offer.id, p.input.policyVersion],
      );
      input = { ...input, caps: [...input.caps, { id: uuid('offer_cap', cap), units: 1n }] };
    }
    if (kind === 'changed_frequency_policy')
      await f.admin.query(
        "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,'overall_marketing','previous-policy')",
        [p.message.subject],
      );
    expect(await run(allocation, (t) => repo.reserve(t, input))).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(
      (
        await f.admin.query(
          'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
          [p.cap],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.admin.query(
          'SELECT request_key FROM partners.allocation_receipts WHERE org_id=$1',
          [p.offer.org.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.admin.query('SELECT id FROM partners.frequency_reservations WHERE send_id=$1', [
          p.message.id,
        ])
      ).rowCount,
    ).toBe(0);
  },
);
it('serializes per-offer frequency contention on the same subject across different sends', async () => {
  const p = await plan(),
    other = await seed.send({ id: p.message.contact, subjectId: p.message.subject }),
    repo = allocations();
  await seed.code(p.offer);
  const results = await Promise.all(
    [p.input, { ...p.input, requestKey: randomUUID(), sendId: uuid('send', other.id) }].map(
      (input) => run(allocation, (t) => repo.reserve(t, input)),
    ),
  );
  expect(results.filter((x) => x.ok)).toHaveLength(1);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
        [p.cap],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('retains issued frequency usage through uncertain reconciliation and definitive release', async () => {
  const p = await plan(),
    repo = allocations(),
    a = await value(allocation, (t) => repo.reserve(t, p.input)),
    e = uuid('audit_event', await seed.evidence());
  await value(allocation, (t) => repo.recordOutcome(t, a.organizationId, a.id, 'issued'));
  expect(
    await run(allocation, (t) =>
      repo.release(t, a.organizationId, a.id, 'definitively_not_sent', e),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  await value(allocation, (t) => repo.recordOutcome(t, a.organizationId, a.id, 'uncertain'));
  await value(allocation, (t) =>
    repo.release(t, a.organizationId, a.id, 'definitively_not_sent', e),
  );
  expect(
    (
      await f.admin.query('SELECT state FROM partners.frequency_reservations WHERE send_id=$1', [
        p.message.id,
      ])
    ).rows.map((r) => r.state),
  ).toEqual(['issued', 'issued']);
});
it('keeps receipt, selection and redemption history immutable to the narrow allocation role', async () => {
  const p = await plan(),
    repo = allocations(),
    a = await value(allocation, (t) => repo.reserve(t, p.input));
  for (const sql of [
    "UPDATE partners.allocation_receipts SET request_key='overwrite' WHERE org_id=$1",
    'DELETE FROM partners.offer_decisions WHERE org_id=$1',
    'UPDATE partners.redemption_events SET quantity_delta=1 WHERE org_id=$1',
  ])
    expect(
      await run(allocation, (t) => allocation.query(t, sql, [a.organizationId])),
    ).toMatchObject({ ok: false });
  expect(
    await value(allocation, (t) => repo.assignment(t, uuid('organization', randomUUID()), a.id)),
  ).toBeNull();
});
it('refuses a cap that expires while an allocator is waiting for its row lock', async () => {
  const p = await plan(undefined, undefined, { endSeconds: 2 }),
    repo = allocations(),
    held = new pg.Client({ connectionString: f.target.url });
  await held.connect();
  try {
    await held.query('BEGIN');
    await held.query('SELECT id FROM partners.offer_cap_windows WHERE id=$1 FOR UPDATE', [p.cap]);
    const pending = run(allocation, (t) => repo.reserve(t, p.input));
    let observed = false;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (await f.waitingAllocators()) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(observed).toBe(true);
    await held.query(
      'SELECT pg_sleep(greatest(0,extract(epoch FROM(window_end-clock_timestamp())))+0.05) FROM partners.offer_cap_windows WHERE id=$1',
      [p.cap],
    );
    await held.query('COMMIT');
    expect(await pending).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(
      (
        await f.admin.query(
          'SELECT consumed_units::int AS n FROM partners.offer_cap_windows WHERE id=$1',
          [p.cap],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await held.query('ROLLBACK');
    await held.end();
  }
});
