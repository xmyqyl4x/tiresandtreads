import { type Id, type Revision } from '../../../domain/src/values/core.ts';
import { partnerDomain } from '../../../domain/src/partner-policy.ts';
import type {
  PartnerServiceAssets,
  PartnerFiles,
  PartnerAssetPurpose,
} from '../ports/partner-services.ts';
import type { PrivateObjects } from '../ports/assets.ts';
import {
  capture,
  partnerContext,
  string,
  identifier,
  timestamp,
  type PartnerDependencies,
} from './partner-work.ts';
import { demand } from '../services/service-work.ts';
export function createPartnerOnboardingServices(
  d: PartnerDependencies & {
    readonly assets: PartnerServiceAssets;
    readonly objects: PrivateObjects;
    readonly files: PartnerFiles;
  },
) {
  const c = partnerContext(d),
    repo = d.onboarding;
  return {
    register(handle: string, input: Readonly<{ key: string; legalName: string; market: 'US' }>) {
      return c.safe(async () => {
        const i = capture(input);
        identifier('command', i.key);
        const name = string(i.legalName);
        demand(i.market === 'US');
        const p = await c.principal(handle),
          org = d.crypto.id('organization', 'register:' + p.subject + ':' + i.key);
        return c.run(async (tx) => {
          const r = await repo.register(tx, {
            id: org,
            legalName: name,
            market: i.market,
            subject: p.subject,
            emailDomain: p.emailDomain,
            policyVersion: c.policy.version,
          });
          await c.audit(tx, p, org, 'organization.register', org, { name, market: i.market });
          return r;
        });
      });
    },
    status(handle: string, organizationId: Id<'organization'>) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          p = await c.principal(handle);
        return c.run((tx) => c.member(tx, p, org, ['owner', 'manager', 'analyst'], true, true));
      });
    },
    profile(
      handle: string,
      organizationId: Id<'organization'>,
      expected: Revision,
      services: readonly string[],
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          items = capture(services);
        demand(
          items.length >= 1 &&
            items.length <= 16 &&
            items.every((x) =>
              [
                'sales',
                'fitting',
                'alignment',
                'tpms',
                'repair',
                'rotation',
                'balancing',
                'mobile_service',
              ].includes(x),
            ),
        );
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner'], true);
          const r = await repo.profile(tx, org, expected, items);
          await c.audit(tx, p, org, 'organization.profile', org, { expected, items });
          return r;
        });
      });
    },
    location(
      handle: string,
      organizationId: Id<'organization'>,
      input: Readonly<{ key: string; region: string; address: Readonly<Record<string, string>> }>,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          i = capture(input);
        string(i.key, 100);
        demand(/^[A-Z]{2}$/.test(i.region));
        demand(
          Object.keys(i.address).length >= 2 &&
            Object.keys(i.address).every((k) =>
              ['line1', 'line2', 'city', 'postal', 'country'].includes(k),
            ) &&
            i.address.country === 'US',
        );
        for (const v of Object.values(i.address)) string(v, 200);
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner'], true);
          const r = await repo.location(tx, org, i);
          await c.audit(tx, p, org, 'organization.location', r, { key: i.key, region: i.region });
          return r;
        });
      });
    },
    upload(
      handle: string,
      organizationId: Id<'organization'>,
      purpose: PartnerAssetPurpose,
      mime: string,
      input: Uint8Array,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId);
        demand(input instanceof Uint8Array && input.length > 0 && input.length <= 16777216);
        const copy = new Uint8Array(input);
        demand(['agreement', 'verification', 'coupon_pool', 'logo'].includes(purpose));
        const p = await c.principal(handle);
        const admitted = await c.run(async (tx) => {
          const r = await c.member(
            tx,
            p,
            org,
            ['owner', 'manager'],
            true,
            ['agreement', 'verification'].includes(purpose),
          );
          demand(r.organization.status !== 'closed', 'forbidden');
          demand(
            r.organization.status !== 'suspended' ||
              ['agreement', 'verification'].includes(purpose),
            'forbidden',
          );
          return true;
        });
        if (!admitted.ok) return admitted;
        const bytes = await d.files.inspect(purpose, mime, copy);
        demand(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216);
        const hash = d.crypto.checksum(bytes),
          assetId = d.crypto.id('asset'),
          expires = timestamp(new Date(d.clock.now() + 90 * 86400000).toISOString());
        const registered = await c.run(async (tx) => {
          const current = await c.member(
            tx,
            p,
            org,
            ['owner', 'manager'],
            true,
            ['agreement', 'verification'].includes(purpose),
          );
          demand(current.organization.status !== 'closed', 'forbidden');
          return d.assets.register(tx, org, purpose, assetId, mime, bytes.length, hash, expires);
        });
        if (!registered.ok) return registered;
        const version = await d.objects.put(registered.value, bytes),
          fresh = await c.principal(handle);
        demand(fresh.subject === p.subject, 'forbidden');
        return c.run(async (tx) => {
          const current = await c.member(
            tx,
            fresh,
            org,
            ['owner', 'manager'],
            true,
            ['agreement', 'verification'].includes(purpose),
          );
          demand(current.organization.status !== 'closed', 'forbidden');
          await d.assets.ready(tx, org, registered.value, version);
          const ready = await d.assets.get(tx, org, assetId, purpose);
          await c.audit(tx, fresh, org, 'asset.ready', assetId, {
            purpose,
            mime,
            size: bytes.length,
            hash,
          });
          return ready;
        });
      });
    },
    acceptAgreement(
      handle: string,
      organizationId: Id<'organization'>,
      kind: 'pilot_terms' | 'privacy' | 'dpa',
      assetId: Id<'asset'>,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          asset = identifier('asset', assetId);
        demand(Object.hasOwn(c.policy.agreements, kind));
        const p = await c.principal(handle),
          terms = c.policy.agreements[kind];
        return c.run(async (tx) => {
          const r = await c.member(tx, p, org, ['owner'], true, true);
          demand(r.organization.status !== 'closed', 'forbidden');
          await repo.agreement(tx, org, p.subject, {
            kind,
            version: terms.version,
            assetId: asset,
            sha256: terms.sha256,
          });
          await c.audit(tx, p, org, 'agreement.accept', asset, { kind, version: terms.version });
          return { accepted: true as const, version: terms.version };
        });
      });
    },
    submit(handle: string, organizationId: Id<'organization'>, expected: Revision) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner'], true);
          await repo.currentAgreements(tx, org, c.policy);
          const r = await repo.submit(tx, org, expected, c.policy.version);
          await c.audit(tx, p, org, 'organization.submit', org, {
            expected,
            policy: c.policy.version,
          });
          return r;
        });
      });
    },
    verification(
      handle: string,
      organizationId: Id<'organization'>,
      input: Readonly<{
        kind: 'domain' | 'registry' | 'manual';
        assetId: Id<'asset'>;
        approved: boolean;
        expiresAt: string;
        domain: string | null;
      }>,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          i = capture(input),
          expires = timestamp(i.expiresAt);
        demand(
          ['domain', 'registry', 'manual'].includes(i.kind) &&
            typeof i.approved === 'boolean' &&
            Date.parse(expires) > d.clock.now() &&
            Date.parse(expires) <= d.clock.now() + 90 * 86400000,
        );
        const parsed = i.domain === null ? null : partnerDomain(i.domain);
        demand(!parsed || parsed.ok);
        demand(i.kind !== 'domain' || parsed?.ok);
        const domain = parsed?.ok ? parsed.value : null,
          p = await c.principal(handle);
        return c.run(async (tx) => {
          const r = await c.staff(tx, p, org, 'partner.verify', true);
          demand(r.organization.status !== 'closed', 'forbidden');
          await repo.verification(tx, org, {
            ...i,
            assetId: identifier('asset', i.assetId),
            expiresAt: expires,
            domain,
            reviewer: p.staffId!,
          });
          await c.audit(tx, p, org, 'verification.review', i.assetId, {
            kind: i.kind,
            approved: i.approved,
            domain,
            expires,
          });
          return { approved: i.approved };
        });
      });
    },
    decide(
      handle: string,
      organizationId: Id<'organization'>,
      expected: Revision,
      approved: boolean,
      reason: string,
      emailOverride = false,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          note = string(reason, 80);
        demand(
          /^[a-z][a-z0-9_]*$/.test(note) &&
            typeof approved === 'boolean' &&
            typeof emailOverride === 'boolean',
        );
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          const r = await c.staff(tx, p, org, 'partner.verify', true);
          demand(r.profile, 'not_found');
          demand(
            !approved ||
              !c.policy.excludedEmailDomains.includes(r.profile.emailDomain) ||
              emailOverride,
            'forbidden',
          );
          const result = await repo.decide(
            tx,
            org,
            expected,
            approved ? 'approved' : 'rejected',
            note,
            emailOverride,
          );
          await c.audit(tx, p, org, 'organization.review', org, {
            expected,
            approved,
            note,
            emailOverride,
          });
          return result;
        });
      });
    },
    activate(handle: string, organizationId: Id<'organization'>, expected: Revision) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          const r = await c.staff(tx, p, org, 'partner.verify', true);
          demand(
            r.profile &&
              (!c.policy.excludedEmailDomains.includes(r.profile.emailDomain) ||
                r.profile.emailOverride),
            'forbidden',
          );
          await repo.currentAgreements(tx, org, c.policy);
          const result = await repo.activate(tx, org, expected);
          await c.audit(tx, p, org, 'organization.activate', org, { expected });
          return result;
        });
      });
    },
    lifecycle(
      handle: string,
      organizationId: Id<'organization'>,
      expected: Revision,
      state: 'suspended' | 'active' | 'closed' | 'expired',
      reason: string,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          note = string(reason, 80);
        demand(
          /^[a-z][a-z0-9_]*$/.test(note) &&
            ['suspended', 'active', 'closed', 'expired'].includes(state),
        );
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          if (state === 'closed') {
            const root = await repo.lock(tx, org, p.subject);
            const owns =
              root.member?.role === 'owner' &&
              (root.member.status === 'active' ||
                (root.member.status === 'pending' && root.organization.status === 'pending'));
            if (owns) await c.member(tx, p, org, ['owner'], true, true);
            else await c.staff(tx, p, org, 'partner.verify');
          } else await c.staff(tx, p, org, 'partner.verify', state === 'active');
          if (state === 'active') await repo.currentAgreements(tx, org, c.policy);
          const result = await repo.lifecycle(tx, org, expected, state);
          await c.audit(tx, p, org, 'organization.' + state, org, { expected, note });
          return result;
        });
      });
    },
    invite(
      handle: string,
      organizationId: Id<'organization'>,
      target: string,
      role: 'manager' | 'analyst',
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          subject = string(target);
        demand(['manager', 'analyst'].includes(role));
        const p = await c.principal(handle),
          raw = d.crypto.token(),
          inviteId = d.crypto.id('partner_invite'),
          expires = timestamp(new Date(d.clock.now() + 86400000).toISOString());
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner'], true);
          demand(subject !== p.subject);
          await repo.invite(tx, org, {
            id: inviteId,
            issuer: p.subject,
            target: subject,
            role,
            tokenHash: d.crypto.tokenHash(raw),
            expiresAt: expires,
          });
          await c.audit(tx, p, org, 'membership.invite', inviteId, { target: subject, role });
          return Object.freeze({ id: inviteId, token: raw, expiresAt: expires });
        });
      });
    },
    acceptInvite(handle: string, organizationId: Id<'organization'>, token: string) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          hash = d.crypto.tokenHash(token),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          const r = await repo.lock(tx, org, p.subject);
          demand(['pending', 'active'].includes(r.organization.status), 'forbidden');
          const revision = await repo.acceptInvite(tx, org, p.subject, hash);
          await c.audit(tx, p, org, 'membership.accept', org, { hash });
          return revision;
        });
      });
    },
    member(
      handle: string,
      organizationId: Id<'organization'>,
      target: string,
      expected: Revision,
      role: 'owner' | 'manager' | 'analyst',
      status: 'active' | 'revoked',
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          subject = string(target);
        demand(
          ['owner', 'manager', 'analyst'].includes(role) && ['active', 'revoked'].includes(status),
        );
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner'], true);
          const revision = await repo.member(tx, org, subject, expected, role, status);
          await c.audit(tx, p, org, 'membership.change', org, { subject, expected, role, status });
          return revision;
        });
      });
    },
    audit(
      handle: string,
      organizationId: Id<'organization'>,
      after: string | null = null,
      limit = 25,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId);
        demand(Number.isInteger(limit) && limit >= 1 && limit <= 100);
        if (after !== null) identifier('partner_audit', after);
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner'], true, true);
          return repo.audits(tx, org, after, limit);
        });
      });
    },
  };
}
