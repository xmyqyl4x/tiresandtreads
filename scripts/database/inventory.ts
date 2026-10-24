import { createHash } from 'node:crypto';
import type pg from 'pg';

// Read-only PostgreSQL catalogue inventory; no credentials, row values or unstable OIDs.
export async function schemaInventory(db: pg.Client) {
  const namespaces = ['app', 'admin', 'privacy', 'email', 'analytics', 'public', 'migration_meta'];
  const queries = {
    schemas: `SELECT nspname AS name,pg_get_userbyid(nspowner) AS owner,ARRAY(SELECT x::text FROM unnest(nspacl) x ORDER BY x::text) AS acl FROM pg_namespace WHERE nspname=ANY($1) ORDER BY nspname`,
    relations: `SELECT n.nspname||'.'||c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,ARRAY(SELECT x::text FROM unnest(c.relacl) x ORDER BY x::text) AS acl,
      ARRAY(SELECT a.attname||' '||format_type(a.atttypid,a.atttypmod)||CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END||COALESCE(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),'') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
      CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS view
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('r','p','v','S') ORDER BY name`,
    constraints: `SELECT n.nspname||'.'||c.relname AS relation,k.conname AS name,k.contype AS type,k.convalidated AS validated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) ORDER BY relation,name`,
    indexes: `SELECT n.nspname||'.'||t.relname AS relation,c.relname AS name,i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY($1) ORDER BY relation,name`,
    triggers: `SELECT n.nspname||'.'||c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT t.tgisinternal ORDER BY relation,name`,
    routines: `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS name,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,ARRAY(SELECT x::text FROM unnest(p.proacl) x ORDER BY x::text) AS acl,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) ORDER BY name`,
    defaults: `SELECT pg_get_userbyid(d.defaclrole) AS owner,COALESCE(n.nspname,'*') AS schema,d.defaclobjtype AS type,ARRAY(SELECT x::text FROM unnest(d.defaclacl) x ORDER BY x::text) AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY owner,schema,type`,
    enums: `SELECT n.nspname||'.'||t.typname AS name,array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname=ANY($1) GROUP BY n.nspname,t.typname ORDER BY name`,
  };
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const [key, query] of Object.entries(queries))
    result[key] = (await db.query(query, key === 'defaults' ? [] : [namespaces])).rows;
  return result;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function schemaHealth(db: pg.Client): Promise<string[]> {
  const errors: string[] = [];
  const inventory = await schemaInventory(db);
  for (const row of inventory.constraints ?? [])
    if (!row.validated) errors.push(`Unvalidated constraint: ${row.name}`);
  for (const row of inventory.indexes ?? [])
    if (!row.valid || !row.ready) errors.push(`Invalid index: ${row.name}`);
  for (const row of inventory.triggers ?? [])
    if (row.enabled !== 'O') errors.push(`Disabled trigger: ${row.name}`);
  const fks = await db.query(
    `SELECT conname,conrelid,conkey FROM pg_constraint WHERE contype='f' AND connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('app','admin','privacy','email','analytics','public'))`,
  );
  for (const fk of fks.rows) {
    const indexes = await db.query(
      'SELECT indkey::text AS columns FROM pg_index WHERE indrelid=$1 AND indisvalid AND indpred IS NULL',
      [fk.conrelid],
    );
    if (
      !indexes.rows.some(
        (row) =>
          row.columns.split(' ').slice(0, fk.conkey.length).map(Number).join(',') ===
          fk.conkey.join(','),
      )
    )
      errors.push(`Unindexed foreign key: ${fk.conname}`);
  }
  return errors;
}
