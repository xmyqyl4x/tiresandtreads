import type {
  EditorialAppIdentityRepository,
  EditorialCmsIdentityRepository,
} from '../../../application/src/ports/editorial-identity.ts';
import { id } from '../../../domain/src/values/core.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
export function createEditorialAppIdentityRepository(
  s: WriteScope,
): EditorialAppIdentityRepository {
  return guarded(s, {
    async permissions(tx, staff, requested) {
      if (
        !id('staff', staff).ok ||
        requested.length !== 3 ||
        new Set(requested).size !== 3 ||
        requested.some((p) => !/^editorial\.[a-z][a-z0-9_.]{0,62}$/.test(p))
      )
        return stop('invalid_input');
      if ((await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role !== 'tt_staff_runtime')
        return stop('forbidden');
      const row = (
        await s.query(
          tx,
          `SELECT s.id, ARRAY(
        SELECT DISTINCT p.value FROM admin.staff_role_assignments a
        JOIN admin.roles r ON r.id=a.role_id
        CROSS JOIN LATERAL jsonb_array_elements_text(r.permissions) p(value)
        WHERE a.staff_id=s.id AND a.revoked_at IS NULL AND a.granted_at<=clock_timestamp()
          AND p.value=ANY($2::text[]) ORDER BY p.value
      ) AS permissions FROM admin.staff_identities s WHERE s.id=$1 AND s.status='active'`,
          [staff, [...requested]],
        )
      ).rows[0];
      if (!row) return null;
      if (!Array.isArray(row.permissions) || row.permissions.some((p) => typeof p !== 'string'))
        return stop('integrity');
      return row.permissions as string[];
    },
  } satisfies EditorialAppIdentityRepository);
}
export function createEditorialCmsIdentityRepository(
  s: WriteScope,
): EditorialCmsIdentityRepository {
  return guarded(s, {
    async resolve(tx, staff) {
      if (!id('staff', staff).ok) return stop('invalid_input');
      if ((await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role !== 'tt_cms_runtime')
        return stop('forbidden');
      const row = (
        await s.query(tx, 'SELECT id FROM public.cms_staff WHERE app_staff_id=$1', [staff])
      ).rows[0];
      if (!row) return null;
      const parsed = id('cms_staff', row.id);
      return parsed.ok ? parsed.value : stop('integrity');
    },
  } satisfies EditorialCmsIdentityRepository);
}
