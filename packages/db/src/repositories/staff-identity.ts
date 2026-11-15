import type { StaffIdentityRepository } from '../../../application/src/ports/staff-identity.ts';
import { id } from '../../../domain/src/values/core.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';

export function createStaffIdentityRepository(s: WriteScope): StaffIdentityRepository {
  return guarded(s, {
    async resolve(tx, providerSubject) {
      if (
        typeof providerSubject !== 'string' ||
        providerSubject.length > 200 ||
        !/^clerk:[A-Za-z0-9_-]{43}:user_[A-Za-z0-9_-]{1,128}$/.test(providerSubject)
      )
        return stop('invalid_input');
      const role = (await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role;
      if (role !== 'tt_staff_runtime') return stop('forbidden');
      const row = (
        await s.query(
          tx,
          `SELECT s.id FROM admin.staff_identities s
           WHERE s.provider_subject=$1 AND s.status='active' AND EXISTS (
             SELECT 1 FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id
             WHERE a.staff_id=s.id AND a.revoked_at IS NULL AND a.granted_at<=clock_timestamp()
               AND jsonb_array_length(r.permissions)>0
           )`,
          [providerSubject],
        )
      ).rows[0];
      if (!row) return null;
      const parsed = id('staff', row.id);
      return parsed.ok ? parsed.value : stop('integrity');
    },
  } satisfies StaffIdentityRepository);
}
