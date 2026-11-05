import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { partnerFixture, partnerRoles, partnerSources } from '../fixtures/phase2/partners.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';

let fixture: Awaited<ReturnType<typeof partnerFixture>>;
let tenant: pg.Client, worker: pg.Client, competitor: pg.Client;
const reviewer = randomUUID();
beforeAll(async () => {
  fixture = await partnerFixture();
  tenant = await fixture.connect('tt_p2_partner_runtime');
  worker = await fixture.connect('tt_p2_worker_runtime');
  competitor = await fixture.connect('tt_p2_worker_runtime');
  await fixture.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
    [reviewer, 'p2-synthetic-reviewer:' + reviewer],
  );
}, 30000);
afterAll(async () => {
  await fixture?.cleanup();
});

it('P2-PR-002 installs the opt-in organization schema on an existing populated P1 database', async () => {
  const observed = await fixture.admin.query(
    "SELECT to_regclass('partners.organizations')::text AS relation",
  );
  expect(observed.rows[0]?.relation).toBe('partners.organizations');
  expect(fixture.applied).toBe(3);
  expect(fixture.after).toEqual(fixture.before);
  expect(fixture.afterPermissions).toEqual(fixture.beforePermissions);
  expect(fixture.before).toHaveLength(141);
  expect(fixture.beforeHistory).toHaveLength(33);
  const history = (
    await fixture.admin.query(
      'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position',
    )
  ).rows;
  expect(history.slice(0, 33)).toEqual(fixture.beforeHistory);
  expect(history.slice(33).map((r) => r.id)).toEqual(
    partnerSources().manifest.migrations.map((m) => m.id),
  );
  expect(await fixture.install()).toBe(0);
});

type Company = { id: string; actor: string; location: string };
type Mode = 'shared' | 'unique' | 'generated';
type Offer = { org: Company; id: string; pool: string; mode: Mode; version: number };
type Send = { id: string; subject: string; contact: string };
async function company(ready = true): Promise<Company> {
  const org = { id: randomUUID(), actor: 'p2-actor:' + randomUUID(), location: randomUUID() };
  await fixture.admin.query(
    "INSERT INTO partners.organizations(id,legal_name,market) VALUES($1,$2,'US')",
    [org.id, 'Synthetic P2 ' + org.id],
  );
  await fixture.admin.query(
    "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,$2,'owner','active')",
    [org.id, org.actor],
  );
  await fixture.admin.query(
    "INSERT INTO partners.locations(id,org_id,location_key,market,region_key,approved_address,status) VALUES($1,$2,'primary','US','SYNTHETIC','{}','approved')",
    [org.location, org.id],
  );
  if (ready) {
    for (const kind of ['pilot_terms', 'privacy', 'dpa']) {
      const asset = await fixture.asset('agreement');
      await fixture.admin.query(
        "INSERT INTO partners.organization_assets(org_id,asset_id,purpose,state) VALUES($1,$2,'agreement','ready')",
        [org.id, asset.id],
      );
      await fixture.admin.query(
        "INSERT INTO partners.agreements(org_id,kind,version,asset_id,accepted_by,accepted_at,expires_at) VALUES($1,$2,'local-v1',$3,$4,now(),now()+interval '90 days')",
        [org.id, kind, asset.id, org.actor],
      );
    }
    await fixture.admin.query(
      "UPDATE partners.organizations SET status='active',verification_status='verified' WHERE id=$1",
      [org.id],
    );
  }
  return org;
}
async function offer(
  org: Company,
  options: { mode?: Mode; published?: boolean; link?: boolean } = {},
): Promise<Offer> {
  const result = {
    org,
    id: randomUUID(),
    pool: randomUUID(),
    mode: options.mode ?? 'unique',
    version: 1,
  };
  let domain: string | null = null;
  if (options.link) {
    domain = 'synthetic-' + randomUUID() + '.invalid';
    await fixture.admin.query(
      "INSERT INTO partners.organization_domains(org_id,domain,status,reviewed_by,reviewed_at,expires_at) VALUES($1,$2,'verified',$3,now(),now()+interval '30 days')",
      [org.id, domain, reviewer],
    );
  }
  await fixture.admin.query('INSERT INTO partners.offers(id,org_id) VALUES($1,$2)', [
    result.id,
    org.id,
  ]);
  await fixture.admin.query(
    `INSERT INTO partners.offer_versions(org_id,offer_id,version,title,description,terms,discount_type,percent_basis_points,redemption_method,redemption_domain,redemption_url,valid_from,valid_until,created_by)
    VALUES($1,$2,1,'Synthetic reviewed offer','Synthetic terms only','{}','percent_off',1000,$3,$4,$5,now()-interval '1 day',now()+interval '7 days',$6)`,
    [
      org.id,
      result.id,
      domain ? 'link' : 'in_store_code',
      domain,
      domain ? 'https://' + domain + '/offer' : null,
      fixture.staff,
    ],
  );
  await fixture.admin.query(
    "INSERT INTO partners.offer_targets(org_id,offer_id,offer_version,market,strategy) VALUES($1,$2,1,'US','store_wide')",
    [org.id, result.id],
  );
  if (options.published !== false) {
    await fixture.admin.query(
      "UPDATE partners.offer_versions SET status='reviewed',reviewed_by=$3,reviewed_at=now() WHERE org_id=$1 AND offer_id=$2",
      [org.id, result.id, reviewer],
    );
    await fixture.admin.query(
      "UPDATE partners.offer_versions SET status='published' WHERE org_id=$1 AND offer_id=$2",
      [org.id, result.id],
    );
    await fixture.admin.query(
      "UPDATE partners.offers SET current_version=1,status='active' WHERE org_id=$1 AND id=$2",
      [org.id, result.id],
    );
  }
  await fixture.admin.query(
    `INSERT INTO partners.coupon_pools(id,org_id,offer_id,offer_version,mode,state,generated_prefix,shared_code_hmac,encrypted_shared_code,key_version)
    VALUES($1,$2,$3,1,$4,'ready',$5,$6,$7,$8)`,
    [
      result.pool,
      org.id,
      result.id,
      result.mode,
      result.mode === 'generated' ? 'SYNTHETIC' : null,
      result.mode === 'shared' ? randomBytes(32) : null,
      result.mode === 'shared' ? randomBytes(64) : null,
      result.mode === 'shared' ? 'synthetic-v1' : null,
    ],
  );
  return result;
}
async function code(value: Offer) {
  const id = randomUUID();
  await fixture.admin.query(
    `INSERT INTO partners.coupon_codes(id,org_id,pool_id,pool_mode,code_hmac,encrypted_code,key_version,state,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'synthetic-v1','available',now()+interval '7 days')`,
    [id, value.org.id, value.pool, value.mode, randomBytes(32), randomBytes(64)],
  );
  return id;
}
async function send(person?: { id: string; subjectId: string }): Promise<Send> {
  const contact = person ?? (await fixture.contact()).value,
    id = randomUUID(),
    template = await fixture.template('offers');
  await fixture.admin.query(
    `INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,template_id,send_after,cancel_deadline,provider_key,provider,requested_purposes,dispatch_policy_version,authorized_consent_revision)
    VALUES($1,'offers',$2,$3,$4,now()+interval '120 seconds',now()+interval '60 seconds',$5,'synthetic','["offers"]','synthetic-v1',1)`,
    [id, contact.id, contact.subjectId, template, 'p2-synthetic:' + id],
  );
  return { id, subject: contact.subjectId, contact: contact.id };
}
async function reserve(
  value: Offer,
  message: Send,
  codeId: string | null,
  slot = 1,
  client = worker,
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO partners.coupon_reservations(id,org_id,send_id,owner_subject_id,offer_id,offer_version,pool_id,pool_mode,code_id,slot,policy_version)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'synthetic-v1')`,
    [id, value.org.id, message.id, message.subject, value.id, value.pool, value.mode, codeId, slot],
  );
  return id;
}
async function context<T>(org: Company, work: () => Promise<T>, actor = org.actor) {
  await tenant.query('BEGIN');
  try {
    await tenant.query("SELECT set_config('tt.p2_org',$1,true),set_config('tt.p2_actor',$2,true)", [
      org.id,
      actor,
    ]);
    return await work();
  } finally {
    await tenant.query('ROLLBACK');
  }
}
async function evidence() {
  const id = randomUUID();
  await fixture.admin.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'reconcile.non_use','coupon_assignment','approved',now(),$2,'[]')",
    [id, randomBytes(32).toString('hex')],
  );
  return id;
}

it('forces RLS on all 23 new tables and keeps actual runtime logins non-owning and nonprivileged', async () => {
  const tables = (
    await fixture.admin.query(
      "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='partners' AND c.relkind='r' ORDER BY c.relname",
    )
  ).rows;
  expect(tables.map((t) => 'partners.' + t.relname)).toEqual(
    [...partnerSources().manifest.tables].sort(),
  );
  expect(
    tables.every((t) => t.relrowsecurity && t.relforcerowsecurity && t.owner === 'tt_app_migrator'),
  ).toBe(true);
  const roles = (
    await tenant.query(
      'SELECT current_user AS actor,rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication FROM pg_roles WHERE rolname=ANY($1)',
      [partnerRoles],
    )
  ).rows;
  expect(roles).toHaveLength(3);
  expect(
    roles.every(
      (r) =>
        r.actor === 'tt_p2_partner_runtime' &&
        !r.rolsuper &&
        !r.rolcreatedb &&
        !r.rolcreaterole &&
        !r.rolinherit &&
        !r.rolbypassrls &&
        !r.rolreplication,
    ),
  ).toBe(true);
});
it('denies missing/foreign context, uses current membership and clears transaction-local context', async () => {
  const a = await company(),
    b = await company();
  expect((await tenant.query('SELECT id FROM partners.organizations')).rows).toEqual([]);
  expect(
    await context(
      a,
      async () => (await tenant.query('SELECT id FROM partners.organizations')).rows,
    ),
  ).toEqual([{ id: a.id }]);
  expect(
    await context(
      b,
      async () => (await tenant.query('SELECT id FROM partners.organizations')).rows,
      a.actor,
    ),
  ).toEqual([]);
  await context(a, async () => {
    expect((await tenant.query('SELECT id FROM partners.organizations')).rowCount).toBe(1);
    await fixture.admin.query("UPDATE partners.memberships SET status='revoked' WHERE org_id=$1", [
      a.id,
    ]);
    expect((await tenant.query('SELECT id FROM partners.organizations')).rows).toEqual([]);
  });
  expect((await tenant.query('SELECT partners.current_org() AS org')).rows).toEqual([
    { org: null },
  ]);
});
it.each([
  'SELECT external_org_id FROM partners.organizations',
  'SELECT asset_id FROM partners.agreements',
  'SELECT encrypted_shared_code FROM partners.coupon_pools',
  'SELECT * FROM partners.coupon_codes',
  'SELECT * FROM partners.coupon_reservations',
  'SELECT * FROM partners.offer_decisions',
  'SELECT * FROM partners.frequency_guards',
  'SELECT * FROM partners.frequency_reservations',
  'SELECT * FROM partners.daily_metrics',
  'SELECT * FROM email.email_sends',
])('keeps private data unavailable to the tenant runtime: %s', async (sql) => {
  await expect(tenant.query(sql)).rejects.toMatchObject({ code: '42501' });
});
it('keeps existing P1 runtime roles out of the new schema', async () => {
  const url = fixture.connectionUrl('tt_private_runtime');
  const Pg = (await import('pg')).default;
  const client = new Pg.Client({ connectionString: url });
  await client.connect();
  try {
    await expect(client.query('SELECT id FROM partners.organizations')).rejects.toMatchObject({
      code: '42501',
    });
  } finally {
    await client.end();
  }
});

it('rejects cross-organization location, offer, asset and accepted-actor parents', async () => {
  const a = await company(),
    b = await company(),
    v = await offer(a, { published: false });
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.offer_targets(org_id,offer_id,offer_version,market,strategy,location_id) VALUES($1,$2,1,'US','store_wide',$3)",
      [a.id, v.id, b.location],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.coupon_pools(org_id,offer_id,offer_version,mode) VALUES($1,$2,1,'unique')",
      [b.id, v.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  const asset = (
    await fixture.admin.query('SELECT asset_id FROM partners.agreements WHERE org_id=$1 LIMIT 1', [
      b.id,
    ])
  ).rows[0]!.asset_id as string;
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.agreements(org_id,kind,version,asset_id,accepted_by,accepted_at) VALUES($1,'pilot_terms','foreign-asset',$2,$3,now())",
      [a.id, asset, a.actor],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  const owned = (
    await fixture.admin.query('SELECT asset_id FROM partners.agreements WHERE org_id=$1 LIMIT 1', [
      a.id,
    ])
  ).rows[0]!.asset_id as string;
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.agreements(org_id,kind,version,asset_id,accepted_by,accepted_at) VALUES($1,'pilot_terms','foreign-actor',$2,$3,now())",
      [a.id, owned, b.actor],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});
it('rejects wrong-purpose company assets and paid pilot agreements', async () => {
  const a = await company(),
    asset = await fixture.asset('report_pdf');
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.organization_assets(org_id,asset_id,purpose,state) VALUES($1,$2,'agreement','ready')",
      [a.id, asset.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query("UPDATE partners.agreements SET billing_mode='paid' WHERE org_id=$1", [
      a.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('supports all seven source discount types with typed values and no fabricated savings', async () => {
  const a = await company();
  for (const [kind, amount, percent, service, minimum] of [
    ['percent_off', null, 1000, null, 1],
    ['amount_off', 1000, null, null, 1],
    ['set_of_four_off', 1000, null, null, 4],
    ['buy_three_get_one', null, null, null, 4],
    ['free_service', null, null, 'fitting', 1],
    ['mail_in_rebate', 1000, null, null, 1],
    ['price_match', null, null, null, 1],
  ] as const) {
    const id = randomUUID();
    await fixture.admin.query('INSERT INTO partners.offers(id,org_id) VALUES($1,$2)', [id, a.id]);
    await fixture.admin.query(
      `INSERT INTO partners.offer_versions(org_id,offer_id,version,title,description,terms,discount_type,amount_minor,currency_code,percent_basis_points,service_code,minimum_tires,redemption_method,valid_from,valid_until,created_by)
      VALUES($1,$2,1,'Synthetic','Typed synthetic terms','{}',$3,$4,$5,$6,$7,$8,'in_store_code',now(),now()+interval '3 days',$9)`,
      [
        a.id,
        id,
        kind,
        amount,
        amount === null ? null : 'USD',
        percent,
        service,
        minimum,
        fixture.staff,
      ],
    );
  }
  expect(
    (
      await fixture.admin.query(
        'SELECT count(DISTINCT discount_type)::int AS n FROM partners.offer_versions WHERE org_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(7);
});
it('requires duration, distinct reviewer and reviewed immutable terms/targets/current pointer', async () => {
  const a = await company(),
    draft = await offer(a, { published: false });
  await expect(
    fixture.admin.query(
      "UPDATE partners.offer_versions SET valid_until=valid_from+interval '2 days' WHERE org_id=$1 AND offer_id=$2",
      [a.id, draft.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query(
      "UPDATE partners.offer_versions SET status='reviewed',reviewed_by=created_by,reviewed_at=now() WHERE org_id=$1 AND offer_id=$2",
      [a.id, draft.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query(
      "UPDATE partners.offers SET current_version=1,status='active' WHERE id=$1",
      [draft.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const live = await offer(a);
  await expect(
    fixture.admin.query(
      'UPDATE partners.offer_versions SET terms=\'{"changed":true}\' WHERE org_id=$1 AND offer_id=$2',
      [a.id, live.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.offer_targets(org_id,offer_id,offer_version,market,strategy) VALUES($1,$2,1,'US','store_wide')",
      [a.id, live.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query(
      "UPDATE partners.offer_versions SET status='retired' WHERE org_id=$1 AND offer_id=$2",
      [a.id, live.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('serializes target edits against concurrent review and publication through the parent version', async () => {
  const a = await company(),
    draft = await offer(a, { published: false }),
    editor = await fixture.connect('tt_p2_staff_runtime'),
    publisher = await fixture.connect('tt_p2_staff_runtime');
  try {
    await editor.query('BEGIN');
    await editor.query(
      'UPDATE partners.offer_targets SET rule=\'{"synthetic":"review-boundary"}\' WHERE org_id=$1 AND offer_id=$2',
      [a.id, draft.id],
    );
    await publisher.query('BEGIN');
    await publisher.query("SET LOCAL lock_timeout='200ms'");
    await expect(
      publisher.query(
        "UPDATE partners.offer_versions SET status='reviewed',reviewed_by=$3,reviewed_at=now() WHERE org_id=$1 AND offer_id=$2",
        [a.id, draft.id, reviewer],
      ),
    ).rejects.toMatchObject({ code: '55P03' });
    await publisher.query('ROLLBACK');
    await editor.query('COMMIT');
    await publisher.query(
      "UPDATE partners.offer_versions SET status='reviewed',reviewed_by=$3,reviewed_at=now() WHERE org_id=$1 AND offer_id=$2",
      [a.id, draft.id, reviewer],
    );
    await publisher.query(
      "UPDATE partners.offer_versions SET status='published' WHERE org_id=$1 AND offer_id=$2",
      [a.id, draft.id],
    );
    await expect(
      editor.query("UPDATE partners.offer_targets SET rule='{}' WHERE org_id=$1 AND offer_id=$2", [
        a.id,
        draft.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await Promise.all([editor.query('ROLLBACK'), publisher.query('ROLLBACK')]);
  }
});
it('requires a real verified HTTPS authority and rejects malformed or ambiguous redemption URLs', async () => {
  const a = await company(),
    draft = await offer(a, { published: false, link: true });
  const domain = (
    await fixture.admin.query(
      'SELECT redemption_domain FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2',
      [a.id, draft.id],
    )
  ).rows[0]!.redemption_domain as string;
  for (const url of [
    'https:///attacker.invalid/redeem',
    'https:////attacker.invalid/redeem',
    'https://' + domain + ':444/offer',
    'https://' + domain + '/\\ambiguous',
  ]) {
    await expect(
      fixture.admin.query(
        'UPDATE partners.offer_versions SET redemption_url=$3 WHERE org_id=$1 AND offer_id=$2',
        [a.id, draft.id, url],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }
  for (const url of ['https://' + domain, 'https://' + domain + ':443/offer?synthetic=1#terms']) {
    await fixture.admin.query(
      'UPDATE partners.offer_versions SET redemption_url=$3 WHERE org_id=$1 AND offer_id=$2',
      [a.id, draft.id, url],
    );
  }
});
it('reads current organization, agreement and verified domain status without rewriting frozen terms', async () => {
  const a = await company(),
    v = await offer(a, { link: true });
  const read = async () =>
    (
      await worker.query(
        'SELECT offer_id FROM partners.eligible_offer_versions WHERE offer_id=$1',
        [v.id],
      )
    ).rows;
  expect(await read()).toEqual([{ offer_id: v.id }]);
  await fixture.admin.query("UPDATE partners.organizations SET status='suspended' WHERE id=$1", [
    a.id,
  ]);
  expect(await read()).toEqual([]);
  await fixture.admin.query("UPDATE partners.organizations SET status='active' WHERE id=$1", [
    a.id,
  ]);
  await fixture.admin.query(
    "UPDATE partners.agreements SET status='revoked' WHERE org_id=$1 AND kind='dpa'",
    [a.id],
  );
  expect(await read()).toEqual([]);
  await fixture.admin.query(
    "UPDATE partners.agreements SET status='accepted' WHERE org_id=$1 AND kind='dpa'",
    [a.id],
  );
  await fixture.admin.query(
    "UPDATE partners.organization_domains SET status='revoked' WHERE org_id=$1",
    [a.id],
  );
  expect(await read()).toEqual([]);
  expect(
    (
      await fixture.admin.query(
        'SELECT status FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2',
        [a.id, v.id],
      )
    ).rows[0]!.status,
  ).toBe('published');
});
it('rejects empty target selectors and another tenant pool/code chain', async () => {
  const a = await company(),
    b = await company(),
    v = await offer(a, { published: false });
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.offer_targets(org_id,offer_id,offer_version,market,strategy) VALUES($1,$2,1,'US','sku')",
      [a.id, v.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query(
      "INSERT INTO partners.coupon_codes(org_id,pool_id,pool_mode,code_hmac,encrypted_code,key_version,expires_at) VALUES($1,$2,'unique',$3,$4,'synthetic',now()+interval '1 day')",
      [b.id, v.pool, randomBytes(32), randomBytes(64)],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  const other = await offer(a),
    foreignCode = await code(other),
    message = await send();
  await expect(reserve(v, message, foreignCode)).rejects.toMatchObject({ code: '23503' });
});
it('serializes the last exclusive code across two real worker connections', async () => {
  const v = await offer(await company()),
    c = await code(v),
    one = await send(),
    two = await send();
  const race = await Promise.allSettled([
    reserve(v, one, c, 1, worker),
    reserve(v, two, c, 1, competitor),
  ]);
  expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const refused = race.find((r) => r.status === 'rejected');
  expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: '23505' });
  expect(
    (
      await worker.query(
        'SELECT count(*)::int AS n FROM partners.coupon_reservations WHERE code_id=$1',
        [c],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it('enforces slots 1–3 and one selected organization per send with retained history', async () => {
  const message = await send(),
    a = await offer(await company()),
    b = await offer(await company());
  await reserve(a, message, await code(a));
  await expect(reserve(a, message, await code(a), 2)).rejects.toMatchObject({ code: '23505' });
  await expect(reserve(b, message, await code(b), 1)).rejects.toMatchObject({ code: '23505' });
  await expect(reserve(b, message, await code(b), 4)).rejects.toMatchObject({ code: '23514' });
  await reserve(b, message, await code(b), 2);
});
it('binds assignment and frequency subject to the actual P1 send owner', async () => {
  const v = await offer(await company()),
    message = await send(),
    other = await send();
  await expect(
    reserve(v, { ...message, subject: other.subject }, await code(v)),
  ).rejects.toMatchObject({ code: '23503' });
  await worker.query(
    "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,'overall_marketing','synthetic')",
    [other.subject],
  );
  await expect(
    worker.query(
      "INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,window_start,window_end,window_kind,calendar_time_zone,policy_version) VALUES($1,'overall_marketing',$2,now()-interval '1 day',now()+interval '30 days','calendar_month','UTC','synthetic')",
      [other.subject, message.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});
it('supports reusable shared codes while refusing exclusive-code entries and exact redemption attribution', async () => {
  const v = await offer(await company(), { mode: 'shared' }),
    message = await send();
  const id = await reserve(v, message, null);
  await reserve(v, await send(), null);
  await expect(code(v)).rejects.toMatchObject({ code: '23514' });
  await expect(
    worker.query(
      "INSERT INTO partners.redemption_events(org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,occurred_at) VALUES($1,$2,$3,1,'shared-event','reported',1,now())",
      [v.org.id, id, v.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

it('retains uncertain assignments until definitive evidence and frees only the live slot, preserving history', async () => {
  const v = await offer(await company()),
    message = await send(),
    c = await code(v),
    id = await reserve(v, message, c);
  await worker.query("UPDATE partners.coupon_reservations SET state='uncertain' WHERE id=$1", [id]);
  await expect(
    worker.query(
      "UPDATE partners.coupon_reservations SET state='released',released_at=now() WHERE id=$1",
      [id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const proof = await evidence();
  await expect(
    worker.query(
      "UPDATE partners.coupon_reservations SET state='released',released_at=now(),release_evidence_id=$2,release_reason='expired_unstarted' WHERE id=$1",
      [id, proof],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await worker.query(
    "UPDATE partners.coupon_reservations SET state='released',released_at=now(),release_evidence_id=$2,release_reason='definitively_not_sent' WHERE id=$1",
    [id, proof],
  );
  const next = await reserve(v, message, await code(v));
  expect(next).not.toBe(id);
  expect(
    (
      await worker.query(
        'SELECT count(*)::int AS n FROM partners.coupon_reservations WHERE send_id=$1',
        [message.id],
      )
    ).rows[0]!.n,
  ).toBe(2);
  await expect(
    worker.query(
      "UPDATE partners.coupon_reservations SET state='reserved',released_at=NULL,release_reason=NULL,release_evidence_id=NULL WHERE id=$1",
      [id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('bounds the last cap unit concurrently and binds cap/reservation parents to the same offer', async () => {
  const a = await company(),
    v = await offer(a),
    other = await offer(a),
    cap = randomUUID();
  await worker.query(
    "INSERT INTO partners.offer_cap_windows(id,org_id,offer_id,kind,policy_version,window_start,window_end,limit_units) VALUES($1,$2,$3,'day','synthetic',now(),now()+interval '1 day',1)",
    [cap, a.id, v.id],
  );
  const race = await Promise.allSettled([
    worker.query(
      'UPDATE partners.offer_cap_windows SET consumed_units=consumed_units+1 WHERE id=$1',
      [cap],
    ),
    competitor.query(
      'UPDATE partners.offer_cap_windows SET consumed_units=consumed_units+1 WHERE id=$1',
      [cap],
    ),
  ]);
  expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const bad = race.find((r) => r.status === 'rejected');
  expect(bad?.status === 'rejected' && bad.reason).toMatchObject({ code: '23514' });
  expect(
    (
      await worker.query(
        'SELECT consumed_units::text AS used FROM partners.offer_cap_windows WHERE id=$1',
        [cap],
      )
    ).rows,
  ).toEqual([{ used: '1' }]);
  const reservation = await reserve(other, await send(), await code(other));
  await expect(
    worker.query(
      'INSERT INTO partners.cap_reservations(org_id,cap_id,reservation_id,offer_id,offer_version,units) VALUES($1,$2,$3,$4,1,1)',
      [a.id, cap, reservation, other.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});
it('uses stable cross-organization frequency scopes and explicit windows without permitting early release', async () => {
  const message = await send(),
    scope = 'offer:' + randomUUID();
  await worker.query(
    "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,$2,'synthetic')",
    [message.subject, scope],
  );
  await worker.query(
    "INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,window_start,window_end,window_kind,policy_version) VALUES($1,$2,$3,now()-interval '1 day',now()+interval '29 days','rolling_30_days','synthetic')",
    [message.subject, scope, message.id],
  );
  await expect(
    worker.query(
      "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,$2,'other-policy')",
      [message.subject, scope],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    worker.query(
      "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,'offer_version:1','synthetic')",
      [message.subject],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await worker.query(
    "UPDATE partners.frequency_reservations SET state='uncertain' WHERE send_id=$1",
    [message.id],
  );
  await expect(
    worker.query(
      "UPDATE partners.frequency_reservations SET state='released',released_at=now() WHERE send_id=$1",
      [message.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('prevents issued frequency usage from downgrading through reserved or uncertain before release', async () => {
  const message = await send();
  await worker.query(
    "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,'overall_marketing','synthetic')",
    [message.subject],
  );
  await worker.query(
    "INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,window_start,window_end,window_kind,calendar_time_zone,policy_version) VALUES($1,'overall_marketing',$2,now()-interval '1 day',now()+interval '30 days','calendar_month','UTC','synthetic')",
    [message.subject, message.id],
  );
  await worker.query("UPDATE partners.frequency_reservations SET state='issued' WHERE send_id=$1", [
    message.id,
  ]);
  for (const state of ['reserved', 'uncertain', 'released']) {
    await expect(
      worker.query(
        "UPDATE partners.frequency_reservations SET state=$2,released_at=CASE WHEN $2='released' THEN now() END,release_evidence_id=CASE WHEN $2='released' THEN $3::uuid END WHERE send_id=$1",
        [message.id, state, await evidence()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }
  expect(
    (
      await worker.query('SELECT state FROM partners.frequency_reservations WHERE send_id=$1', [
        message.id,
      ])
    ).rows,
  ).toEqual([{ state: 'issued' }]);
});
it('deduplicates codes without plaintext and rejects foreign pool mode and invalid ciphertext bounds', async () => {
  const v = await offer(await company()),
    digest = randomBytes(32);
  const insert = (mode: string, encrypted: Buffer, fingerprint = digest) =>
    worker.query(
      "INSERT INTO partners.coupon_codes(org_id,pool_id,pool_mode,code_hmac,encrypted_code,key_version,expires_at) VALUES($1,$2,$3,$4,$5,'synthetic',now()+interval '1 day')",
      [v.org.id, v.pool, mode, fingerprint, encrypted],
    );
  await insert('unique', randomBytes(64));
  await expect(insert('unique', randomBytes(64))).rejects.toMatchObject({ code: '23505' });
  await expect(insert('generated', randomBytes(64), randomBytes(32))).rejects.toMatchObject({
    code: '23503',
  });
  await expect(insert('unique', randomBytes(8))).rejects.toMatchObject({ code: '23514' });
});
it('freezes decision identity and validates reason arrays', async () => {
  const v = await offer(await company()),
    message = await send(),
    id = randomUUID();
  await worker.query(
    "INSERT INTO partners.offer_decisions(id,org_id,send_id,owner_subject_id,offer_id,offer_version,policy_version,outcome,reason_codes,expires_at) VALUES($1,$2,$3,$4,$5,1,'synthetic','selected','[\"exact_match\"]',now()+interval '1 day')",
    [id, v.org.id, message.id, message.subject, v.id],
  );
  await expect(
    fixture.admin.query("UPDATE partners.offer_decisions SET outcome='excluded' WHERE id=$1", [id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    worker.query(
      "INSERT INTO partners.offer_decisions(org_id,send_id,owner_subject_id,offer_id,offer_version,policy_version,outcome,reason_codes,expires_at) VALUES($1,$2,$3,$4,1,'bad-reason','excluded','[123]',now()+interval '1 day')",
      [v.org.id, message.id, message.subject, v.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('retains immutable reported-redemption corrections, deduplicates events and refuses another assignment parent', async () => {
  const v = await offer(await company()),
    first = await reserve(v, await send(), await code(v)),
    second = await reserve(v, await send(), await code(v)),
    event = randomUUID();
  await worker.query(
    "INSERT INTO partners.redemption_events(id,org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,occurred_at) VALUES($1,$2,$3,$4,1,'event-1','reported',1,now())",
    [event, v.org.id, first, v.id],
  );
  await expect(
    worker.query(
      "INSERT INTO partners.redemption_events(org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,occurred_at) VALUES($1,$2,$3,1,'event-1','reported',1,now())",
      [v.org.id, first, v.id],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    worker.query(
      "INSERT INTO partners.redemption_events(org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,reverses_event_id,occurred_at) VALUES($1,$2,$3,1,'foreign-parent','reversal',-1,$4,now())",
      [v.org.id, second, v.id, event],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await worker.query(
    "INSERT INTO partners.redemption_events(org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,reverses_event_id,occurred_at) VALUES($1,$2,$3,1,'event-2','reversal',-1,$4,now())",
    [v.org.id, first, v.id, event],
  );
  expect(
    (
      await worker.query(
        'SELECT sum(quantity_delta)::int AS n FROM partners.redemption_events WHERE reservation_id=$1',
        [first],
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  await expect(
    fixture.admin.query('UPDATE partners.redemption_events SET quantity_delta=2 WHERE id=$1', [
      event,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('rejects forward reversal parents in bulk inserts and validates already inserted quantities', async () => {
  const v = await offer(await company()),
    reservation = await reserve(v, await send(), await code(v)),
    reported = randomUUID(),
    reversal = randomUUID();
  await expect(
    worker.query(
      `INSERT INTO partners.redemption_events(id,org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,reverses_event_id,occurred_at) VALUES
      ($1,$3,$4,$5,1,'forward-reversal','reversal',-4,$2,now()),
      ($2,$3,$4,$5,1,'later-report','reported',1,NULL,now())`,
      [reversal, reported, v.org.id, reservation, v.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  expect(
    (
      await worker.query(
        'SELECT count(*)::int AS n FROM partners.redemption_events WHERE reservation_id=$1',
        [reservation],
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  await worker.query(
    `INSERT INTO partners.redemption_events(id,org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,reverses_event_id,occurred_at) VALUES
    ($1,$3,$4,$5,1,'earlier-report','reported',1,NULL,now()),
    ($2,$3,$4,$5,1,'ordered-reversal','reversal',-1,$1,now())`,
    [reported, reversal, v.org.id, reservation, v.id],
  );
  expect(
    (
      await worker.query(
        'SELECT sum(quantity_delta)::int AS n FROM partners.redemption_events WHERE reservation_id=$1',
        [reservation],
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it('binds dispute resolution and correction events to the same tenant and dispute', async () => {
  const v = await offer(await company()),
    reservation = await reserve(v, await send(), await code(v)),
    one = randomUUID(),
    two = randomUUID(),
    event = randomUUID();
  for (const id of [one, two])
    await worker.query(
      "INSERT INTO partners.disputes(id,org_id,reservation_id,reason_code,encrypted_details,key_version) VALUES($1,$2,$3,'terms',$4,'synthetic')",
      [id, v.org.id, reservation, randomBytes(64)],
    );
  await worker.query(
    "INSERT INTO partners.dispute_events(id,org_id,dispute_id,kind,encrypted_details,key_version) VALUES($1,$2,$3,'resolved',$4,'synthetic')",
    [event, v.org.id, one, randomBytes(64)],
  );
  await expect(
    worker.query(
      "UPDATE partners.disputes SET state='closed',closed_at=now(),resolution_event_id=$2 WHERE id=$1",
      [two, event],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await worker.query(
    "UPDATE partners.disputes SET state='closed',closed_at=now(),resolution_event_id=$2 WHERE id=$1",
    [one, event],
  );
  await expect(
    fixture.admin.query("UPDATE partners.dispute_events SET kind='evidence' WHERE id=$1", [event]),
  ).rejects.toMatchObject({ code: '23514' });
  await context(v.org, async () => {
    const rows = (await tenant.query('SELECT id,state FROM partners.disputes WHERE id=$1', [one]))
      .rows;
    expect(rows).toEqual([{ id: one, state: 'closed' }]);
    await expect(
      tenant.query('SELECT encrypted_details FROM partners.disputes'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
it('publishes only reviewed current-generation cohorts and suppresses dirty, small and foreign aggregates', async () => {
  const a = await company(),
    b = await company();
  await worker.query(
    "INSERT INTO partners.insight_heads(org_id,revision,state) VALUES($1,1,'ready'),($2,1,'ready')",
    [a.id, b.id],
  );
  for (const [org, sample, day] of [
    [a.id, 15, '2026-01-01'],
    [a.id, 5, '2026-01-02'],
    [b.id, 15, '2026-01-01'],
  ] as const) {
    await worker.query(
      "INSERT INTO partners.daily_metrics(org_id,generation,day,metric,market,total_count,sample_size,minimum_cohort,status,reviewed_by,reviewed_at) VALUES($1,1,$2,'included','US',15,$3,10,'reviewed',$4,now())",
      [org, day, sample, reviewer],
    );
  }
  const read = () =>
    context(
      a,
      async () =>
        (
          await tenant.query(
            'SELECT org_id,day::text,metric,market,total_count FROM partners.partner_daily_metrics ORDER BY day',
          )
        ).rows,
    );
  expect(await read()).toEqual([
    { org_id: a.id, day: '2026-01-01', metric: 'included', market: 'US', total_count: '15' },
  ]);
  await worker.query("UPDATE partners.insight_heads SET state='dirty',revision=2 WHERE org_id=$1", [
    a.id,
  ]);
  expect(await read()).toEqual([]);
  await expect(
    worker.query("UPDATE partners.insight_heads SET state='ready' WHERE org_id=$1", [a.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await worker.query("UPDATE partners.insight_heads SET state='ready',revision=3 WHERE org_id=$1", [
    a.id,
  ]);
  expect(await read()).toEqual([]);
});
it('uses a bounded indexed organization/generation/day query at representative aggregate cardinality', async () => {
  const a = await company();
  await worker.query(
    `INSERT INTO partners.daily_metrics(org_id,generation,day,metric,market,total_count,sample_size,minimum_cohort)
    SELECT $1,1,date '2000-01-01'+g,'included','US',20,20,10 FROM generate_series(1,10000) g`,
    [a.id],
  );
  await fixture.admin.query('ANALYZE partners.daily_metrics');
  const plan = (
    await worker.query(
      "EXPLAIN (ANALYZE,FORMAT JSON) SELECT day,total_count FROM partners.daily_metrics WHERE org_id=$1 AND generation=1 AND day>date '2020-01-01' ORDER BY day LIMIT 51",
      [a.id],
    )
  ).rows[0]!['QUERY PLAN'][0];
  expect(JSON.stringify(plan.Plan)).toContain('Index');
  expect(plan.Plan['Actual Rows']).toBe(51);
  console.log(
    'P2_PARTNER_QUERY_EVIDENCE ' +
      JSON.stringify({
        syntheticRows: 10000,
        returned: 51,
        indexed: true,
        executionMs: plan['Execution Time'],
        productionSlaAccepted: false,
      }),
  );
});
it('keeps shared-code fingerprints and configured cap limits immutable', async () => {
  const v = await offer(await company(), { mode: 'shared' });
  await expect(
    worker.query('UPDATE partners.coupon_pools SET shared_code_hmac=$2 WHERE id=$1', [
      v.pool,
      randomBytes(32),
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const cap = randomUUID();
  await worker.query(
    "INSERT INTO partners.offer_cap_windows(id,org_id,offer_id,kind,policy_version,window_start,window_end,limit_units) VALUES($1,$2,$3,'day','synthetic',now(),now()+interval '1 day',1)",
    [cap, v.org.id, v.id],
  );
  await expect(
    worker.query('UPDATE partners.offer_cap_windows SET limit_units=2 WHERE id=$1', [cap]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('retains the evaluated frequency policy and refuses a new reservation under a superseded policy', async () => {
  const first = await send(),
    second = await send({ id: first.contact, subjectId: first.subject });
  await worker.query(
    "INSERT INTO partners.frequency_guards(subject_id,scope_key,policy_version) VALUES($1,'overall_marketing','evaluated-v1')",
    [first.subject],
  );
  await worker.query(
    "INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,window_start,window_end,window_kind,calendar_time_zone,policy_version) VALUES($1,'overall_marketing',$2,now()-interval '1 day',now()+interval '30 days','calendar_month','UTC','evaluated-v1')",
    [first.subject, first.id],
  );
  await worker.query(
    "UPDATE partners.frequency_guards SET policy_version='evaluated-v2' WHERE subject_id=$1 AND scope_key='overall_marketing'",
    [first.subject],
  );
  expect(
    (
      await worker.query(
        'SELECT policy_version FROM partners.frequency_reservations WHERE send_id=$1',
        [first.id],
      )
    ).rows,
  ).toEqual([{ policy_version: 'evaluated-v1' }]);
  await expect(
    worker.query(
      "INSERT INTO partners.frequency_reservations(subject_id,scope_key,send_id,window_start,window_end,window_kind,calendar_time_zone,policy_version) VALUES($1,'overall_marketing',$2,now()-interval '1 day',now()+interval '30 days','calendar_month','UTC','evaluated-v1')",
      [first.subject, second.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

it('rejects an unreviewed source checksum before SQL and rolls back failed extension DDL/history together', async () => {
  const sources = partnerSources().sources,
    changed = sources.map((s, i) =>
      i === sources.length - 1 ? { ...s, source: s.source + '\n-- changed' } : s,
    );
  await expect(migrateApplication(fixture.target, changed)).rejects.toThrow('checksum');
  const source = 'CREATE TABLE partners.failed_extension (id integer); SELECT 1/0;',
    bad = {
      id: '0037_failed_extension',
      source,
      sha256: createHash('sha256').update(source).digest('hex'),
    };
  await expect(migrateApplication(fixture.target, [...sources, bad])).rejects.toMatchObject({
    code: '22012',
  });
  expect(
    (await fixture.admin.query("SELECT to_regclass('partners.failed_extension') AS relation")).rows,
  ).toEqual([{ relation: null }]);
  expect(await fixture.install()).toBe(0);
  console.log(
    'P2_PARTNER_SCHEMA_EVIDENCE ' +
      JSON.stringify({
        optInLocalTrack: true,
        localMigrations: 3,
        newTables: 23,
        forcedRls: true,
        preservedP1Tables: 141,
        preservedP1Permissions: true,
        preservedP1Migrations: 33,
        restrictedRuntimeLogins: 3,
        realCodeAndCapRaces: true,
        sharedAndExclusiveSeparated: true,
        sourceChecksumRefused: true,
        failedDdlRolledBack: true,
        productionBootstrapChanged: false,
        actualAuthenticationAcceptance: false,
        actualPrivacyAcceptance: false,
        actualPilotAccepted: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        productionActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
