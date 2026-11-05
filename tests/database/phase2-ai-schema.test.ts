import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { aiFixture, aiRoles, aiSources } from '../fixtures/phase2/ai.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';

let fixture: Awaited<ReturnType<typeof aiFixture>>;
let worker: pg.Client, competitor: pg.Client, reader: pg.Client, staff: pg.Client;
const source = randomUUID(),
  license = randomUUID(),
  provider = randomUUID();
beforeAll(async () => {
  fixture = await aiFixture();
  worker = await fixture.aiConnect('tt_p2_ai_worker');
  competitor = await fixture.aiConnect('tt_p2_ai_worker');
  reader = await fixture.aiConnect('tt_p2_ai_runtime');
  staff = await fixture.aiConnect('tt_p2_ai_staff');
  await fixture.admin.query(
    "INSERT INTO app.data_providers(id,code,name,status) VALUES($1,$2,'Synthetic AI rights only','active')",
    [provider, 'synthetic-ai-' + provider],
  );
  await fixture.admin.query(
    'INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at) VALUES($1,$2,\'US\',\'{"display":true,"cache":true,"derived":true,"snapshot":true,"api":true,"ai_processing":true}\',now()-interval \'1 day\',now())',
    [license, provider],
  );
  await fixture.admin.query(
    "INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) VALUES($1,$2,$3,'synthetic_ai','v1',$4,'staging',now(),now(),0)",
    [source, provider, license, digest()],
  );
  await fixture.admin.query(
    "UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id=$1",
    [source],
  );
}, 30000);
afterAll(async () => {
  await fixture?.cleanup();
});

it('installs AI policy storage on the populated opt-in P1/P2 base', async () => {
  expect(
    (await fixture.admin.query("SELECT to_regclass('app.ai_policy_versions')::text AS relation"))
      .rows,
  ).toEqual([{ relation: 'app.ai_policy_versions' }]);
  expect(fixture.appliedAi).toBe(3);
  expect(fixture.aiBefore).toHaveLength(164);
  expect(fixture.aiAfter).toEqual(fixture.aiBefore);
  expect(fixture.aiBefore.find((row) => row.table === 'partners.organizations')?.count).toBe(1);
  expect(fixture.aiBefore.find((row) => row.table === 'partners.memberships')?.count).toBe(1);
  expect(fixture.aiAfterPermissions).toEqual(fixture.aiBeforePermissions);
  const history = (
    await fixture.admin.query(
      'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position',
    )
  ).rows;
  expect(history.slice(0, 36)).toEqual(fixture.aiBeforeHistory);
  expect(history).toHaveLength(39);
  expect(history.slice(36).map((x) => x.id)).toEqual(
    aiSources().manifest.migrations.map((x) => x.id),
  );
  expect(await fixture.installAi()).toBe(0);
});

const digest = () => randomBytes(32).toString('hex');
type Scope = {
  id: string;
  policy: string;
  owner: string | null;
  kind: 'owner' | 'shared';
  task: string;
};
type Request = {
  id: string;
  scope: Scope;
  key: string;
  hash: string;
  manifest: Record<string, unknown>;
};
async function policy(task = 'report_analysis', shared = false) {
  const id = randomUUID();
  await staff.query(
    `INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,shared_allowed,shared_parameter_allowlist,template_key,reviewed_by,reviewed_at)
 VALUES($1,$2,'synthetic','synthetic-v1','p1','s1','v1','local-jsonb-v1',$3,'active',$4,$5,$6,$7,now())`,
    [
      id,
      task,
      digest(),
      shared,
      JSON.stringify(shared ? ['usage', 'climate_category'] : []),
      shared ? 'reviewed-synthetic-template' : null,
      fixture.staff,
    ],
  );
  return id;
}
async function scope(
  options: { kind?: 'owner' | 'shared'; task?: string; owner?: string; policy?: string } = {},
): Promise<Scope> {
  const kind = options.kind ?? 'owner',
    task = options.task ?? (kind === 'shared' ? 'generic_explanation' : 'report_analysis');
  const owner =
    kind === 'shared' ? null : (options.owner ?? (await fixture.owner()).identity.subjectId);
  const value = {
    id: randomUUID(),
    policy: options.policy ?? (await policy(task, kind === 'shared')),
    owner,
    kind,
    task,
  };
  await staff.query(
    'INSERT INTO app.ai_reuse_scopes(id,kind,owner_subject_id,scope_key,policy_version_id) VALUES($1,$2,$3,$4,$5)',
    [value.id, kind, owner, 'synthetic:' + value.id, value.policy],
  );
  const revision = owner
    ? (
        await fixture.admin.query(
          'SELECT permission_revision::text AS revision FROM app.subjects WHERE id=$1',
          [owner],
        )
      ).rows[0]!.revision
    : null;
  await staff.query(
    "INSERT INTO app.ai_scope_guards(scope_id,subject_permission_revision,processing_allowed,notice_version,choice_evidence_hash,choice_recorded_at) VALUES($1,$2,true,'synthetic-notice-v1',$3,now())",
    [value.id, revision, digest()],
  );
  return value;
}
async function request(
  s: Scope,
  manifest: Record<string, unknown> = { parameters: { usage: 'commute' } },
  key: string = randomUUID(),
  seconds = 90,
): Promise<Request> {
  const id = randomUUID(),
    hash = (
      await worker.query('SELECT app.ai_input_digest($1,$2,$3,$4::jsonb) AS hash', [
        s.id,
        s.policy,
        'local-jsonb-v1',
        JSON.stringify(manifest),
      ])
    ).rows[0]!.hash as string;
  await worker.query(
    `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,expires_at)
 SELECT $1,$2,$3,$4,$5,$6,$7,g.notice_version,g.permission_revision,g.subject_permission_revision,g.invalidation_revision,now()+make_interval(secs=>$8) FROM app.ai_scope_guards g WHERE scope_id=$2`,
    [id, s.id, s.owner, s.policy, hash, JSON.stringify(manifest), key, seconds],
  );
  return { id, scope: s, key, hash, manifest };
}
async function attempt(r: Request, client = worker, currency = 'USD', ordinal = 1) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO app.ai_attempts(id,request_id,scope_id,policy_version_id,attempt,currency_code) VALUES($1,$2,$3,$4,$5,$6)',
    [id, r.id, r.scope.id, r.scope.policy, ordinal, currency],
  );
  return id;
}
async function budget(s: Scope, limit = 1000, currency = 'USD') {
  const id = randomUUID();
  await staff.query(
    "INSERT INTO app.ai_budget_windows(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 day',$4,$5)",
    [id, 'synthetic:' + id, s.policy, currency, limit],
  );
  return id;
}
async function reserve(
  s: Scope,
  a: string,
  b: string,
  units = 100,
  client = worker,
  currency = 'USD',
) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO app.ai_budget_reservations(id,budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,$4,$5,$6)',
    [id, b, a, s.policy, currency, units],
  );
  return id;
}
async function accepted(r: Request) {
  const a = await attempt(r),
    b = await budget(r.scope),
    reservation = await reserve(r.scope, a, b);
  await worker.query("UPDATE app.ai_analysis_requests SET state='running' WHERE id=$1", [r.id]);
  await worker.query(
    "UPDATE app.ai_attempts SET state='started',started_at=clock_timestamp() WHERE id=$1",
    [a],
  );
  await worker.query(
    "UPDATE app.ai_attempts SET state='succeeded',finished_at=clock_timestamp() WHERE id=$1",
    [a],
  );
  await worker.query("UPDATE app.ai_analysis_requests SET state='accepted' WHERE id=$1", [r.id]);
  return { attempt: a, budget: b, reservation };
}
async function artifact(
  r: Request,
  options: {
    outputHash?: string;
    sourceCount?: number;
    validSeconds?: number;
    rightsSeconds?: number;
    beforeInsert?: () => Promise<void>;
    useCurrentRevisions?: boolean;
  } = {},
) {
  const run = await accepted(r),
    id = randomUUID(),
    output = { summary: 'Synthetic storage evidence only', claims: [] };
  await options.beforeInsert?.();
  await worker.query('BEGIN');
  try {
    await worker.query(
      `INSERT INTO app.ai_artifacts(id,scope_id,request_id,policy_version_id,attempt_id,input_digest,input_manifest,output,output_hash,validation_version,permission_revision,subject_permission_revision,invalidation_revision,source_count,valid_until,retain_until)
 SELECT $1,r.scope_id,r.id,r.policy_version_id,$2,r.input_digest,r.input_manifest,$3::jsonb,coalesce($4,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex')),'v1',CASE WHEN $8 THEN g.permission_revision ELSE r.permission_revision END,CASE WHEN $8 THEN g.subject_permission_revision ELSE r.subject_permission_revision END,CASE WHEN $8 THEN g.invalidation_revision ELSE r.invalidation_revision END,$5,now()+make_interval(secs=>$6),now()+interval '2 days' FROM app.ai_analysis_requests r JOIN app.ai_scope_guards g ON g.scope_id=r.scope_id WHERE r.id=$7`,
      [
        id,
        run.attempt,
        JSON.stringify(output),
        options.outputHash ?? null,
        options.sourceCount ?? 1,
        options.validSeconds ?? 3600,
        r.id,
        options.useCurrentRevisions ?? false,
      ],
    );
    if ((options.sourceCount ?? 1) > 0)
      await worker.query(
        "INSERT INTO app.ai_artifact_sources(artifact_id,source_key,dataset_version_id,claim_hash,rights_valid_until) VALUES($1,'synthetic-version',$2,$3,now()+make_interval(secs=>$4))",
        [id, source, digest(), options.rightsSeconds ?? 7200],
      );
    await worker.query('COMMIT');
    return { id, ...run, request: r };
  } catch (error) {
    await worker.query('ROLLBACK');
    throw error;
  }
}
async function ownReport() {
  const owner = await fixture.owner(),
    report = await fixture.report(owner.identity),
    s = await scope({ owner: owner.identity.subjectId });
  const snapshot = (
    await fixture.admin.query(
      'SELECT snapshot_hash,bundle_id FROM app.report_versions WHERE report_id=$1 AND version=1',
      [report.head.id],
    )
  ).rows[0]!;
  return {
    owner,
    report,
    s,
    manifest: {
      parameters: { usage: 'commute' },
      authoritative_hash: snapshot.snapshot_hash,
      bundle_id: snapshot.bundle_id,
    },
  };
}
async function attach(
  a: Awaited<ReturnType<typeof artifact>>,
  report: string,
  owner: string,
  authorization = a.request.scope,
  revision = 1,
) {
  await worker.query(
    `INSERT INTO app.report_analysis_attachments(report_id,report_version,revision,artifact_id,scope_id,owner_subject_id,selection_kind,authorization_scope_id,authorization_permission_revision,authorization_subject_revision)
 SELECT $1,1,$2,$3,$4,$5,$6,$7,g.permission_revision,g.subject_permission_revision FROM app.ai_scope_guards g WHERE g.scope_id=$7`,
    [report, revision, a.id, a.request.scope.id, owner, a.request.scope.kind, authorization.id],
  );
}
async function ownerContext<T>(owner: string, work: () => Promise<T>) {
  await reader.query('BEGIN');
  try {
    await reader.query("SELECT set_config('tt.p2_ai_subject',$1,true)", [owner]);
    return await work();
  } finally {
    await reader.query('ROLLBACK');
  }
}
async function audit() {
  const id = randomUUID();
  await fixture.admin.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'ai.cost.reconcile','synthetic_attempt','approved',now(),$2,'[]')",
    [id, digest()],
  );
  return id;
}
async function balance(b: string) {
  return (
    await worker.query(
      'SELECT reserved_minor::text AS reserved,spent_minor::text AS spent FROM app.ai_budget_windows WHERE id=$1',
      [b],
    )
  ).rows[0];
}

it('forces RLS on all twelve new tables', async () => {
  const tables = aiSources().manifest.tables;
  const rows = (
    await fixture.admin.query(
      'SELECT oid::regclass::text AS name,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=ANY($1::regclass[]) ORDER BY oid::regclass::text',
      [tables],
    )
  ).rows;
  expect(rows.map((r) => r.name).sort()).toEqual([...tables].sort());
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
});
it('uses three real non-owning, nonprivileged runtime identities', async () => {
  const rows = (
    await fixture.admin.query(
      'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1)',
      [aiRoles],
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(
    rows.every(
      (r) =>
        !r.rolsuper &&
        !r.rolcreatedb &&
        !r.rolcreaterole &&
        !r.rolinherit &&
        !r.rolreplication &&
        !r.rolbypassrls,
    ),
  ).toBe(true);
});
it.each([
  'SELECT * FROM privacy.contacts',
  'SELECT * FROM app.ai_attempts',
  'SELECT * FROM app.ai_budget_reservations',
  'SELECT * FROM app.ai_artifact_sources',
  'SELECT * FROM email.analysis_selections',
  'SELECT * FROM partners.coupon_codes',
])('denies private owner-runtime access: %s', async (sql) => {
  await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
});
it('isolates owner request status and clears transaction-local context', async () => {
  const first = await scope(),
    second = await scope(),
    r = await request(first),
    other = await request(second);
  expect((await reader.query('SELECT id FROM app.ai_analysis_requests')).rows).toEqual([]);
  expect(
    await ownerContext(
      first.owner!,
      async () =>
        (
          await reader.query('SELECT id FROM app.ai_analysis_requests WHERE id=ANY($1)', [
            [r.id, other.id],
          ])
        ).rows,
    ),
  ).toEqual([{ id: r.id }]);
  expect((await reader.query('SELECT id FROM app.ai_analysis_requests')).rows).toEqual([]);
});
it('does not give an existing P1 private runtime access to AI tables, views or lease functions', async () => {
  const legacy = new pg.Client({ connectionString: fixture.connectionUrl('tt_private_runtime') });
  await legacy.connect();
  try {
    for (const relation of ['app.ai_artifacts', 'app.ai_current_reuse', 'app.ai_report_analysis'])
      await expect(legacy.query('SELECT * FROM ' + relation)).rejects.toMatchObject({
        code: '42501',
      });
    await expect(
      legacy.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [
        randomUUID(),
        digest(),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await legacy.end();
  }
});
it('rejects unreviewed shared policies, owner-null fallback and shared photo scopes', async () => {
  const ownerPolicy = await policy();
  await expect(
    staff.query(
      "INSERT INTO app.ai_reuse_scopes(kind,scope_key,policy_version_id) VALUES('shared',$1,$2)",
      [randomUUID(), ownerPolicy],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    staff.query(
      "INSERT INTO app.ai_reuse_scopes(kind,scope_key,policy_version_id) VALUES('owner',$1,$2)",
      [randomUUID(), ownerPolicy],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(policy('photo_extraction', true)).rejects.toMatchObject({ code: '23514' });
});
it('keeps evaluated policy and scope identities immutable', async () => {
  const s = await scope();
  await expect(
    fixture.admin.query("UPDATE app.ai_policy_versions SET model_id='changed' WHERE id=$1", [
      s.policy,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.admin.query('UPDATE app.ai_reuse_scopes SET owner_subject_id=$2 WHERE id=$1', [
      s.id,
      (await scope()).owner,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('binds request owner, policy, digest and immutable idempotency identity', async () => {
  const s = await scope(),
    other = await scope(),
    r = await request(s);
  for (const [field, value] of [
    ['owner_subject_id', other.owner],
    ['policy_version_id', other.policy],
    ['input_digest', digest()],
  ] as const)
    await expect(
      fixture.admin.query(`UPDATE app.ai_analysis_requests SET ${field}=$2 WHERE id=$1`, [
        r.id,
        value,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  await expect(request(s, { parameters: { usage: 'highway' } }, r.key)).rejects.toMatchObject({
    code: '23505',
  });
});
it('rejects wrong-owner and wrong-policy request inserts before persistence', async () => {
  const s = await scope(),
    other = await scope(),
    r = await request(s);
  for (const variant of ['owner', 'policy'])
    await expect(
      worker.query(
        `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,expires_at)
 SELECT $1::uuid,scope_id,CASE WHEN $3='owner' THEN $4::uuid ELSE owner_subject_id END,CASE WHEN $3='policy' THEN $5::uuid ELSE policy_version_id END,input_digest,input_manifest,$1::text,notice_version,permission_revision,subject_permission_revision,invalidation_revision,now()+interval '90 seconds' FROM app.ai_analysis_requests WHERE id=$2`,
        [randomUUID(), r.id, variant, other.owner, other.policy],
      ),
    ).rejects.toMatchObject({ code: '23514' });
});
it('rejects personal/shared free-text parameters, image hashes and unknown packet fields', async () => {
  const s = await scope({ kind: 'shared' });
  for (const manifest of [
    { parameters: { email: 'synthetic@example.invalid' } },
    { parameters: { usage: 'synthetic@example.invalid' } },
    { parameters: { usage: 'commute' }, sanitized_sha256: digest() },
    { parameters: { usage: 'commute' }, owner_id: randomUUID() },
  ])
    await expect(request(s, manifest)).rejects.toMatchObject({ code: '23514' });
  expect(
    (await request(s, { parameters: { usage: 'commute', climate_category: null } })).hash,
  ).toMatch(/^[a-f0-9]{64}$/);
});
it('requires the sanitized image hash for photo policy inputs', async () => {
  const s = await scope({ task: 'photo_extraction' });
  await expect(request(s)).rejects.toMatchObject({ code: '23514' });
  await request(s, { parameters: {}, sanitized_sha256: digest() });
});
it.each(['bundle_id', 'authoritative_hash', 'rule_version', 'advice_revision'])(
  'rejects untyped private content in shared metadata %s',
  async (field) => {
    const s = await scope({ kind: 'shared' });
    await expect(
      request(s, {
        parameters: { usage: 'commute' },
        [field]: { email: 'synthetic@example.invalid' },
      }),
    ).rejects.toMatchObject({ code: '23514' });
  },
);
it.each(['bundle_id', 'authoritative_hash'])(
  'rejects owner packet metadata %s even when it has the correct scalar type',
  async (field) => {
    const s = await scope({ kind: 'shared' });
    await expect(
      request(s, { parameters: {}, [field]: field === 'bundle_id' ? randomUUID() : digest() }),
    ).rejects.toMatchObject({ code: '23514' });
  },
);
it('accepts typed version metadata and rejects malformed owner packet identities', async () => {
  const s = await scope();
  for (const [field, value] of [
    ['bundle_id', 'synthetic@example.invalid'],
    ['authoritative_hash', []],
    ['rule_version', null],
    ['advice_revision', { private: 'synthetic' }],
  ])
    await expect(request(s, { parameters: {}, [String(field)]: value })).rejects.toMatchObject({
      code: '23514',
    });
  await request(s, {
    parameters: {},
    bundle_id: randomUUID(),
    authoritative_hash: digest(),
    rule_version: randomUUID(),
    advice_revision: randomUUID(),
  });
  await request(await scope({ kind: 'shared' }), {
    parameters: {},
    rule_version: randomUUID(),
    advice_revision: randomUUID(),
  });
});
it('anchors request creation and maximum expiry to database admission time', async () => {
  const s = await scope(),
    r = await request(s);
  await expect(
    worker.query(
      `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,created_at,expires_at)
 SELECT $1::uuid,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,$1::text,notice_version,permission_revision,subject_permission_revision,invalidation_revision,now()+interval '1 day',now()+interval '1 day 90 seconds' FROM app.ai_analysis_requests WHERE id=$2`,
      [randomUUID(), r.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await worker.query(
        'SELECT count(*)::integer AS count FROM app.ai_analysis_requests WHERE scope_id=$1',
        [s.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
it('rejects an attempt without its already visible request or with a foreign scope', async () => {
  const s = await scope(),
    r = await request(s),
    other = await scope();
  await expect(
    worker.query(
      "INSERT INTO app.ai_attempts(request_id,scope_id,policy_version_id,attempt,currency_code) VALUES($1,$2,$3,1,'USD')",
      [randomUUID(), s.id, s.policy],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    worker.query(
      "INSERT INTO app.ai_attempts(request_id,scope_id,policy_version_id,attempt,currency_code) VALUES($1,$2,$3,1,'USD')",
      [r.id, other.id, other.policy],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('requires a cost hold before starting, bounds retries and prevents attempt rewinds', async () => {
  const s = await scope(),
    r = await request(s),
    a = await attempt(r);
  await expect(
    worker.query("UPDATE app.ai_attempts SET state='started',started_at=now() WHERE id=$1", [a]),
  ).rejects.toMatchObject({ code: '23514' });
  await reserve(s, a, await budget(s));
  await worker.query("UPDATE app.ai_attempts SET state='started',started_at=now() WHERE id=$1", [
    a,
  ]);
  await expect(
    worker.query("UPDATE app.ai_attempts SET state='created' WHERE id=$1", [a]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(attempt(r, worker, 'USD', 4)).rejects.toMatchObject({ code: '23514' });
});
it.each(['attempt_insert', 'budget_admission', 'attempt_start'])(
  'rejects stale captured request revisions at %s',
  async (stage) => {
    const s = await scope(),
      r = await request(s),
      a = stage === 'attempt_insert' ? null : await attempt(r),
      b = await budget(s);
    if (stage === 'attempt_start') await reserve(s, a!, b);
    await staff.query(
      'UPDATE app.ai_scope_guards SET invalidation_revision=invalidation_revision+1 WHERE scope_id=$1',
      [s.id],
    );
    if (stage === 'attempt_insert')
      await expect(attempt(r)).rejects.toMatchObject({ code: '23514' });
    else if (stage === 'budget_admission')
      await expect(reserve(s, a!, b)).rejects.toMatchObject({ code: '23514' });
    else
      await expect(
        worker.query(
          "UPDATE app.ai_attempts SET state='started',started_at=clock_timestamp() WHERE id=$1",
          [a],
        ),
      ).rejects.toMatchObject({ code: '23514' });
  },
);
it('keeps known provider-attempt identity and reconciled usage immutable', async () => {
  const s = await scope(),
    r = await request(s),
    a = await attempt(r);
  await reserve(s, a, await budget(s));
  await worker.query(
    "UPDATE app.ai_attempts SET state='started',started_at=now(),provider_request_id='synthetic-provider-1' WHERE id=$1",
    [a],
  );
  await worker.query(
    "UPDATE app.ai_attempts SET state='succeeded',finished_at=clock_timestamp() WHERE id=$1",
    [a],
  );
  await expect(
    worker.query(
      "UPDATE app.ai_attempts SET provider_request_id='synthetic-provider-2' WHERE id=$1",
      [a],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await worker.query(
    "UPDATE app.ai_attempts SET cost_minor=25,cost_status='reconciled' WHERE id=$1",
    [a],
  );
  await expect(
    worker.query('UPDATE app.ai_attempts SET cost_minor=50 WHERE id=$1', [a]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('atomically admits only one of two competing last-funds reservations', async () => {
  const s = await scope(),
    one = await request(s),
    two = await request(s),
    a = await attempt(one),
    b = await attempt(two),
    window = await budget(s, 100);
  const results = await Promise.allSettled([
    reserve(s, a, window, 100, worker),
    reserve(s, b, window, 100, competitor),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(await balance(window)).toEqual({ reserved: '100', spent: '0' });
});
it('refuses direct counter/config edits and foreign currency/policy admission', async () => {
  const s = await scope(),
    other = await scope(),
    a = await attempt(await request(s)),
    window = await budget(s, 100);
  await expect(
    worker.query('UPDATE app.ai_budget_windows SET reserved_minor=0 WHERE id=$1', [window]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    fixture.admin.query('UPDATE app.ai_budget_windows SET limit_minor=1000 WHERE id=$1', [window]),
  ).rejects.toMatchObject({ code: '23514' });
  // Parent FKs reject these before the AFTER accounting trigger can change counters.
  await expect(reserve(s, a, await budget(other), 1)).rejects.toMatchObject({ code: '23503' });
  await expect(reserve(s, a, window, 1, worker, 'CAD')).rejects.toMatchObject({ code: '23503' });
  expect(await balance(window)).toEqual({ reserved: '0', spent: '0' });
});
it('does not reserve funds for an expired request', async () => {
  const s = await scope(),
    window = await budget(s),
    r = await request(s, { parameters: { usage: 'commute' } }, randomUUID(), 2),
    a = await attempt(r);
  await fixture.admin.query(
    'SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (expires_at-clock_timestamp())))::double precision+0.05) FROM app.ai_analysis_requests WHERE id=$1',
    [r.id],
  );
  await expect(reserve(s, a, window)).rejects.toMatchObject({ code: '23514' });
});
it('keeps unknown charges reserved and settles one time without releasing issued usage', async () => {
  const s = await scope(),
    r = await request(s),
    a = await attempt(r),
    b = await budget(s, 100),
    hold = await reserve(s, a, b, 100);
  await worker.query("UPDATE app.ai_attempts SET state='started',started_at=now() WHERE id=$1", [
    a,
  ]);
  await worker.query(
    "UPDATE app.ai_attempts SET state='uncertain',error_code='unknown_charge' WHERE id=$1",
    [a],
  );
  await worker.query("UPDATE app.ai_budget_reservations SET state='uncertain' WHERE id=$1", [hold]);
  expect(await balance(b)).toEqual({ reserved: '100', spent: '0' });
  await expect(
    worker.query("UPDATE app.ai_budget_reservations SET state='reserved' WHERE id=$1", [hold]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    worker.query(
      "UPDATE app.ai_budget_reservations SET state='released',release_reason='not_dispatched',reconciled_at=now(),evidence_id=$2 WHERE id=$1",
      [hold, await audit()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await worker.query(
    "UPDATE app.ai_budget_reservations SET state='settled',settled_minor=60,reconciled_at=now() WHERE id=$1",
    [hold],
  );
  await worker.query('UPDATE app.ai_budget_reservations SET state=state WHERE id=$1', [hold]);
  expect(await balance(b)).toEqual({ reserved: '0', spent: '60' });
  await expect(
    worker.query(
      "UPDATE app.ai_budget_reservations SET state='released',settled_minor=NULL,release_reason='confirmed_not_charged',evidence_id=$2 WHERE id=$1",
      [hold, await audit()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('releases a definitively reconciled unknown charge and records explicit evidence', async () => {
  const s = await scope(),
    r = await request(s),
    a = await attempt(r),
    b = await budget(s),
    hold = await reserve(s, a, b);
  await worker.query("UPDATE app.ai_attempts SET state='started',started_at=now() WHERE id=$1", [
    a,
  ]);
  await worker.query("UPDATE app.ai_budget_reservations SET state='uncertain' WHERE id=$1", [hold]);
  await worker.query(
    "UPDATE app.ai_budget_reservations SET state='released',release_reason='confirmed_not_charged',evidence_id=$2,reconciled_at=now() WHERE id=$1",
    [hold, await audit()],
  );
  expect(await balance(b)).toEqual({ reserved: '0', spent: '0' });
});
it('rolls back counter changes when a reservation insertion fails or its transaction aborts', async () => {
  const s = await scope(),
    r = await request(s),
    a = await attempt(r),
    b = await budget(s, 200);
  await worker.query('BEGIN');
  try {
    await reserve(s, a, b);
    await worker.query('ROLLBACK');
  } finally {
    await worker.query('ROLLBACK');
  }
  expect(await balance(b)).toEqual({ reserved: '0', spent: '0' });
  await reserve(s, a, b);
  await expect(reserve(s, a, b)).rejects.toMatchObject({ code: '23505' });
  expect(await balance(b)).toEqual({ reserved: '100', spent: '0' });
});
it.each(['NOTHING', 'UPDATE SET state=app.ai_budget_reservations.state'])(
  'conserves budget totals across idempotent reservation retries with DO %s',
  async (action) => {
    const s = await scope(),
      a = await attempt(await request(s)),
      b = await budget(s, 1000);
    await reserve(s, a, b);
    for (let i = 0; i < 2; i++)
      await worker.query(
        `INSERT INTO app.ai_budget_reservations(id,budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,$4,'USD',100) ON CONFLICT(budget_id,attempt_id) DO ${action}`,
        [randomUUID(), b, a, s.policy],
      );
    expect(await balance(b)).toEqual({ reserved: '100', spent: '0' });
    expect(
      (
        await worker.query(
          'SELECT count(*)::integer AS count,sum(reserved_minor)::text AS total FROM app.ai_budget_reservations WHERE budget_id=$1',
          [b],
        )
      ).rows,
    ).toEqual([{ count: 1, total: '100' }]);
  },
);
it('conserves one hold across concurrent conflicting reservation inserts', async () => {
  const s = await scope(),
    a = await attempt(await request(s)),
    b = await budget(s, 1000);
  await Promise.all(
    [worker, competitor].map((client) =>
      client.query(
        `INSERT INTO app.ai_budget_reservations(id,budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,$4,'USD',100) ON CONFLICT(budget_id,attempt_id) DO NOTHING`,
        [randomUUID(), b, a, s.policy],
      ),
    ),
  );
  expect(await balance(b)).toEqual({ reserved: '100', spent: '0' });
});
it('allows cost reconciliation after withdrawal without reopening AI processing', async () => {
  const s = await scope(),
    r = await request(s),
    a = await attempt(r),
    b = await budget(s),
    hold = await reserve(s, a, b);
  await worker.query("UPDATE app.ai_attempts SET state='started',started_at=now() WHERE id=$1", [
    a,
  ]);
  await worker.query("UPDATE app.ai_attempts SET state='uncertain' WHERE id=$1", [a]);
  await worker.query("UPDATE app.ai_budget_reservations SET state='uncertain' WHERE id=$1", [hold]);
  await staff.query(
    "UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1 WHERE scope_id=$1",
    [s.id],
  );
  await worker.query(
    "UPDATE app.ai_budget_reservations SET state='settled',settled_minor=25,reconciled_at=now() WHERE id=$1",
    [hold],
  );
  expect(await balance(b)).toEqual({ reserved: '0', spent: '25' });
  await expect(request(s)).rejects.toMatchObject({ code: '23514' });
  await expect(
    worker.query('DELETE FROM app.ai_budget_reservations WHERE id=$1', [hold]),
  ).rejects.toMatchObject({ code: '42501' });
});
it('stores accepted scoped artifacts with sealed sources and immutable output bytes', async () => {
  const s = await scope(),
    a = await artifact(await request(s));
  expect(
    (
      await ownerContext(
        s.owner!,
        async () =>
          (await reader.query('SELECT id,output FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
      )
    )[0]?.id,
  ).toBe(a.id);
  await expect(
    fixture.admin.query("UPDATE app.ai_artifacts SET output='{}' WHERE id=$1", [a.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    worker.query(
      "INSERT INTO app.ai_artifact_sources(artifact_id,source_key,dataset_version_id,claim_hash,rights_valid_until) VALUES($1,'late',$2,$3,now()+interval '1 day')",
      [a.id, source, digest()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('refuses wrong output hashes, incomplete source sets and source validity shorter than the artifact', async () => {
  const s = await scope();
  await expect(artifact(await request(s), { outputHash: digest() })).rejects.toMatchObject({
    code: '23514',
  });
  await expect(artifact(await request(s), { sourceCount: 2 })).rejects.toMatchObject({
    code: '23514',
  });
  await expect(
    artifact(await request(s), { rightsSeconds: 10, validSeconds: 20 }),
  ).rejects.toMatchObject({ code: '23514' });
});
it.each(['permission_revision', 'invalidation_revision'])(
  'rejects an old accepted request even when an artifact copies current %s',
  async (field) => {
    const s = await scope(),
      r = await request(s);
    await expect(
      artifact(r, {
        useCurrentRevisions: true,
        beforeInsert: async () => {
          await staff.query(
            `UPDATE app.ai_scope_guards SET ${field}=${field}+1 WHERE scope_id=$1`,
            [s.id],
          );
        },
      }),
    ).rejects.toMatchObject({ code: '23514' });
  },
);
it('hides an artifact after a partial privileged source purge instead of treating an empty set as valid', async () => {
  const s = await scope(),
    a = await artifact(await request(s));
  await fixture.admin.query('DELETE FROM app.ai_artifact_sources WHERE artifact_id=$1', [a.id]);
  expect(
    await ownerContext(
      s.owner!,
      async () => (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
    ),
  ).toEqual([]);
});
it('claims one exact key across real worker connections and denies direct lease mutation', async () => {
  const s = await scope(),
    r = await request(s),
    one = randomUUID(),
    two = randomUUID();
  const claimed = await Promise.all([
    worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)::text AS fence', [s.id, r.hash, one]),
    competitor.query('SELECT app.ai_claim_reuse($1,$2,$3,30)::text AS fence', [s.id, r.hash, two]),
  ]);
  expect(claimed.map((x) => x.rows[0]!.fence).sort()).toEqual(['1', null].sort());
  await expect(
    worker.query('UPDATE app.ai_reuse_entries SET fence=0 WHERE scope_id=$1', [s.id]),
  ).rejects.toMatchObject({ code: '42501' });
});
it('rejects old/foreign fences after actual lease expiry and permits the current winning generation', async () => {
  const s = await scope(),
    r = await request(s),
    a = await artifact(r),
    first = randomUUID(),
    second = randomUUID();
  expect(
    (
      await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,1)::text AS fence', [
        s.id,
        r.hash,
        first,
      ])
    ).rows,
  ).toEqual([{ fence: '1' }]);
  await fixture.admin.query('SELECT pg_sleep(1.1)');
  expect(
    (
      await competitor.query('SELECT app.ai_claim_reuse($1,$2,$3,30)::text AS fence', [
        s.id,
        r.hash,
        second,
      ])
    ).rows,
  ).toEqual([{ fence: '2' }]);
  expect(
    (
      await worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4) AS accepted', [
        s.id,
        r.hash,
        first,
        a.id,
      ])
    ).rows,
  ).toEqual([{ accepted: false }]);
  expect(
    (
      await competitor.query('SELECT app.ai_publish_reuse($1,$2,$3,2,$4) AS accepted', [
        s.id,
        r.hash,
        second,
        a.id,
      ])
    ).rows,
  ).toEqual([{ accepted: true }]);
});
it('never substitutes another owner artifact for the requested scope and exact key', async () => {
  const s = await scope(),
    other = await scope(),
    r = await request(s),
    a = await artifact(await request(other)),
    holder = randomUUID();
  await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, r.hash, holder]);
  expect(
    (
      await worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4) AS accepted', [
        s.id,
        r.hash,
        holder,
        a.id,
      ])
    ).rows,
  ).toEqual([{ accepted: false }]);
});
it('fences invalidated or withdrawn work and hides previously accepted private output', async () => {
  const s = await scope(),
    r = await request(s),
    a = await artifact(r),
    holder = randomUUID();
  await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, r.hash, holder]);
  await staff.query(
    'UPDATE app.ai_scope_guards SET invalidation_revision=invalidation_revision+1 WHERE scope_id=$1',
    [s.id],
  );
  expect(
    (
      await worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4) AS accepted', [
        s.id,
        r.hash,
        holder,
        a.id,
      ])
    ).rows,
  ).toEqual([{ accepted: false }]);
  expect(
    await ownerContext(
      s.owner!,
      async () => (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
    ),
  ).toEqual([]);
  await staff.query(
    "UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1 WHERE scope_id=$1",
    [s.id],
  );
  await expect(
    worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, r.hash, holder]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('rechecks source-to-AI rights on reads without waiting for invalidation jobs', async () => {
  const s = await scope(),
    a = await artifact(await request(s));
  const holder = randomUUID();
  await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, a.request.hash, holder]);
  await worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4)', [
    s.id,
    a.request.hash,
    holder,
    a.id,
  ]);
  expect(
    (
      await worker.query(
        'SELECT artifact_id FROM app.ai_current_reuse WHERE scope_id=$1 AND cache_key=$2',
        [s.id, a.request.hash],
      )
    ).rows,
  ).toEqual([{ artifact_id: a.id }]);
  try {
    await fixture.admin.query(
      "UPDATE app.data_licenses SET rights=rights-'ai_processing' WHERE id=$1",
      [license],
    );
    expect(
      (
        await worker.query(
          'SELECT artifact_id FROM app.ai_current_reuse WHERE scope_id=$1 AND cache_key=$2',
          [s.id, a.request.hash],
        )
      ).rows,
    ).toEqual([]);
    expect(
      await ownerContext(
        s.owner!,
        async () =>
          (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
      ),
    ).toEqual([]);
  } finally {
    await fixture.admin.query(
      'UPDATE app.data_licenses SET rights=rights||\'{"ai_processing":true}\' WHERE id=$1',
      [license],
    );
  }
});
it.each(['cache', 'derived', 'snapshot', 'display', 'api'])(
  'requires current %s rights as well as AI processing rights',
  async (right) => {
    const s = await scope(),
      a = await artifact(await request(s));
    try {
      await fixture.admin.query(
        "UPDATE app.data_licenses SET rights=jsonb_set(rights,ARRAY[$2::text],'false'::jsonb) WHERE id=$1",
        [license, right],
      );
      expect(
        await ownerContext(
          s.owner!,
          async () =>
            (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
        ),
      ).toEqual([]);
    } finally {
      await fixture.admin.query(
        "UPDATE app.data_licenses SET rights=jsonb_set(rights,ARRAY[$2::text],'true'::jsonb) WHERE id=$1",
        [license, right],
      );
    }
  },
);
it.each(['unsupported_schema', 'future_review'])(
  'hides output and reuse when the common source eligibility boundary rejects %s',
  async (change) => {
    const s = await scope(),
      a = await artifact(await request(s)),
      holder = randomUUID();
    await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, a.request.hash, holder]);
    await worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4)', [
      s.id,
      a.request.hash,
      holder,
      a.id,
    ]);
    const original = (
      await fixture.admin.query(
        'SELECT rights_schema_version,reviewed_at FROM app.data_licenses WHERE id=$1',
        [license],
      )
    ).rows[0]!;
    try {
      await fixture.admin.query(
        change === 'unsupported_schema'
          ? 'UPDATE app.data_licenses SET rights_schema_version=2 WHERE id=$1'
          : "UPDATE app.data_licenses SET reviewed_at=now()+interval '1 day' WHERE id=$1",
        [license],
      );
      expect(
        (await worker.query('SELECT app.ai_artifact_current($1) AS current', [a.id])).rows,
      ).toEqual([{ current: false }]);
      expect(
        (
          await worker.query(
            'SELECT artifact_id FROM app.ai_current_reuse WHERE scope_id=$1 AND cache_key=$2',
            [s.id, a.request.hash],
          )
        ).rows,
      ).toEqual([]);
      expect(
        await ownerContext(
          s.owner!,
          async () =>
            (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
        ),
      ).toEqual([]);
    } finally {
      await fixture.admin.query(
        'UPDATE app.data_licenses SET rights_schema_version=$2,reviewed_at=$3 WHERE id=$1',
        [license, original.rights_schema_version, original.reviewed_at],
      );
    }
  },
);
it('attaches only a current matching owner report and exposes a bounded owner projection', async () => {
  const own = await ownReport(),
    a = await artifact(await request(own.s, own.manifest));
  await attach(a, own.report.head.id, own.s.owner!);
  const result = await ownerContext(
    own.s.owner!,
    async () =>
      (
        await reader.query('SELECT * FROM app.ai_report_analysis WHERE report_id=$1', [
          own.report.head.id,
        ])
      ).rows,
  );
  expect(result).toHaveLength(1);
  expect(Object.keys(result[0]!).sort()).toEqual(
    [
      'report_id',
      'report_version',
      'revision',
      'selection_kind',
      'output',
      'generated_at',
      'valid_until',
    ].sort(),
  );
  expect(
    await ownerContext(
      (await scope()).owner!,
      async () =>
        (
          await reader.query('SELECT * FROM app.ai_report_analysis WHERE report_id=$1', [
            own.report.head.id,
          ])
        ).rows,
    ),
  ).toEqual([]);
  await expect(
    fixture.admin.query(
      'UPDATE app.report_analysis_attachments SET revision=2 WHERE report_id=$1',
      [own.report.head.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it('does not attach different authoritative inputs or another report owner', async () => {
  const own = await ownReport(),
    other = await ownReport(),
    a = await artifact(await request(own.s, { ...own.manifest, authoritative_hash: digest() }));
  await expect(attach(a, own.report.head.id, own.s.owner!)).rejects.toMatchObject({
    code: '23514',
  });
  const b = await artifact(await request(own.s, own.manifest));
  await expect(attach(b, other.report.head.id, other.s.owner!, own.s)).rejects.toMatchObject({
    code: '23514',
  });
});
it('requires separate explicit owner authorization for shared template attachment', async () => {
  const shared = await scope({ kind: 'shared' }),
    a = await artifact(await request(shared)),
    own = await ownReport();
  await expect(attach(a, own.report.head.id, own.s.owner!, shared)).rejects.toMatchObject({
    code: '23514',
  });
  await attach(a, own.report.head.id, own.s.owner!, own.s);
  expect(
    await ownerContext(
      own.s.owner!,
      async () => (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
    ),
  ).toEqual([]);
  expect(
    await ownerContext(
      own.s.owner!,
      async () =>
        (
          await reader.query('SELECT revision FROM app.ai_report_analysis WHERE report_id=$1', [
            own.report.head.id,
          ])
        ).rows,
    ),
  ).toHaveLength(1);
  await fixture.admin.query(
    'UPDATE app.subjects SET permission_revision=permission_revision+1 WHERE id=$1',
    [own.s.owner],
  );
  expect(
    await ownerContext(
      own.s.owner!,
      async () =>
        (
          await reader.query('SELECT revision FROM app.ai_report_analysis WHERE report_id=$1', [
            own.report.head.id,
          ])
        ).rows,
    ),
  ).toEqual([]);
});
async function sendFor(own: Awaited<ReturnType<typeof ownReport>>) {
  const id = randomUUID(),
    contact = await fixture.contact(),
    template = await fixture.template();
  await fixture.admin.query(
    `INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,report_id,report_version,template_id,send_after,cancel_deadline,provider_key,provider,requested_purposes,dispatch_policy_version,authorized_consent_revision)
 VALUES($1,'report',$2,$3,$4,1,$5,now()+interval '120 seconds',now()+interval '120 seconds',$6,'synthetic','["report"]','synthetic-v1',1)`,
    [id, contact.value.id, own.s.owner, own.report.head.id, template, 'ai-synthetic:' + id],
  );
  return id;
}
it('freezes one immutable attachment or explicit no-AI selection per matching send', async () => {
  const own = await ownReport(),
    a = await artifact(await request(own.s, own.manifest));
  await attach(a, own.report.head.id, own.s.owner!);
  const send = await sendFor(own),
    fallback = await sendFor(own);
  await worker.query(
    "INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,attachment_revision) VALUES($1,$2,$3,1,'artifact',1)",
    [send, own.s.owner, own.report.head.id],
  );
  await worker.query(
    "INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,fallback_reason) VALUES($1,$2,$3,1,'none','not_requested')",
    [fallback, own.s.owner, own.report.head.id],
  );
  await expect(
    fixture.admin.query(
      "UPDATE email.analysis_selections SET mode='none',attachment_revision=NULL,fallback_reason='unavailable' WHERE send_id=$1",
      [send],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    worker.query(
      "INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,fallback_reason) VALUES($1,$2,$3,1,'none','unavailable')",
      [send, own.s.owner, own.report.head.id],
    ),
  ).rejects.toMatchObject({ code: '23505' });
});
it('refuses retroactive frozen selections and a stale attachment at freeze time', async () => {
  const own = await ownReport(),
    a = await artifact(await request(own.s, own.manifest));
  await attach(a, own.report.head.id, own.s.owner!);
  const send = await sendFor(own),
    payload = await fixture.asset('email_payload');
  await fixture.admin.query(
    'UPDATE email.email_sends SET payload_asset_id=$2,payload_hash=$3 WHERE id=$1',
    [send, payload.id, payload.hash],
  );
  await expect(
    worker.query(
      "INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,fallback_reason) VALUES($1,$2,$3,1,'none','unavailable')",
      [send, own.s.owner, own.report.head.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const fresh = await sendFor(own);
  await staff.query(
    'UPDATE app.ai_scope_guards SET invalidation_revision=invalidation_revision+1 WHERE scope_id=$1',
    [own.s.id],
  );
  await expect(
    worker.query(
      "INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,attachment_revision) VALUES($1,$2,$3,1,'artifact',1)",
      [fresh, own.s.owner, own.report.head.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
it.each([
  { mode: 'artifact', change: 'expired' },
  { mode: 'artifact', change: 'pending_deletion' },
  { mode: 'none', change: 'expired' },
  { mode: 'none', change: 'pending_deletion' },
])('refuses $mode selection after report becomes $change', async ({ mode, change }) => {
  const own = await ownReport(),
    a = await artifact(await request(own.s, own.manifest));
  await attach(a, own.report.head.id, own.s.owner!);
  const send = await sendFor(own);
  await fixture.admin.query(
    change === 'expired'
      ? 'UPDATE app.reports SET expires_at=clock_timestamp() WHERE id=$1'
      : "UPDATE app.reports SET status='pending_deletion' WHERE id=$1",
    [own.report.head.id],
  );
  await expect(
    worker.query(
      'INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,attachment_revision,fallback_reason) VALUES($1,$2,$3,1,$4,$5,$6)',
      [
        send,
        own.s.owner,
        own.report.head.id,
        mode,
        mode === 'artifact' ? 1 : null,
        mode === 'none' ? 'unavailable' : null,
      ],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await worker.query('SELECT send_id FROM email.analysis_selections WHERE send_id=$1', [send]))
      .rows,
  ).toEqual([]);
});
it.each(['freeze_first', 'revoke_first'])(
  'serializes frozen AI selection with report revocation in order %s',
  async (order) => {
    const own = await ownReport(),
      a = await artifact(await request(own.s, own.manifest));
    await attach(a, own.report.head.id, own.s.owner!);
    const send = await sendFor(own),
      select = () =>
        worker.query(
          "INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,attachment_revision) VALUES($1,$2,$3,1,'artifact',1)",
          [send, own.s.owner, own.report.head.id],
        );
    await worker.query('BEGIN');
    await fixture.admin.query('BEGIN');
    try {
      if (order === 'freeze_first') {
        await select();
        await fixture.admin.query("SET LOCAL lock_timeout='200ms'");
        await expect(
          fixture.admin.query("UPDATE app.reports SET status='pending_deletion' WHERE id=$1", [
            own.report.head.id,
          ]),
        ).rejects.toMatchObject({ code: '55P03' });
      } else {
        await fixture.admin.query("UPDATE app.reports SET status='pending_deletion' WHERE id=$1", [
          own.report.head.id,
        ]);
        await worker.query("SET LOCAL lock_timeout='200ms'");
        await expect(select()).rejects.toMatchObject({ code: '55P03' });
        await worker.query('ROLLBACK');
        await fixture.admin.query('COMMIT');
        await expect(select()).rejects.toMatchObject({ code: '23514' });
      }
    } finally {
      await Promise.all([worker.query('ROLLBACK'), fixture.admin.query('ROLLBACK')]);
    }
  },
);
it('binds a terminal deletion guard to the existing privacy request owner and prevents recreation', async () => {
  const s = await scope(),
    r = await request(s),
    a = await artifact(r),
    deletion = randomUUID(),
    holder = randomUUID();
  await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, r.hash, holder]);
  await fixture.admin.query(
    "INSERT INTO privacy.privacy_requests(id,subject_id,kind,jurisdiction,policy_version,status,due_at) VALUES($1,$2,'delete','synthetic','synthetic','pending',now()+interval '1 day')",
    [deletion, s.owner],
  );
  await staff.query(
    "UPDATE app.ai_scope_guards SET state='deleting',processing_allowed=false,permission_revision=permission_revision+1,deletion_request_id=$2 WHERE scope_id=$1",
    [s.id, deletion],
  );
  await expect(
    worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4)', [s.id, r.hash, holder, a.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    staff.query(
      "UPDATE app.ai_scope_guards SET state='active',processing_allowed=true,permission_revision=permission_revision+1,deletion_request_id=NULL WHERE scope_id=$1",
      [s.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    await ownerContext(
      s.owner!,
      async () => (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
    ),
  ).toEqual([]);
});
it.each(['withdrawn', 'blocked'])(
  'serializes publication with concurrent permission or policy %s',
  async (change) => {
    const s = await scope(),
      r = await request(s),
      a = await artifact(r),
      holder = randomUUID();
    await worker.query('SELECT app.ai_claim_reuse($1,$2,$3,30)', [s.id, r.hash, holder]);
    const sql =
      change === 'withdrawn'
        ? "UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1 WHERE scope_id=$1"
        : "UPDATE app.ai_policy_versions SET status='blocked' WHERE id=$1";
    const id = change === 'withdrawn' ? s.id : s.policy;
    await worker.query('BEGIN');
    try {
      expect(
        (
          await worker.query('SELECT app.ai_publish_reuse($1,$2,$3,1,$4) AS accepted', [
            s.id,
            r.hash,
            holder,
            a.id,
          ])
        ).rows,
      ).toEqual([{ accepted: true }]);
      await staff.query('BEGIN');
      await staff.query("SET LOCAL lock_timeout='200ms'");
      await expect(staff.query(sql, [id])).rejects.toMatchObject({ code: '55P03' });
      await staff.query('ROLLBACK');
      await worker.query('COMMIT');
      await staff.query(sql, [id]);
      expect(
        await ownerContext(
          s.owner!,
          async () =>
            (await reader.query('SELECT id FROM app.ai_artifacts WHERE id=$1', [a.id])).rows,
        ),
      ).toEqual([]);
    } finally {
      await Promise.all([worker.query('ROLLBACK'), staff.query('ROLLBACK')]);
    }
  },
);
it('serializes a current report attachment against concurrent report revocation', async () => {
  const own = await ownReport(),
    a = await artifact(await request(own.s, own.manifest));
  await worker.query('BEGIN');
  try {
    await attach(a, own.report.head.id, own.s.owner!);
    await fixture.admin.query('BEGIN');
    await fixture.admin.query("SET LOCAL lock_timeout='200ms'");
    await expect(
      fixture.admin.query("UPDATE app.reports SET status='pending_deletion' WHERE id=$1", [
        own.report.head.id,
      ]),
    ).rejects.toMatchObject({ code: '55P03' });
    await fixture.admin.query('ROLLBACK');
    await worker.query('COMMIT');
    await fixture.admin.query("UPDATE app.reports SET status='pending_deletion' WHERE id=$1", [
      own.report.head.id,
    ]);
    expect(
      await ownerContext(
        own.s.owner!,
        async () =>
          (
            await reader.query('SELECT * FROM app.ai_report_analysis WHERE report_id=$1', [
              own.report.head.id,
            ])
          ).rows,
      ),
    ).toEqual([]);
  } finally {
    await Promise.all([worker.query('ROLLBACK'), fixture.admin.query('ROLLBACK')]);
  }
});
it('uses the lease expiry index for a bounded maintenance page over ten thousand synthetic rows', async () => {
  const s = await scope();
  await fixture.admin.query(
    `INSERT INTO app.ai_reuse_entries(scope_id,cache_key,policy_version_id,state,lease_holder,lease_until,fence,permission_revision,invalidation_revision)
 SELECT $1,encode(sha256(convert_to(n::text,'UTF8')),'hex'),$2,'leased',$3,now()-make_interval(secs=>n),1,1,0 FROM generate_series(1,10000) n`,
    [s.id, s.policy, randomUUID()],
  );
  await fixture.admin.query('ANALYZE app.ai_reuse_entries');
  const cutoff = (await fixture.admin.query('SELECT now() AS cutoff')).rows[0]!.cutoff;
  const result = await fixture.admin.query(
    "EXPLAIN (ANALYZE,FORMAT JSON) SELECT scope_id,cache_key FROM app.ai_reuse_entries WHERE state='leased' AND lease_until<$1 ORDER BY lease_until,scope_id,cache_key LIMIT 51",
    [cutoff],
  );
  const plan = result.rows[0]!['QUERY PLAN'][0],
    rows = await fixture.admin.query(
      "SELECT scope_id,cache_key FROM app.ai_reuse_entries WHERE state='leased' AND lease_until<$1 ORDER BY lease_until,scope_id,cache_key LIMIT 51",
      [cutoff],
    );
  expect(rows.rows).toHaveLength(51);
  expect(JSON.stringify(plan)).toContain('ai_reuse_lease_idx');
  console.log(
    'P2_AI_QUERY_EVIDENCE ' +
      JSON.stringify({
        syntheticRows: 10000,
        returned: 51,
        indexed: true,
        executionMs: plan['Execution Time'],
        productionSlaAccepted: false,
      }),
  );
});
it('rejects changed source checksums and atomically rolls back failed extension DDL/history', async () => {
  const sources = aiSources().sources,
    changed = sources.map((s, i) =>
      i === sources.length - 1 ? { ...s, source: s.source + '\n-- changed' } : s,
    );
  await expect(migrateApplication(fixture.target, changed)).rejects.toThrow('checksum');
  const source = 'CREATE TABLE app.ai_failed_extension(id integer); SELECT 1/0;',
    bad = {
      id: '0040_ai_failed_extension',
      source,
      sha256: createHash('sha256').update(source).digest('hex'),
    };
  await expect(migrateApplication(fixture.target, [...sources, bad])).rejects.toMatchObject({
    code: '22012',
  });
  expect(
    (await fixture.admin.query("SELECT to_regclass('app.ai_failed_extension') AS relation")).rows,
  ).toEqual([{ relation: null }]);
  expect(await fixture.installAi()).toBe(0);
  console.log(
    'P2_AI_SCHEMA_EVIDENCE ' +
      JSON.stringify({
        optInLocalTrack: true,
        localMigrations: 3,
        newTables: 12,
        forcedRls: true,
        preservedTables: 164,
        preservedMigrationPrefix: 36,
        existingPermissionsPreserved: true,
        restrictedRuntimeLogins: 3,
        realBudgetAndLeaseRaces: true,
        ownerAndSharedSeparated: true,
        sourceSetSealed: true,
        frozenSelectionImmutable: true,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        actualModelEvaluation: false,
        actualPrivacyAcceptance: false,
        productionBootstrapChanged: false,
        productionActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
