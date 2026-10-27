import type pg from 'pg';
export async function assertNoProviderData(client: pg.Client, keyId: string) {
  if (!keyId || keyId.length > 100) throw Error('Invalid retired fixture key');
  if (
    (
      await client.query(
        "SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND usename LIKE 'tt_%runtime' LIMIT 1",
      )
    ).rows.length
  )
    throw Error('Quiesce runtime processes before provider upgrade');
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  const columns = (
    await client.query(
      "SELECT n.nspname AS schema,c.relname AS table,a.attname AS column FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','migration_meta') AND n.nspname NOT LIKE 'pg_%' AND a.attname ~ '(cipher|encrypted|wrapped)'",
    )
  ).rows;
  for (const c of columns)
    if (
      (
        await client.query(
          `SELECT 1 FROM ${quote(c.schema)}.${quote(c.table)} WHERE ${quote(c.column)} IS NOT NULL LIMIT 1`,
        )
      ).rows.length
    )
      throw Error('Stored encrypted data requires a separate migration');
  const tables = (
    await client.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','migration_meta') AND schemaname NOT LIKE 'pg_%'",
    )
  ).rows;
  for (const t of tables)
    if (
      (
        await client.query(
          `SELECT 1 FROM ${quote(t.schemaname)}.${quote(t.tablename)} r WHERE strpos(to_jsonb(r)::text,$1)>0 LIMIT 1`,
          [keyId],
        )
      ).rows.length
    )
      throw Error('Stored key references require a separate migration');
  return columns.length;
}
