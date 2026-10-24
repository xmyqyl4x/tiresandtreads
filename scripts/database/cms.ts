import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getPayload } from 'payload';
import { sql, type MigrateUpArgs } from '@payloadcms/db-postgres';
import { cmsFoundationConfig } from './cms-config.ts';
import { loadSources, pendingMigrations, type MigrationSource } from './manifest.ts';
import { readHistory, withMigrationLock, type MigrationTarget } from './migrate.ts';

export async function migrateCms(
  target: MigrationTarget,
  secret: string,
  sources: readonly MigrationSource[] = loadSources('cms'),
): Promise<number> {
  if (target.kind !== 'cms') throw new Error('CMS runner refuses application target');
  return withMigrationLock(target, async (client) => {
    const history = await readHistory(client);
    const pending = pendingMigrations(sources, history);
    const exists = await client.query("SELECT to_regclass('public.payload_migrations') AS name");
    const native = exists.rows[0]?.name
      ? (await client.query('SELECT name, batch FROM public.payload_migrations ORDER BY name')).rows
      : [];
    if (
      native.some((entry) => entry.batch < 0) ||
      JSON.stringify(native.map((entry) => entry.name)) !==
        JSON.stringify(history.map((entry) => entry.id))
    )
      throw new Error('Payload and checksum migration histories differ; schema push is forbidden');
    if (!pending.length) return 0;
    const migrations = await Promise.all(
      sources.map(async (source, index) => {
        // Only checksum-validated, allowlisted repository paths are imported by this operator command.
        const module = await import(
          pathToFileURL(path.resolve('infra/database/cms', source.id + '.ts')).href
        );
        if (typeof module.up !== 'function' || typeof module.down !== 'function')
          throw new Error('Invalid CMS migration exports');
        return {
          name: source.id,
          down: async () => {
            await module.down();
          },
          up: async (value: unknown) => {
            // Payload's common adapter types erase its PostgreSQL transaction argument.
            if (
              !value ||
              typeof value !== 'object' ||
              !('db' in value) ||
              !value.db ||
              typeof value.db !== 'object' ||
              !('execute' in value.db) ||
              typeof value.db.execute !== 'function'
            )
              throw new Error('Expected Payload PostgreSQL transaction');
            const args = value as MigrateUpArgs;
            await module.up(args);
            // Payload supplies its transaction client; DDL, checksum and native ledger commit together.
            await args.db.execute(
              sql`INSERT INTO migration_meta.applied (position,id,sha256) VALUES (${index + 1},${source.id},${source.sha256})`,
            );
          },
        };
      }),
    );
    const payload = await getPayload({
      // getPayload caches by key even after destroy(); each operator run needs a live adapter.
      key: `migration-${target.database}-${randomUUID()}`,
      config: cmsFoundationConfig(target.url, secret),
    });
    try {
      await payload.db.migrate({ migrations });
    } finally {
      await payload.destroy();
    }
    return pending.length;
  });
}
