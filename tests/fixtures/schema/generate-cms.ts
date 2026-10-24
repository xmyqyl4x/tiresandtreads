import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getPayload } from 'payload';
import { schemaFixture } from './database.ts';
import { cmsFoundationConfig } from '../../../scripts/database/cms-config.ts';

const urls = await schemaFixture();
const directory = path.resolve('.local/cms-generated');
mkdirSync(directory, { recursive: true });
const payload = await getPayload({
  config: cmsFoundationConfig(urls.tt_cms_migrator, randomBytes(32).toString('hex'), directory),
});
try {
  await payload.db.createMigration({ payload, migrationName: 'staff', forceAcceptWarning: true });
} finally {
  await payload.destroy();
}
// Payload's generation toolchain retains idle handles after destruction; this is an operator CLI.
process.exit(0);
