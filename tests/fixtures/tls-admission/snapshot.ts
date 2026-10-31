import type pg from 'pg';
import { databaseRoles } from '../../../packages/config/src/database-roles.ts';
import { digest, must, budget } from './contract.ts';

const roles = Object.values(databaseRoles).flat();
// Foundation-only catalog observations, bounded before JSON aggregation. No row-data,
// DDL, grant, migration, advisory lock, callback or caller SQL interface.
const sql = `SELECT jsonb_build_object(
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolcanlogin,has_database_privilege(oid,current_database(),'CONNECT') AS connect FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname COLLATE "C" LIMIT 20) q),
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT r.rolname AS role,u.rolname AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname=ANY($1) OR u.rolname=ANY($1) ORDER BY r.rolname,u.rolname LIMIT 101) q),
 'settings',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT r.rolname,d.datname,ARRAY(SELECT x FROM unnest(s.setconfig) x ORDER BY x COLLATE "C") AS config FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE r.rolname=ANY($1) ORDER BY r.rolname,d.datname LIMIT 101) q),
 'schemas',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT nspname,pg_get_userbyid(nspowner) AS owner,ARRAY(SELECT x::text FROM unnest(nspacl) x ORDER BY x::text) AS acl FROM pg_namespace WHERE nspname<>'information_schema' AND nspname!~'^pg_' ORDER BY nspname LIMIT 101) q),
 'databaseAcl',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() ORDER BY grantee,grantor,a.privilege_type LIMIT 101) q),
 'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT pg_get_userbyid(d.defaclrole) AS owner,coalesce(n.nspname,'*') AS schema,d.defaclobjtype AS kind,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a ORDER BY owner,schema,kind,grantee,grantor,a.privilege_type LIMIT 101) q),
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (SELECT kind,name FROM (SELECT 'relation' AS kind,n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname<>'information_schema' AND n.nspname!~'^pg_' UNION ALL SELECT 'routine',n.nspname||'.'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname<>'information_schema' AND n.nspname!~'^pg_' UNION ALL SELECT 'type',n.nspname||'.'||t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname<>'information_schema' AND n.nspname!~'^pg_') x ORDER BY kind,name LIMIT 101) q)
) AS state`;
export async function snapshot(client: pg.Client, owner: string, start?: number) {
  const config = {
    text: sql,
    values: [roles],
    query_timeout: start === undefined ? 1000 : budget(start, performance.now()),
  };
  const state = (await client.query(config)).rows[0]?.state as Record<
    string,
    Record<string, unknown>[]
  >;
  if (start !== undefined) budget(start, performance.now());
  must(state && Buffer.byteLength(JSON.stringify(state)) <= 65536);
  must(Object.values(state).every((a) => Array.isArray(a) && a.length <= 100));
  must(
    state.roles?.length === 19 &&
      state.members?.length === 0 &&
      state.settings?.length === 19 &&
      state.schemas?.length === 1 &&
      state.schemas[0]?.nspname === 'public' &&
      state.schemas[0]?.owner === owner &&
      state.objects?.length === 0,
  );
  must(
    state.roles.every(
      (r) =>
        typeof r.rolname === 'string' &&
        roles.includes(r.rolname as (typeof roles)[number]) &&
        !r.rolsuper &&
        !r.rolcreatedb &&
        !r.rolcreaterole &&
        !r.rolreplication &&
        !r.rolbypassrls &&
        !r.rolinherit &&
        r.rolcanlogin === true &&
        r.connect === (r.rolname === owner),
    ),
  );
  must(!state.defaults?.some((r) => r.grantee === 'PUBLIC'));
  return digest(state);
}
