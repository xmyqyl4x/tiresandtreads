import type { PartnerIdentityRepository } from '../../../application/src/ports/partner-repositories.ts';
import { maxInt64 } from '../../../domain/src/values/core.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { identifier, mapped } from './partner-support.ts';
import { partnerOrganizationFromRow } from './partner-mappers.ts';
import { text, rev } from './private-values.ts';
import { reject } from './bounds.ts';
const columns = 'id,legal_name,market,status,verification_status,revision::text';
export function createPartnerIdentityRepository(s: WriteScope): PartnerIdentityRepository {
  const repo: PartnerIdentityRepository = {
    async registerPending(tx, input) {
      const id = identifier('organization', input.id),
        name = text(input.legalName, 200),
        market = text(input.market, 20),
        owner = text(input.owner, 200);
      const row = (
        await s.query(
          tx,
          `INSERT INTO partners.organizations(id,legal_name,market) VALUES($1,$2,$3) RETURNING ${columns}`,
          [id, name, market],
        )
      ).rows[0]!;
      await s.query(
        tx,
        "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,$2,'owner','pending')",
        [id, owner],
      );
      return mapped(partnerOrganizationFromRow(row));
    },
    async reviseOrganization(tx, input) {
      const id = identifier('organization', input.id),
        name = text(input.legalName, 200);
      if (
        typeof input.expectedRevision !== 'bigint' ||
        input.expectedRevision < 1n ||
        input.expectedRevision >= maxInt64 ||
        !['pending', 'active', 'suspended', 'closed'].includes(input.status) ||
        !['pending', 'verified', 'rejected', 'expired'].includes(input.verification) ||
        (input.status === 'active' && input.verification !== 'verified')
      )
        return reject();
      const row = (
        await s.query(
          tx,
          `UPDATE partners.organizations SET legal_name=$3,status=$4,verification_status=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 RETURNING ${columns}`,
          [id, input.expectedRevision.toString(), name, input.status, input.verification],
        )
      ).rows[0];
      return row ? mapped(partnerOrganizationFromRow(row)) : stop('conflict');
    },
    async reviseMembership(tx, input) {
      const org = identifier('organization', input.organizationId),
        actor = text(input.actor, 200);
      if (
        typeof input.expectedRevision !== 'bigint' ||
        input.expectedRevision < 1n ||
        input.expectedRevision >= maxInt64 ||
        !['owner', 'manager', 'analyst'].includes(input.role) ||
        !['pending', 'active', 'revoked'].includes(input.status)
      )
        return reject();
      const role = input.role,
        status = input.status,
        expected = input.expectedRevision.toString();
      // Match the allocator's organization-root order before changing membership state.
      await s.query(tx, 'SELECT id FROM partners.organizations WHERE id=$1 FOR UPDATE', [org]);
      const row = (
        await s.query(
          tx,
          'UPDATE partners.memberships SET role=$3,status=$4,revision=revision+1,updated_at=clock_timestamp() WHERE org_id=$1 AND provider_subject=$2 AND revision=$5 RETURNING revision::text',
          [org, actor, role, status, expected],
        )
      ).rows[0];
      return row ? rev(row.revision) : stop('conflict');
    },
  };
  return guarded(s, repo);
}
