import { randomUUID, randomBytes } from 'node:crypto';
import type { partnerRepositoryFixture } from './partner-repositories.ts';
export async function repositorySeeds(
  fixture: Awaited<ReturnType<typeof partnerRepositoryFixture>>,
) {
  const reviewer = randomUUID();
  await fixture.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$1::uuid::text,'active',now())",
    [reviewer],
  );
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
  async function directReservation(
    value: Offer,
    message: Send,
    codeId: string | null,
    slot = 1,
    client = fixture.admin,
  ) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO partners.coupon_reservations(id,org_id,send_id,owner_subject_id,offer_id,offer_version,pool_id,pool_mode,code_id,slot,policy_version)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'synthetic-v1')`,
      [
        id,
        value.org.id,
        message.id,
        message.subject,
        value.id,
        value.pool,
        value.mode,
        codeId,
        slot,
      ],
    );
    return id;
  }
  async function evidence() {
    const id = randomUUID();
    await fixture.admin.query(
      "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'reconcile.non_use','coupon_assignment','approved',now(),$2,'[]')",
      [id, randomBytes(32).toString('hex')],
    );
    return id;
  }

  return { company, offer, code, send, evidence, directReservation, reviewer };
}
