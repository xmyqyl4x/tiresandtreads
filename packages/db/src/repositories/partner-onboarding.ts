import type { PartnerOnboardingRepository } from '../../../application/src/ports/partner-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { createPartnerIdentityRepository } from './partner-identity.ts';
import { root, profile, uid, word, rev, sha, at, integer } from './partner-service-values.ts';
import { partnerOrganizationFromRow } from './partner-mappers.ts';
import { mapped } from './partner-support.ts';
const orgColumns = 'id,legal_name,market,status,verification_status,revision::text';
export function createPartnerOnboardingRepository(s: WriteScope): PartnerOnboardingRepository {
  const identity = createPartnerIdentityRepository(s),
    q = s.query;
  return guarded<PartnerOnboardingRepository>(s, {
    lock: (tx, org, actor) => root(s, tx, org, actor),
    async currentAgreements(tx, org, policy) {
      const p = (
        await q(tx, 'SELECT policy_version FROM partners.onboarding_profiles WHERE org_id=$1', [
          uid('organization', org),
        ])
      ).rows[0];
      if (p?.policy_version !== policy.version) return stop('forbidden');
      for (const kind of ['pilot_terms', 'privacy', 'dpa'] as const) {
        const expected = policy.agreements[kind];
        const found = await q(
          tx,
          "SELECT 1 FROM partners.agreements g JOIN partners.organization_assets b ON b.org_id=g.org_id AND b.asset_id=g.asset_id JOIN app.object_assets a ON a.id=b.asset_id WHERE g.org_id=$1 AND g.kind=$2 AND g.version=$3 AND g.status='accepted' AND g.expires_at>clock_timestamp() AND b.state='ready' AND a.state='ready' AND a.sha256=$4 AND a.expires_at>clock_timestamp() FOR SHARE OF g,b,a",
          [org, kind, word(expected.version, 100), sha(expected.sha256)],
        );
        if (found.rowCount !== 1) return stop('forbidden');
      }
    },
    async staff(tx, actor, permission) {
      if (!actor.staffId || !['partner.verify', 'partner.moderate'].includes(permission))
        return stop('forbidden');
      const r = (
        await q(tx, 'SELECT partners.authorize_service_staff($1,$2,$3) AS ok', [
          uid('staff', actor.staffId),
          word(actor.subject),
          permission,
        ])
      ).rows[0];
      if (r?.ok !== true) return stop('forbidden');
    },
    async register(tx, i) {
      const existing = (
        await q(tx, `SELECT ${orgColumns} FROM partners.organizations WHERE id=$1 FOR UPDATE`, [
          uid('organization', i.id),
        ])
      ).rows[0];
      if (existing) {
        const r = await root(s, tx, i.id, i.subject);
        if (
          existing.legal_name !== i.legalName ||
          existing.market !== i.market ||
          r.member?.role !== 'owner' ||
          r.profile?.emailDomain !== i.emailDomain
        )
          return stop('conflict');
        return r.organization;
      }
      const r = await identity.registerPending(tx, {
        id: i.id,
        legalName: word(i.legalName),
        market: word(i.market, 20),
        owner: word(i.subject),
      });
      await q(
        tx,
        'INSERT INTO partners.onboarding_profiles(org_id,email_domain,policy_version) VALUES($1,$2,$3)',
        [i.id, word(i.emailDomain, 253), word(i.policyVersion, 100)],
      );
      return r;
    },
    async profile(tx, org, expected, services) {
      if (!Array.isArray(services) || services.length < 1 || services.length > 16)
        return stop('invalid_input');
      const clean = [...new Set(services.map((x) => word(x, 80)))].sort();
      const r =
        (
          await q(
            tx,
            "UPDATE partners.onboarding_profiles SET services=$3,state='draft',revision=revision+1,updated_at=clock_timestamp() WHERE org_id=$1 AND revision=$2 AND state IN('draft','rejected') RETURNING *,revision::text AS revision",
            [uid('organization', org), rev(expected).toString(), JSON.stringify(clean)],
          )
        ).rows[0] ?? stop('conflict');
      return profile(r);
    },
    async location(tx, org, i) {
      const key = word(i.key, 100),
        region = word(i.region, 100),
        address = JSON.stringify(i.address);
      if (address.length > 3000) return stop('invalid_input');
      const r = (
        await q(
          tx,
          'INSERT INTO partners.locations(org_id,location_key,market,region_key,approved_address) SELECT id,$2,market,$3,$4 FROM partners.organizations WHERE id=$1 ON CONFLICT(org_id,location_key) DO NOTHING RETURNING id',
          [uid('organization', org), key, region, address],
        )
      ).rows[0];
      if (r) return uid('partner_location', r.id);
      const old =
        (
          await q(
            tx,
            'SELECT id,region_key,approved_address FROM partners.locations WHERE org_id=$1 AND location_key=$2',
            [org, key],
          )
        ).rows[0] ?? stop('not_found');
      if (
        old.region_key !== region ||
        JSON.stringify(Object.entries(old.approved_address as Record<string, string>).sort()) !==
          JSON.stringify(Object.entries(i.address).sort())
      )
        return stop('conflict');
      return uid('partner_location', old.id);
    },
    async agreement(tx, org, actor, i) {
      const found = (
        await q(
          tx,
          "SELECT 1 FROM partners.organization_assets b JOIN app.object_assets a ON a.id=b.asset_id WHERE b.org_id=$1 AND b.asset_id=$2 AND b.purpose='agreement' AND b.state='ready' AND a.state='ready' AND a.sha256=$3 AND a.expires_at>clock_timestamp() FOR SHARE OF b,a",
          [uid('organization', org), uid('asset', i.assetId), sha(i.sha256)],
        )
      ).rowCount;
      if (!found) return stop('forbidden');
      const r = await q(
        tx,
        'INSERT INTO partners.agreements(org_id,kind,version,asset_id,accepted_by,accepted_at,expires_at) SELECT $1,$2,$3,$4,$5,clock_timestamp(),a.expires_at FROM app.object_assets a WHERE a.id=$4 ON CONFLICT(org_id,kind,version) DO NOTHING',
        [org, i.kind, word(i.version, 100), i.assetId, word(actor)],
      );
      if (!r.rowCount) {
        const old = (
          await q(
            tx,
            'SELECT asset_id,accepted_by,status FROM partners.agreements WHERE org_id=$1 AND kind=$2 AND version=$3',
            [org, i.kind, i.version],
          )
        ).rows[0];
        if (
          !old ||
          old.asset_id !== i.assetId ||
          old.accepted_by !== actor ||
          old.status !== 'accepted'
        )
          return stop('conflict');
      }
    },
    async submit(tx, org, expected, policy) {
      const valid = (
        await q(
          tx,
          "SELECT 1 FROM partners.onboarding_profiles p WHERE p.org_id=$1 AND p.services<>'[]' AND p.policy_version=$2 AND EXISTS(SELECT 1 FROM partners.locations l WHERE l.org_id=p.org_id) AND (SELECT count(DISTINCT kind) FROM partners.agreements a JOIN partners.organization_assets b ON b.org_id=a.org_id AND b.asset_id=a.asset_id JOIN app.object_assets o ON o.id=b.asset_id WHERE a.org_id=p.org_id AND a.status='accepted' AND a.expires_at>clock_timestamp() AND b.state='ready' AND o.state='ready' AND o.expires_at>clock_timestamp())=3",
          [uid('organization', org), word(policy, 100)],
        )
      ).rowCount;
      if (!valid) return stop('forbidden');
      const r =
        (
          await q(
            tx,
            "UPDATE partners.onboarding_profiles SET state='submitted',revision=revision+1,updated_at=clock_timestamp() WHERE org_id=$1 AND revision=$2 AND state IN('draft','rejected') RETURNING *,revision::text AS revision",
            [org, rev(expected).toString()],
          )
        ).rows[0] ?? stop('conflict');
      return profile(r);
    },
    async verification(tx, org, i) {
      if (
        Date.parse(i.expiresAt) <= Date.now() ||
        !['domain', 'registry', 'manual'].includes(i.kind)
      )
        return stop('invalid_input');
      const asset = (
        await q(
          tx,
          "SELECT 1 FROM partners.organization_assets b JOIN app.object_assets a ON a.id=b.asset_id WHERE b.org_id=$1 AND b.asset_id=$2 AND b.purpose='verification' AND b.state='ready' AND a.state='ready' AND a.expires_at>$3 FOR SHARE OF b,a",
          [org, uid('asset', i.assetId), at(i.expiresAt)],
        )
      ).rowCount;
      if (!asset) return stop('forbidden');
      await q(
        tx,
        'INSERT INTO partners.verification_records(org_id,kind,asset_id,status,reviewed_by,reviewed_at,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6)',
        [
          uid('organization', org),
          i.kind,
          i.assetId,
          i.approved ? 'verified' : 'rejected',
          uid('staff', i.reviewer),
          i.expiresAt,
        ],
      );
      if (!i.approved)
        await q(
          tx,
          "UPDATE partners.organizations SET status=CASE WHEN status='active' THEN 'suspended' ELSE status END,verification_status='rejected',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status<>'closed'",
          [org],
        );
      if (i.domain) {
        await q(
          tx,
          'INSERT INTO partners.organization_domains(org_id,domain,status,reviewed_by,reviewed_at,expires_at) VALUES($1,$2,$3,$4,clock_timestamp(),$5) ON CONFLICT(org_id,domain) DO UPDATE SET status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,expires_at=excluded.expires_at',
          [org, word(i.domain, 253), i.approved ? 'verified' : 'revoked', i.reviewer, i.expiresAt],
        );
      }
    },
    async decide(tx, org, expected, state, reason, override) {
      if (
        !['approved', 'rejected'].includes(state) ||
        !/^[a-z][a-z0-9_]{0,79}$/.test(reason) ||
        typeof override !== 'boolean'
      )
        return stop('invalid_input');
      const r =
        (
          await q(
            tx,
            "UPDATE partners.onboarding_profiles SET state=$3,reason_code=$4,email_override=$5,revision=revision+1,updated_at=clock_timestamp() WHERE org_id=$1 AND revision=$2 AND state='submitted' RETURNING *,revision::text AS revision",
            [uid('organization', org), rev(expected).toString(), state, reason, override],
          )
        ).rows[0] ?? stop('conflict');
      if (state === 'approved')
        await q(
          tx,
          "UPDATE partners.locations SET status='approved' WHERE org_id=$1 AND status='pending'",
          [org],
        );
      return profile(r);
    },
    async activate(tx, org, expected) {
      const valid = (
        await q(
          tx,
          "SELECT 1 FROM partners.onboarding_profiles p WHERE p.org_id=$1 AND p.state='approved' AND EXISTS(SELECT 1 FROM partners.verification_records v JOIN partners.organization_assets b ON b.org_id=v.org_id AND b.asset_id=v.asset_id JOIN app.object_assets a ON a.id=b.asset_id WHERE v.org_id=p.org_id AND v.status='verified' AND v.expires_at>clock_timestamp() AND b.state='ready' AND a.state='ready' AND a.expires_at>clock_timestamp()) AND EXISTS(SELECT 1 FROM partners.organization_domains d WHERE d.org_id=p.org_id AND (p.email_override OR d.domain=p.email_domain) AND d.status='verified' AND d.expires_at>clock_timestamp()) AND EXISTS(SELECT 1 FROM partners.locations l WHERE l.org_id=p.org_id AND l.status='approved') AND (SELECT count(DISTINCT kind) FROM partners.agreements a JOIN partners.organization_assets b ON b.org_id=a.org_id AND b.asset_id=a.asset_id JOIN app.object_assets physical ON physical.id=b.asset_id WHERE a.org_id=p.org_id AND a.status='accepted' AND a.expires_at>clock_timestamp() AND b.state='ready' AND physical.state='ready' AND physical.expires_at>clock_timestamp())=3",
          [uid('organization', org)],
        )
      ).rowCount;
      if (!valid) return stop('forbidden');
      const row =
        (
          await q(
            tx,
            `UPDATE partners.organizations SET status='active',verification_status='verified',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND status IN('pending','suspended') RETURNING ${orgColumns}`,
            [org, rev(expected).toString()],
          )
        ).rows[0] ?? stop('conflict');
      await q(
        tx,
        "UPDATE partners.memberships SET status='active',revision=revision+1,updated_at=clock_timestamp() WHERE org_id=$1 AND role='owner' AND status='pending'",
        [org],
      );
      return mapped(partnerOrganizationFromRow(row));
    },
    async lifecycle(tx, org, expected, state) {
      if (!['suspended', 'active', 'closed', 'expired'].includes(state))
        return stop('invalid_input');
      if (state === 'active')
        return createPartnerOnboardingRepository(s).activate(tx, org, expected);
      const row =
        (
          await q(
            tx,
            `UPDATE partners.organizations SET status=$3,verification_status=CASE WHEN $3='suspended' AND $4 THEN 'expired' ELSE verification_status END,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND status<>'closed' RETURNING ${orgColumns}`,
            [
              uid('organization', org),
              rev(expected).toString(),
              state === 'expired' ? 'suspended' : state,
              state === 'expired',
            ],
          )
        ).rows[0] ?? stop('conflict');
      return mapped(partnerOrganizationFromRow(row));
    },
    async invite(tx, org, i) {
      if (
        (
          await q(
            tx,
            "SELECT 1 FROM partners.memberships WHERE org_id=$1 AND provider_subject=$2 AND status<>'revoked' FOR SHARE",
            [uid('organization', org), word(i.target)],
          )
        ).rowCount
      )
        return stop('conflict');
      await q(
        tx,
        'INSERT INTO partners.membership_invites(id,org_id,issuer,target_subject,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          uid('partner_invite', i.id),
          uid('organization', org),
          word(i.issuer),
          word(i.target),
          i.role,
          sha(i.tokenHash),
          at(i.expiresAt),
        ],
      );
    },
    async acceptInvite(tx, org, subject, hash) {
      if (
        (
          await q(
            tx,
            "SELECT 1 FROM partners.memberships WHERE org_id=$1 AND provider_subject=$2 AND status<>'revoked' FOR UPDATE",
            [uid('organization', org), word(subject)],
          )
        ).rowCount
      )
        return stop('conflict');
      const r =
        (
          await q(
            tx,
            "UPDATE partners.membership_invites SET state='accepted' WHERE org_id=$1 AND target_subject=$2 AND token_hash=$3 AND state='pending' AND expires_at>clock_timestamp() RETURNING role",
            [uid('organization', org), word(subject), sha(hash)],
          )
        ).rows[0] ?? stop('forbidden');
      const row =
        (
          await q(
            tx,
            "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,$2,$3,'active') ON CONFLICT(org_id,provider_subject) DO UPDATE SET role=excluded.role,status='active',revision=partners.memberships.revision+1,updated_at=clock_timestamp() RETURNING revision::text",
            [org, subject, r.role],
          )
        ).rows[0] ?? stop('integrity');
      return rev(row.revision);
    },
    async member(tx, org, subject, expected, role, status) {
      if (
        !['owner', 'manager', 'analyst'].includes(role) ||
        !['active', 'revoked'].includes(status)
      )
        return stop('invalid_input');
      const old =
        (
          await q(
            tx,
            'SELECT role,status FROM partners.memberships WHERE org_id=$1 AND provider_subject=$2 FOR UPDATE',
            [org, word(subject)],
          )
        ).rows[0] ?? stop('not_found');
      if (
        old.role === 'owner' &&
        ['active', 'pending'].includes(String(old.status)) &&
        (role !== 'owner' || status !== 'active')
      ) {
        if (
          (
            await q(
              tx,
              "SELECT 1 FROM partners.memberships WHERE org_id=$1 AND provider_subject<>$2 AND role='owner' AND status IN('pending','active') FOR UPDATE",
              [org, subject],
            )
          ).rowCount === 0
        )
          return stop('forbidden');
      }
      await q(
        tx,
        "UPDATE partners.membership_invites SET state='revoked' WHERE org_id=$1 AND target_subject=$2 AND state='pending'",
        [org, subject],
      );
      return identity.reviseMembership(tx, {
        organizationId: org,
        actor: subject,
        expectedRevision: expected,
        role,
        status,
      });
    },
    async audit(tx, org, actor, action, resource, digest) {
      await q(
        tx,
        'INSERT INTO partners.organization_audit(org_id,actor_hmac,action,resource,body_hmac) VALUES($1,$2,$3,$4,$5)',
        [uid('organization', org), sha(actor), word(action, 80), word(resource, 100), sha(digest)],
      );
    },
    async audits(tx, org, after, limit) {
      const rows = await q(
        tx,
        'SELECT id,action,resource,result,occurred_at FROM partners.organization_audit WHERE org_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
        [
          uid('organization', org),
          after === null ? null : uid('partner_audit', after),
          integer(limit, 1, 100),
        ],
      );
      return Object.freeze(
        rows.rows.map((r) =>
          Object.freeze({
            id: uid('partner_audit', r.id),
            action: word(r.action, 80),
            resource: word(r.resource, 100),
            result: word(r.result, 80),
            occurredAt: at(r.occurred_at),
          }),
        ),
      );
    },
  });
}
