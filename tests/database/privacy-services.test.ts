import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { privateFixture, uid, time, success, key } from '../fixtures/private/database.ts';
import { createPrivacyRuntime } from '../../packages/integrations/src/privacy-runtime.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createPrivacyServiceRepository } from '../../packages/db/src/repositories/privacy-services.ts';
import { ok, type Result, type Id } from '../../packages/domain/src/values/core.ts';
import type {
  JournalEntry,
  SignedPrivacyRecord,
  PrivacyMail,
} from '../../packages/application/src/ports/privacy-services.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
const crypto = createPrivacyCrypto('p1', { p1: new Uint8Array(32).fill(13) }),
  contacts = createContactCrypto(
    't1',
    { t1: new Uint8Array(32).fill(14) },
    { 'test-hmac-v1': new Uint8Array(32).fill(15) },
    new Uint8Array(32).fill(16),
  );
const policy = { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 };
beforeAll(async () => {
  f = await privateFixture();
  for (const kind of ['delete', 'restrict', 'opt_out', 'access', 'export', 'correct'])
    await f.admin.query(
      `INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'synthetic','p25',$2,now())`,
      ['rights:' + kind, policy],
    );
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
beforeEach(async () => {
  // Every scenario owns its journal; previous cases must not supply unrelated replay markers.
  await f.admin.query('TRUNCATE privacy.deletion_markers,privacy.suppression_tombstones');
});
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
async function setup(
  options: {
    mailResult?: 'erased' | 'unsupported';
    journalFail?: boolean;
    objectFail?: boolean;
  } = {},
) {
  const scope = f.adapter('tt_privacy_runtime'),
    repo = createPrivacyServiceRepository(scope, 'synthetic-private', ['fixture-kms']),
    entries = new Map<string, SignedPrivacyRecord>(),
    emails: { address: string; proof: string }[] = [],
    erased: string[] = [];
  const mail: PrivacyMail = {
    async verify(x) {
      emails.push(x);
    },
    async erase(x) {
      erased.push(x.deliveryKey);
      return options.mailResult ?? 'erased';
    },
  };
  const runtime = await createPrivacyRuntime({
    scope,
    crypto,
    contacts,
    policyVersion: 'p25',
    now: () => time(),
    assetBucket: 'synthetic-private',
    assetKeyVersions: ['fixture-kms'],
    encryption: {
      async encrypt(b) {
        return { keyVersion: 'test-enc-v1', hex: Buffer.from(b).toString('hex') };
      },
      async decrypt(e) {
        return Buffer.from(e.hex, 'hex');
      },
    },
    journal: {
      async append(k, r) {
        if (options.journalFail) throw Error('Fixture unavailable');
        entries.set(k, r);
      },
    },
    mail,
    objects: {
      async put() {
        return 'fixture';
      },
      async get() {
        return new Uint8Array();
      },
      async erase(a) {
        if (options.objectFail) throw Error('Fixture unavailable');
        erased.push(a.id);
      },
    },
  });
  async function settle(id: Id<'privacy_request'>) {
    await f.admin.query(
      'UPDATE privacy.request_work SET barrier_until=clock_timestamp(),next_attempt_at=clock_timestamp() WHERE request_id=$1',
      [id],
    );
  }
  async function drain(id: Id<'privacy_request'>) {
    await settle(id);
    for (let i = 0; i < 40; i++) {
      const r = value(await runtime.workOne(id));
      if (r?.status === 'completed' || r?.status === 'manual_review') return r.status;
      const row = (
        await f.admin.query('SELECT status FROM privacy.privacy_requests WHERE id=$1', [id])
      ).rows[0];
      if (row.status === 'manual_review') {
        const diagnostic = (
          await f.admin.query(
            'SELECT store,status FROM privacy.fulfillment_steps WHERE request_id=$1 ORDER BY store',
            [id],
          )
        ).rows;
        // Synthetic-only diagnostics identify the failed graph stage without real private records.
        if (!options.journalFail && options.mailResult !== 'unsupported' && !options.objectFail)
          throw Error('Unexpected manual review: ' + JSON.stringify(diagnostic));
        return 'manual_review';
      }
      await settle(id);
    }
    throw Error('Fixture did not drain');
  }
  return { ...runtime, scope, repo, entries, emails, erased, settle, drain };
}
async function contact(email = 'privacy-' + uid('tag') + '@example.test') {
  const c = await success(f.scope.unitOfWork, (tx) =>
    f.privacy.registerContact(tx, {
      id: uid('contact'),
      subjectId: uid('subject'),
      keys: contacts.emailKeys(email),
      envelope: { keyVersion: 'test-enc-v1', hex: Buffer.from(email).toString('hex') },
    }),
  );
  return { email, c };
}
async function mailGraph() {
  const o = await f.owner(),
    r = await f.report(o.identity),
    c = await contact(),
    notice = await f.notice('report'),
    challenge = uid('verification'),
    pdf = await f.asset(),
    payload = await f.asset('email_payload');
  await f.admin.query(
    "UPDATE app.object_assets SET key_version='fixture-kms' WHERE id=ANY($1::uuid[])",
    [[pdf.id, payload.id]],
  );
  const permission = await success(f.scope.unitOfWork, async (tx) => {
    const p = await f.privacy.permission(tx, c.c.subjectId, 'report', 'report:' + r.head.id + ':1');
    return f.privacy.consent(tx, {
      id: uid('consent_event'),
      subjectId: c.c.subjectId,
      purpose: 'report',
      scope: 'report:' + r.head.id + ':1',
      expectedRevision: p.revision,
      action: 'confirm',
      noticeId: notice,
      policyVersion: 'synthetic',
      method: 'fixture',
      expiresAt: null,
    });
  });
  await f.admin.query(
    `INSERT INTO privacy.verification_challenges(id,subject_id,purpose,token_hash,key_version,notice_id,expires_at) VALUES($1,$2,'report',$3,'fixture',$4,now()+interval '1 hour')`,
    [challenge, c.c.subjectId, Buffer.from(key().digest, 'hex'), notice],
  );
  await f.admin.query(
    `INSERT INTO privacy.contact_intents(challenge_id,contact_id,owner_subject_id,scope_key,policy_version,grant_event_id) VALUES($1,$2,$3,$4,'synthetic',$5)`,
    [challenge, c.c.id, o.identity.subjectId, 'report:' + r.head.id + ':1', permission.eventId],
  );
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.asset(tx, o.identity, {
      assetId: pdf.id,
      reportId: r.head.id,
      version: 1,
      comparisonRevision: null,
      rendererVersion: 'fixture',
      locale: 'en-US',
      scope: 'owner',
      renderKey: uid('render'),
    }),
  );
  const templateId = await f.template();
  const send = await success(f.scope.unitOfWork, (tx) =>
    f.delivery.schedule(tx, {
      id: uid('send'),
      owner: o.identity,
      contactId: c.c.id,
      kind: 'report',
      reportId: r.head.id,
      reportVersion: 1,
      comparisonRevision: null,
      templateId,
      provider: 'resend',
      providerKey: key().digest,
      delaySeconds: 60,
      policyVersion: 'synthetic',
      noticeId: notice,
      purposes: ['report'],
    }),
  );

  await f.admin.query(
    `INSERT INTO email.delivery_snapshots(send_id,verification_id,permission_event_id,document) VALUES($1,$2,$3,'{"fixture":true}')`,
    [send.id, challenge, permission.eventId],
  );
  await f.admin.query(
    `INSERT INTO email.delivery_work(send_id,next_attempt_at,payload_asset_id,pdf_asset_id,payload_hash) VALUES($1,now(),$2,$3,$4)`,
    [send.id, payload.id, pdf.id, payload.hash],
  );
  await f.admin.query(
    `INSERT INTO email.email_links(send_id,slot,purpose,approved_destination,token_hash,key_version,expires_at) VALUES($1,'feedback','feedback','https://example.test/feedback',$2,'fixture',now()+interval '1 hour')`,
    [send.id, Buffer.from(key().digest, 'hex')],
  );
  await f.admin.query(
    `INSERT INTO email.email_feedback(send_id,kind,value,submitted_at) VALUES($1,'helpful','yes',now())`,
    [send.id],
  );
  return { o, r, c, challenge, pdf, payload, permission, send };
}
it('refuses ordinary private runtime composition and unreviewed jurisdiction deadlines', async () => {
  const s = await setup(),
    o = await f.owner();
  expect(await s.requestOwner([o.token], 'delete', 'unknown', uid('command'))).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  const row = (
    await f.admin.query('SELECT status FROM app.subjects WHERE id=$1', [o.identity.subjectId])
  ).rows[0];
  expect(row.status).toBe('active');
  const denied = await f.scope.unitOfWork.run(async (tx) =>
    ok(await f.scope.query(tx, 'SELECT * FROM privacy.request_work')),
  );
  expect(denied.ok).toBe(false);
});
it('revokes browser/share authority immediately and waits for the in-flight I/O barrier', async () => {
  const s = await setup(),
    o = await f.owner(),
    r = await f.report(o.identity);
  const cap = key();
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.share(tx, o.identity, {
      id: uid('report_capability'),
      reportId: r.head.id,
      version: 1,
      key: cap,
      expiresAt: time(3600000),
    }),
  );
  const request = value(await s.requestOwner([o.token], 'delete', 'synthetic', uid('command')));
  expect(await success(f.scope.unitOfWork, (tx) => f.owners.resolve(tx, [o.token]))).toBeNull();
  expect(await success(f.scope.unitOfWork, (tx) => f.caps.resolveShare(tx, [cap]))).toBeNull();
  expect(value(await s.workOne(request.id))).toBeNull();
  expect(
    (await f.admin.query('SELECT status FROM app.reports WHERE id=$1', [r.head.id])).rows[0].status,
  ).toBe('pending_deletion');
  expect(value(await s.status(request.proof)).status).toBe('verified');
  expect(await s.requestOwner([cap], 'delete', 'synthetic', uid('command'))).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
it('erases full report snapshots, quotes, analytics and bound jobs while preserving another owner', async () => {
  const s = await setup(),
    o = await f.owner(),
    other = await f.owner(),
    r = await f.report(o.identity),
    keep = await f.report(other.identity);
  const quote = uid('quote');
  await f.admin.query(
    `INSERT INTO app.shop_quotes(id,report_id,source_key,currency,total_minor,quantity,basis,observed_on,components,expires_at) VALUES($1,$2,'fixture','USD',10000,4,'installed_set',current_date,'[]',now()+interval '1 day')`,
    [quote, r.head.id],
  );
  await f.admin.query(
    `INSERT INTO privacy.quote_private_data(quote_id,encrypted_notes,key_version,expires_at) VALUES($1,decode(repeat('ab',16),'hex'),'fixture',now()+interval '1 day')`,
    [quote],
  );
  await f.admin.query(
    `INSERT INTO app.comparisons(report_id,report_version,revision,scenario,schema_version,snapshot_hash) VALUES($1,1,1,'{}',1,repeat('ab',32))`,
    [r.head.id],
  );
  await f.admin.query(
    `INSERT INTO app.comparison_items(report_id,report_version,comparison_revision,slot,source_key,kind,snapshot) VALUES($1,1,1,1,'fixture','quote','{}')`,
    [r.head.id],
  );
  await f.admin.query(
    `INSERT INTO analytics.events(id,subject_id,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at) VALUES($1,$2,'public_page_view',1,now(),now(),'US','en-US','/','web',1,'synthetic','{}',decode(repeat('ab',32),'hex'),'not_flagged',now()+interval '1 month')`,
    [uid('event'), o.identity.subjectId],
  );
  await f.admin.query(
    `INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload) VALUES($1,'report',$2::uuid,'fixture',1,jsonb_build_object('resource_id',($2::uuid)::text))`,
    [uid('event'), r.head.id],
  );
  await f.admin.query(
    `INSERT INTO app.job_runs(job_type,business_key,schema_version,resource_id) VALUES('fixture',$1,1,$2)`,
    [uid('business'), r.head.id],
  );
  const request = value(await s.requestOwner([o.token], 'delete', 'synthetic', uid('command')));
  expect(await s.drain(request.id)).toBe('completed');
  for (const [table, column, id] of [
    ['app.subjects', 'id', o.identity.subjectId],
    ['app.reports', 'id', r.head.id],
    ['analytics.events', 'subject_id', o.identity.subjectId],
    ['app.report_versions', 'report_id', r.head.id],
  ])
    expect(
      (await f.admin.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [id])).rows,
    ).toHaveLength(0);
  expect(
    (await f.admin.query('SELECT 1 FROM app.reports WHERE id=$1', [keep.head.id])).rows,
  ).toHaveLength(1);
  expect(
    (await f.admin.query('SELECT state FROM app.job_runs WHERE resource_id=$1', [r.head.id]))
      .rows[0].state,
  ).toBe('cancelled');
  expect(
    (await f.admin.query('SELECT state FROM app.outbox WHERE aggregate_id=$1', [r.head.id])).rows[0]
      .state,
  ).toBe('cancelled');
  expect(s.entries.size).toBe(1);
  expect(
    (await f.admin.query('SELECT 1 FROM privacy.quote_private_data WHERE quote_id=$1', [quote]))
      .rows,
  ).toHaveLength(0);
  expect(value(await s.workOne(request.id))).toBeNull();
  expect(value(await s.status(request.proof))).toMatchObject({ status: 'completed' });
  expect(
    (
      await f.admin.query(
        'SELECT subject_id,encrypted_reply_context FROM privacy.privacy_requests WHERE id=$1',
        [request.id],
      )
    ).rows[0],
  ).toEqual({ subject_id: null, encrypted_reply_context: null });
});
it('purges attempted-send provider facts, callback observations and frozen mail bytes after acknowledgment', async () => {
  const s = await setup(),
    g = await mailGraph(),
    message = uid('message'),
    inbox = uid('inbox');
  await f.admin.query(
    `UPDATE email.email_sends SET dispatch_state='dispatching',claimed_at=send_after,payload_asset_id=$2,payload_hash=$3 WHERE id=$1`,
    [g.send.id, g.payload.id, g.payload.hash],
  );
  await f.admin.query(
    `UPDATE email.email_sends SET dispatch_state='accepted',accepted_at=claimed_at,provider_message_id=$2 WHERE id=$1`,
    [g.send.id, message],
  );
  await f.admin.query(
    `INSERT INTO app.webhook_inbox(id,provider,provider_event_id,payload_digest,received_at,signature_verified_at) VALUES($1,'resend',$2,decode(repeat('ab',32),'hex'),now(),now())`,
    [inbox, uid('callback')],
  );
  await f.admin.query(
    `INSERT INTO email.callback_observations(inbox_id,message_id,delivery_key,type,classification,occurred_at) VALUES($1,$2,$3,'delivered','unknown',now())`,
    [inbox, message, g.send.providerKey],
  );
  await f.admin.query(
    `INSERT INTO email.email_events(send_id,provider,provider_event_id,type,occurred_at,received_at,classification) VALUES($1,'resend',$2,'delivered',now(),now(),'unknown')`,
    [g.send.id, uid('event')],
  );
  const request = value(await s.requestOwner([g.o.token], 'delete', 'synthetic', uid('command')));
  expect(
    (
      await f.admin.query(
        'SELECT invalidated_at FROM privacy.verification_challenges WHERE id=$1',
        [g.challenge],
      )
    ).rows[0].invalidated_at,
  ).not.toBeNull();
  expect(await s.drain(request.id)).toBe('completed');
  expect(s.erased).toEqual(expect.arrayContaining([g.send.providerKey, g.pdf.id, g.payload.id]));
  expect(
    (await f.admin.query('SELECT 1 FROM email.callback_observations WHERE inbox_id=$1', [inbox]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await f.admin.query('SELECT 1 FROM app.webhook_inbox WHERE id=$1', [inbox])).rows,
  ).toHaveLength(0);
  expect(
    (await f.admin.query('SELECT 1 FROM privacy.contacts WHERE id=$1', [g.c.c.id])).rows,
  ).toHaveLength(1);
});
it('dry-runs and erases expired object versions with the existing private asset lifecycle', async () => {
  const s = await setup(),
    asset = await f.asset();
  await f.admin.query(
    `UPDATE app.object_assets SET key_version='fixture-kms',created_at=now()-interval '1 hour',expires_at=now()-interval '1 minute' WHERE id=$1`,
    [asset.id],
  );
  expect((await s.retentionAssets(true)).candidates).toBeGreaterThan(0);
  expect(s.erased).not.toContain(asset.id);
  expect((await s.retentionAssets(false)).erased).toBeGreaterThan(0);
  expect(s.erased).toContain(asset.id);
  expect(
    (await f.admin.query('SELECT state FROM app.object_assets WHERE id=$1', [asset.id])).rows[0]
      .state,
  ).toBe('deleted');
});
it('blocks registration of a reserved asset even when a renderer finishes after SQL erasure', async () => {
  const s = await setup(),
    g = await mailGraph(),
    late = contacts.id('asset', g.send.id + ':late');
  await f.admin.query(
    `INSERT INTO email.delivery_asset_reservations(send_id,asset_id,purpose) VALUES($1,$2,'email_payload')`,
    [g.send.id, late],
  );
  const request = value(await s.requestOwner([g.o.token], 'delete', 'synthetic', uid('command')));
  expect(await s.drain(request.id)).toBe('completed');
  await expect(
    f.admin.query(
      `INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type) VALUES($1,'email_payload','synthetic-private',$2,'application/json')`,
      [late, 'assets/' + late],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await f.admin.query('SELECT 1 FROM privacy.asset_barriers WHERE asset_id=$1', [late])).rows,
  ).toHaveLength(1);
});
it('recovers the same request receipt after a journal outage and after the owner session has been erased', async () => {
  const options = { journalFail: true },
    s = await setup(options),
    o = await f.owner(),
    command = uid('command');
  expect(await s.requestOwner([o.token], 'delete', 'synthetic', command)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  const existing = (
    await f.admin.query('SELECT id FROM privacy.privacy_requests WHERE subject_id=$1', [
      o.identity.subjectId,
    ])
  ).rows[0].id;
  options.journalFail = false;
  const retry = value(await s.requestOwner([o.token], 'delete', 'synthetic', command));
  expect(retry.id).toBe(existing);
  expect(await s.drain(retry.id)).toBe('completed');
  expect(value(await s.requestOwner([o.token], 'delete', 'synthetic', command))).toEqual(retry);
  expect(
    (
      await f.admin.query('SELECT 1 FROM app.owner_sessions WHERE subject_id=$1', [
        o.identity.subjectId,
      ])
    ).rows,
  ).toHaveLength(0);
});
it('returns the same public email receipt for known and absent addresses, requires a new purpose-bound proof', async () => {
  const s = await setup(),
    c = await contact();
  expect(value(await s.requestEmail(c.email, 'delete', 'synthetic'))).toEqual({ accepted: true });
  expect(
    value(await s.requestEmail('absent-' + uid('tag') + '@example.test', 'delete', 'synthetic')),
  ).toEqual({ accepted: true });
  const pending = (
    await f.admin.query(
      `SELECT id FROM privacy.privacy_requests WHERE status='pending' AND policy_version='p25' ORDER BY created_at DESC LIMIT 2`,
    )
  ).rows;
  for (const p of pending) value(await s.dispatchVerification(p.id));
  expect(s.emails).toHaveLength(2);
  const delivered = s.emails.find((x) => x.address === c.email)!;
  expect(await s.confirm(delivered.proof.replace('privacy.', 'verify.'))).toMatchObject({
    ok: false,
  });
  value(await s.confirm(delivered.proof));
  expect(await s.confirm(delivered.proof)).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  const id = crypto.parse(delivered.proof)!.id;
  expect(await s.drain(id)).toBe('completed');
  expect(
    (await f.admin.query('SELECT 1 FROM privacy.contacts WHERE id=$1', [c.c.id])).rows,
  ).toHaveLength(0);
  expect(
    (
      await f.admin.query('SELECT 1 FROM privacy.suppression_tombstones WHERE lookup_hmac=$1', [
        Buffer.from(contacts.emailKeys(c.email)[0]!.digest, 'hex'),
      ])
    ).rows.length,
  ).toBeGreaterThan(0);
});
it('refuses an expired email proof and sweeps its encrypted address without deleting the contact', async () => {
  const s = await setup(),
    c = await contact();
  value(await s.requestEmail(c.email, 'delete', 'synthetic'));
  const id = (
    await f.admin.query(
      'SELECT id FROM privacy.privacy_requests WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 1',
      [c.c.subjectId],
    )
  ).rows[0].id;
  value(await s.dispatchVerification(id));
  await f.admin.query(
    "UPDATE privacy.request_work SET proof_expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1",
    [id],
  );
  expect(await s.confirm(s.emails[0]!.proof)).toMatchObject({ ok: false });
  expect(value(await s.sweep('synthetic', true)).counts.expiredProofs).toBeGreaterThan(0);
  value(await s.sweep('synthetic', false));
  expect(
    (
      await f.admin.query(
        'SELECT status,encrypted_reply_context FROM privacy.privacy_requests WHERE id=$1',
        [id],
      )
    ).rows[0],
  ).toEqual({ status: 'rejected', encrypted_reply_context: null });
  expect(
    (await f.admin.query('SELECT 1 FROM privacy.contacts WHERE id=$1', [c.c.id])).rows,
  ).toHaveLength(1);
});
it('retains revocation and blocks SQL erasure when the independent journal is unavailable', async () => {
  const s = await setup({ journalFail: true }),
    o = await f.owner(),
    r = await f.report(o.identity),
    result = await s.requestOwner([o.token], 'delete', 'synthetic', uid('command'));
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  const request = {
    id: (
      await f.admin.query(
        'SELECT id FROM privacy.privacy_requests WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 1',
        [o.identity.subjectId],
      )
    ).rows[0].id,
  };
  expect(await s.drain(request.id)).toBe('manual_review');
  expect(
    (await f.admin.query('SELECT 1 FROM app.report_versions WHERE report_id=$1', [r.head.id])).rows,
  ).toHaveLength(1);
  expect(
    (await f.admin.query('SELECT status FROM app.subjects WHERE id=$1', [o.identity.subjectId]))
      .rows[0].status,
  ).toBe('pending_deletion');
});
it('escalates legal holds and access/export/correction to a deadline-driven operator queue', async () => {
  const s = await setup(),
    o = await f.owner();
  await f.admin.query(
    `INSERT INTO privacy.legal_holds(subject_id,resource_kind,reason_code,approved_by,review_after) VALUES($1,'subject','fixture_hold',$2,now()+interval '1 month')`,
    [o.identity.subjectId, f.staff],
  );
  const r = value(await s.requestOwner([o.token], 'delete', 'synthetic', uid('command')));
  await s.settle(r.id);
  value(await s.workOne(r.id));
  expect(value(await s.status(r.proof))).toMatchObject({
    status: 'manual_review',
    error: 'legal_hold',
  });
  const other = await f.owner();
  for (const kind of ['access', 'export', 'correct'] as const) {
    const r = value(await s.requestOwner([other.token], kind, 'synthetic', uid('command')));
    await s.settle(r.id);
    value(await s.workOne(r.id));
    expect(value(await s.status(r.proof))).toMatchObject({
      status: 'manual_review',
      error: 'operator_required',
    });
  }
  expect(
    (await f.admin.query('SELECT status FROM app.subjects WHERE id=$1', [other.identity.subjectId]))
      .rows[0].status,
  ).toBe('active');
});
it('does not require an account for opt-out and preserves report access', async () => {
  const s = await setup(),
    o = await f.owner(),
    r = await f.report(o.identity),
    request = value(await s.requestOwner([o.token], 'opt_out', 'synthetic', uid('command')));
  expect(await s.drain(request.id)).toBe('completed');
  expect(await success(f.scope.unitOfWork, (tx) => f.owners.resolve(tx, [o.token]))).not.toBeNull();
  expect(
    (await f.admin.query('SELECT status FROM app.reports WHERE id=$1', [r.head.id])).rows[0].status,
  ).toBe('active');
});
it('rejects forged, stale and missing-key restore journals before replay', async () => {
  const s = await setup(),
    input = { runId: uid('restore'), backupFinishedAt: time(-1000), jurisdiction: 'synthetic' };
  const snapshot = crypto.sign({ version: 1, capturedAt: time(), entries: [] });
  expect(await s.replay({ ...input, expectedDigest: '0'.repeat(64), snapshot })).toMatchObject({
    ok: false,
  });
  const old = crypto.sign({ version: 1, capturedAt: time(-3600000), entries: [] });
  expect(await s.replay({ ...input, expectedDigest: old.digest, snapshot: old })).toMatchObject({
    ok: false,
  });
  const e: JournalEntry = {
    version: 1,
    action: 'delete',
    resourceKind: 'subject',
    markers: [{ keyVersion: 'missing', digest: 'a'.repeat(64) }],
    tombstones: [],
    policy: 'p25',
  };
  const bad = crypto.sign({ version: 1, capturedAt: time(), entries: [e] });
  expect(await s.replay({ ...input, expectedDigest: bad.digest, snapshot: bad })).toMatchObject({
    ok: false,
  });
});
it('reapplies post-backup deletion markers to restored live resources before readiness', async () => {
  const s = await setup(),
    o = await f.owner(),
    r = await f.report(o.identity);
  const e: JournalEntry = {
    version: 1,
    action: 'delete',
    resourceKind: 'subject',
    markers: crypto.markers('subject', o.identity.subjectId),
    tombstones: [],
    policy: 'p25',
  };
  const snapshot = crypto.sign({ version: 1, capturedAt: time(), entries: [e] }),
    input = {
      runId: uid('restore'),
      backupFinishedAt: time(-1000),
      expectedDigest: snapshot.digest,
      snapshot,
      jurisdiction: 'synthetic',
    };
  const replay = value(await s.replay(input));
  expect(replay.ready).toBe(false);
  expect(
    (await f.admin.query('SELECT status FROM app.subjects WHERE id=$1', [o.identity.subjectId]))
      .rows[0].status,
  ).toBe('pending_deletion');
  const id = (
    await f.admin.query(
      'SELECT id FROM privacy.privacy_requests WHERE subject_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1',
      [o.identity.subjectId, 'delete'],
    )
  ).rows[0].id;
  expect(await s.drain(id)).toBe('completed');
  expect(
    (await f.admin.query('SELECT 1 FROM app.reports WHERE id=$1', [r.head.id])).rows,
  ).toHaveLength(0);
  for (let page = 0; page < 10; page++) {
    const result = value(await s.replay(input));
    if (result.ready) return;
  }
  throw Error('Restore did not reach readiness after all matching erasures completed');
});
it('erases delivery snapshots/work and contact mappings while retaining an independently owned report/PDF', async () => {
  const s = await setup(),
    g = await mailGraph();
  value(await s.requestEmail(g.c.email, 'delete', 'synthetic'));
  const id = (
    await f.admin.query(
      'SELECT id FROM privacy.privacy_requests WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 1',
      [g.c.c.subjectId],
    )
  ).rows[0].id;
  value(await s.dispatchVerification(id));
  value(await s.confirm(s.emails[0]!.proof));
  expect(await s.drain(id)).toBe('completed');
  for (const t of [
    'email.delivery_snapshots',
    'email.delivery_work',
    'email.email_links',
    'email.email_feedback',
    'email.email_sends',
  ])
    expect(
      (
        await f.admin.query(
          `SELECT 1 FROM ${t} WHERE ${t.endsWith('email_sends') ? 'id' : 'send_id'}=$1`,
          [g.send.id],
        )
      ).rows,
    ).toHaveLength(0);
  expect(
    (await f.admin.query('SELECT 1 FROM app.reports WHERE id=$1', [g.r.head.id])).rows,
  ).toHaveLength(1);
  expect(
    (await f.admin.query('SELECT state FROM app.object_assets WHERE id=$1', [g.pdf.id])).rows[0]
      .state,
  ).toBe('ready');
  expect(
    (await f.admin.query('SELECT state FROM app.object_assets WHERE id=$1', [g.payload.id])).rows[0]
      .state,
  ).toBe('deleted');
  expect(s.erased).toContain(g.payload.id);
  expect(s.erased).not.toContain(g.pdf.id);
});
it('requires provider erasure acknowledgment for an attempted message and never closes on unsupported erasure', async () => {
  const s = await setup({ mailResult: 'unsupported' }),
    g = await mailGraph(),
    messageId = uid('message');
  // Synthetic provider handoff timestamps; no real provider is contacted.
  await f.admin.query(
    `UPDATE email.email_sends SET dispatch_state='dispatching',claimed_at=send_after,payload_asset_id=$2,payload_hash=$3 WHERE id=$1`,
    [g.send.id, g.payload.id, g.payload.hash],
  );
  await f.admin.query(
    `UPDATE email.email_sends SET dispatch_state='accepted',accepted_at=claimed_at,provider_message_id=$2 WHERE id=$1`,
    [g.send.id, messageId],
  );
  const r = value(await s.requestOwner([g.o.token], 'delete', 'synthetic', uid('command')));
  expect(await s.drain(r.id)).toBe('manual_review');
  expect(value(await s.status(r.proof))).toMatchObject({
    status: 'manual_review',
    error: 'downstream_unconfirmed',
  });
  expect(
    (await f.admin.query('SELECT 1 FROM email.delivery_snapshots WHERE send_id=$1', [g.send.id]))
      .rows,
  ).toHaveLength(1);
  expect(s.erased).toContain(g.send.providerKey);
});
it('does not acknowledge object erasure failures and refuses a late upload commit to the tombstone', async () => {
  const s = await setup({ objectFail: true }),
    g = await mailGraph(),
    r = value(await s.requestOwner([g.o.token], 'delete', 'synthetic', uid('command')));
  expect(await s.drain(r.id)).toBe('manual_review');
  expect(
    (await f.admin.query('SELECT state FROM app.object_assets WHERE id=$1', [g.pdf.id])).rows[0]
      .state,
  ).toBe('deleting');
  await expect(
    f.admin.query("UPDATE app.object_assets SET state='ready' WHERE id=$1", [g.pdf.id]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await f.admin.query('SELECT 1 FROM app.report_versions WHERE report_id=$1', [g.r.head.id]))
      .rows,
  ).toHaveLength(1);
});
it('serializes competing leases and fences a stale worker after lease replacement', async () => {
  const s = await setup(),
    o = await f.owner(),
    r = value(await s.requestOwner([o.token], 'delete', 'synthetic', uid('command')));
  await s.settle(r.id);
  const leases = await Promise.all([
    success(s.scope.unitOfWork, (tx) => s.repo.lease(tx, r.id)),
    success(s.scope.unitOfWork, (tx) => s.repo.lease(tx, r.id)),
  ]);
  const old = leases.find((x) => x !== null)!;
  expect(leases.filter(Boolean)).toHaveLength(1);
  await f.admin.query(
    "UPDATE privacy.request_work SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
    [r.id],
  );
  const next = await success(s.scope.unitOfWork, (tx) => s.repo.lease(tx, r.id));
  expect(next!.generation).toBeGreaterThan(old.generation);
  expect(
    await s.scope.unitOfWork.run(async (tx) => {
      await s.repo.finishStage(tx, old, 'email', key().digest);
      return ok(null);
    }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  await success(s.scope.unitOfWork, (tx) => s.repo.release(tx, next!));
  expect(await s.drain(r.id)).toBe('completed');
});
it('requires a current privacy operator and actual evidence to close manual access/export/correction', async () => {
  const s = await setup(),
    o = await f.owner(),
    r = value(await s.requestOwner([o.token], 'export', 'synthetic', uid('command')));
  await s.settle(r.id);
  value(await s.workOne(r.id));
  expect(await s.review(f.staff, r.id, 'fulfilled', key().digest)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
  await f.admin.query(
    `INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='privacy_operator' ON CONFLICT DO NOTHING`,
    [f.staff],
  );
  expect(await s.review(f.staff, r.id, 'fulfilled', 'invalid')).toMatchObject({ ok: false });
  const digest = key().digest;
  value(await s.review(f.staff, r.id, 'fulfilled', digest));
  expect(value(await s.status(r.proof)).status).toBe('completed');
  expect(
    (await f.admin.query('SELECT 1 FROM admin.audit_events WHERE change_digest=$1', [digest])).rows,
  ).toHaveLength(1);
  await f.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1',
    [f.staff],
  );
  expect(await s.retry(f.staff, r.id, key().digest)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  });
});
it('escalates before the configured deadline without widening scope or deleting held data', async () => {
  const s = await setup(),
    o = await f.owner(),
    r = value(await s.requestOwner([o.token], 'delete', 'synthetic', uid('command')));
  await f.admin.query(
    "UPDATE privacy.privacy_requests SET due_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
    [r.id],
  );
  await s.settle(r.id);
  value(await s.workOne(r.id));
  expect(value(await s.status(r.proof))).toMatchObject({
    status: 'processing',
    error: 'deadline_near',
  });
  expect(await s.drain(r.id)).toBe('completed');
});
it('dry-runs report expiry and creates a report-only deletion without revoking its owner', async () => {
  const s = await setup(),
    o = await f.owner(),
    report = uid('report');
  await f.admin.query(
    `INSERT INTO app.reports(id,owner_subject_id,market,locale,created_at,last_owner_activity_at,updated_at,expires_at) VALUES($1,$2,'US','en-US',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()-interval '1 day')`,
    [report, o.identity.subjectId],
  );
  expect(value(await s.sweep('synthetic', true)).counts.targets).toBeGreaterThan(0);
  expect(
    (await f.admin.query('SELECT status FROM app.reports WHERE id=$1', [report])).rows[0].status,
  ).toBe('draft');
  const sweep = value(await s.sweep('synthetic', false));
  const id = (
    await f.admin.query(
      "SELECT request_id FROM privacy.request_work WHERE target_kind='report' AND target_id=$1",
      [report],
    )
  ).rows[0].request_id;
  expect(sweep.requests).toContain(id);
  expect(await s.drain(id)).toBe('completed');
  expect(await success(f.scope.unitOfWork, (tx) => f.owners.resolve(tx, [o.token]))).not.toBeNull();
});
