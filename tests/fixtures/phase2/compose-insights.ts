import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { insightsFixture } from './partner-insights.ts';
import { repositorySeeds } from './seed-partner-repositories.ts';
import { uuid, composePartnerServices } from './compose-partner-services.ts';
import { createPartnerInsightsRepository } from '../../../packages/db/src/repositories/partner-insights.ts';
import { createPartnerInsightsServices } from '../../../packages/application/src/partners/partner-insights.ts';
import { createPartnerCrypto } from '../../../packages/integrations/src/partner-crypto.ts';
import { createInsightsTokens } from '../../../packages/integrations/src/insights-tokens.ts';
import type { ContactEncryption } from '../../../packages/application/src/ports/contact-services.ts';
import type { PartnerPrincipal } from '../../../packages/domain/src/partner-policy.ts';
import type { Id, Instant } from '../../../packages/domain/src/values/core.ts';
import { ok, fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
export async function composeInsights(f: Awaited<ReturnType<typeof insightsFixture>>) {
  const partners = await composePartnerServices(f);
  const scope = f.insightsAdapter(),
    crypto = createPartnerCrypto('v1', { v1: randomBytes(32) }, randomBytes(32)),
    tokens = createInsightsTokens(randomBytes(32)),
    sessions = new Map<string, PartnerPrincipal>(),
    seeds = await repositorySeeds(f),
    key = randomBytes(32),
    start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - 7);
  const week = start.toISOString().slice(0, 10),
    historical = new Date(start.getTime() + 86400000).toISOString(),
    prior = new Date(start.getTime() - 86400000).toISOString(),
    now = () => new Date().toISOString() as Instant;
  function session(subject: string, staffId: Id<'staff'> | null = null) {
    const h = uuid('handle');
    sessions.set(h, {
      subject,
      staffId,
      emailDomain: 'synthetic.example',
      emailVerified: true,
      mfaAt: now(),
      expiresAt: new Date(Date.now() + 600000).toISOString() as Instant,
    });
    return h;
  }
  async function staff(role: string) {
    const id = uuid('staff'),
      subject = 'synthetic-staff:' + id;
    await f.admin.query(
      "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
      [id, subject],
    );
    await f.admin.query(
      'INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code=$2',
      [id, role],
    );
    return session(subject, id);
  }
  // Only disposable role fixtures grant reveal/erasure capabilities; migration does not.
  for (const role of ['owner', 'privacy_officer']) {
    await f.admin.query(
      `INSERT INTO admin.roles(code,permissions,policy_version) VALUES($1,'["operations.visitors","operations.reveal","operations.privacy"]','synthetic-insights') ON CONFLICT(code) DO UPDATE SET permissions=EXCLUDED.permissions`,
      [role],
    );
  }
  const email = await staff('delivery_operator'),
    visitors = await staff('visitor_operator'),
    analyst = await staff('insights_analyst'),
    events = await staff('offer_event_writer'),
    privacy = await staff('privacy_officer'),
    owner = await staff('owner'),
    caseworker = await staff('partner_caseworker');
  const encryption: ContactEncryption = {
    async encrypt(bytes, purpose, id) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(purpose + '\0' + id));
      const body = Buffer.concat([c.update(bytes), c.final()]);
      return {
        keyVersion: 'synthetic-aes-double',
        hex: Buffer.concat([iv, c.getAuthTag(), body]).toString('hex'),
      };
    },
    async decrypt(box, purpose, id) {
      const b = Buffer.from(box.hex, 'hex'),
        c = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      c.setAAD(Buffer.from(purpose + '\0' + id));
      c.setAuthTag(b.subarray(12, 28));
      return new Uint8Array(Buffer.concat([c.update(b.subarray(28)), c.final()]));
    },
  };
  const repository = createPartnerInsightsRepository(scope, crypto.digest),
    d = {
      uow: scope.unitOfWork,
      repository,
      crypto,
      encryption,
      tokens,
      clock: { now: () => Date.now() },
      authority: {
        async verify(h: string) {
          const p = sessions.get(h);
          return p ? ok(p) : fail(failure('forbidden'));
        },
      },
    },
    service = createPartnerInsightsServices(d);
  const notice = uuid('notice');
  await f.admin.query(
    "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1::uuid,'analytics','synthetic',$1::uuid::text,$2,$3,'synthetic-insights')",
    [notice, 'a'.repeat(64), prior],
  );
  async function consent(
    subject: Id<'subject'>,
    scope = 'email',
    status = 'confirmed',
    effective = prior,
  ) {
    const event = uuid('consent_event');
    await f.admin.query(
      "INSERT INTO privacy.consent_events(id,purpose,action,notice_id,policy_version,scope_key,occurred_at,method) VALUES($1,'analytics',$2,$3,'synthetic',$4,$5,'fixture')",
      [event, status === 'confirmed' ? 'confirm' : 'withdraw', notice, scope, effective],
    );
    await f.admin.query('INSERT INTO privacy.subject_links(event_id,subject_id) VALUES($1,$2)', [
      event,
      subject,
    ]);
    await f.admin.query(
      "INSERT INTO privacy.consent_state(subject_id,purpose,scope_key,status,source_event_id,effective_at,policy_version) VALUES($1,'analytics',$2,$3,$4,$5,'synthetic') ON CONFLICT(subject_id,purpose,scope_key) DO UPDATE SET status=EXCLUDED.status,source_event_id=EXCLUDED.source_event_id,effective_at=EXCLUDED.effective_at,revision=privacy.consent_state.revision+1",
      [subject, scope, status, event, effective],
    );
  }
  async function company() {
    const o = await partners.company(),
      location = (await f.admin.query('SELECT id FROM partners.locations WHERE org_id=$1', [o.org]))
        .rows[0]!.id as string;
    return { id: o.org, actor: o.subject, location, handle: session(o.subject) };
  }
  async function historicalMessage() {
    const contact = (await f.contact()).value,
      payload = await f.asset('email_payload'),
      template = await f.template('offers'),
      id = uuid('send');
    await f.admin.query(
      "INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,template_id,dispatch_state,send_after,cancel_deadline,claimed_at,accepted_at,payload_asset_id,payload_hash,provider_key,provider,requested_purposes,dispatch_policy_version,created_at) VALUES($1,'offers',$2,$3,$4,'accepted',$5,$5,$5,$5,$6,$7,$1::uuid::text,'synthetic','[\"offers\"]','synthetic-history',$8)",
      [id, contact.id, contact.subjectId, template, historical, payload.id, payload.hash, prior],
    );
    return { id, subject: contact.subjectId, contact: contact.id };
  }
  const offers = new Map<string, Awaited<ReturnType<typeof seeds.offer>>>();
  async function assignment(
    o: Awaited<ReturnType<typeof company>>,
    mode: 'unique' | 'shared' | 'generated' = 'unique',
  ) {
    const offerKey = o.id + ':' + mode;
    if (!offers.has(offerKey)) offers.set(offerKey, await seeds.offer(o, { mode }));
    const offer = offers.get(offerKey)!,
      m = await historicalMessage(),
      id = await seeds.directReservation(
        offer,
        m,
        mode === 'shared' ? null : await seeds.code(offer),
      ),
      subject = m.subject as Id<'subject'>;
    await consent(subject);
    await f.admin.query('UPDATE privacy.contacts SET verified_at=now() WHERE id=$1', [m.contact]);
    await f.admin.query("UPDATE partners.coupon_reservations SET state='issued' WHERE id=$1", [id]);
    return { id: id as Id<'coupon_assignment'>, subject, send: m.id, contact: m.contact, offer };
  }
  async function visitor(channel = 'web', bot = 'not_flagged') {
    const subject = uuid('subject'),
      contact = uuid('contact'),
      event = uuid('event'),
      box = await encryption.encrypt(
        new TextEncoder().encode('synthetic@example.invalid'),
        'contact_email',
        contact,
      );
    await f.admin.query(
      "INSERT INTO app.subjects(id,kind,status,created_at,updated_at) VALUES($1,'contact','active',$2,$2)",
      [subject, prior],
    );
    await f.admin.query(
      "INSERT INTO privacy.contacts(id,subject_id,encrypted_email,key_version,status,verified_at,created_at,last_purpose_activity_at,updated_at) VALUES($1,$2,decode($3,'hex'),$4,'active',$5,$5,$5,$5)",
      [contact, subject, box.hex, box.keyVersion, prior],
    );
    await consent(subject, 'site');
    await f.admin.query(
      "INSERT INTO analytics.events(id,subject_id,session_ref,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at,collection_scope) VALUES($1,$2,$3,'public_page_view',1,$4,$4,'US','en-US','/assess',$5,1,'synthetic','{}',$6,$7,$4::timestamptz+interval '13 months','site')",
      [event, subject, uuid('session'), historical, channel, randomBytes(32), bot],
    );
    return { subject, contact, event };
  }
  const redemption = (assignment: Id<'coupon_assignment'>) => ({
    key: uuid('command'),
    assignment,
    kind: 'reported' as const,
    quantity: 1,
    previous: null,
    occurredAt: now(),
  });
  return {
    scope,
    crypto,
    tokens,
    sessions,
    session,
    staff,
    repository,
    d,
    service,
    seeds,
    company,
    assignment,
    consent,
    visitor,
    week,
    historical,
    prior,
    now,
    redemption,
    email,
    visitors,
    analyst,
    events,
    privacy,
    owner,
    caseworker,
    encryption,
  };
}
