import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getPayload } from 'payload';
import { schemaFixture } from './database.ts';
import { cmsFoundationConfig } from '../../../scripts/database/cms-config.ts';

const urls = await schemaFixture();
const directory = path.resolve('.local/cms-generated');
mkdirSync(directory, { recursive: true });
const baseline = process.argv[2];
if (baseline && !/^\d{4}_[a-z0-9_]+$/.test(baseline)) throw new Error('Invalid snapshot baseline');
// Generate a delta from the committed Payload snapshot, not a new empty CMS schema.
for (const file of readdirSync('infra/database/cms')) {
  if (/^\d{4}_[a-z0-9_]+\.json$/.test(file) && (!baseline || file <= baseline + '.json'))
    copyFileSync(path.resolve('infra/database/cms', file), path.join(directory, file));
}
const payload = await getPayload({
  config: cmsFoundationConfig(urls.tt_cms_migrator, randomBytes(32).toString('hex'), directory),
});
try {
  await payload.db.createMigration({
    payload,
    migrationName: 'editorial',
    forceAcceptWarning: true,
  });
} finally {
  await payload.destroy();
}
// Payload's generation toolchain retains idle handles after destruction; this is an operator CLI.
process.exit(0);
