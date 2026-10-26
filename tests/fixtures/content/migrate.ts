import { randomBytes } from 'node:crypto';
import { disposableTargets } from '../foundation/target.ts';
import { migrateCms } from '../../../scripts/database/cms.ts';
// A child process owns the pinned Payload adapter, including its retained native pool.
disposableTargets(process.env);
const url = new URL(process.env.TT_CONTENT_CMS_URL ?? '');
if (
  url.hostname !== 'postgres' ||
  url.port !== '5432' ||
  url.pathname !== '/tt_cms_content' ||
  url.username !== 'tt_cms_migrator' ||
  !url.password ||
  url.search ||
  url.hash
)
  throw Error('Invalid isolated CMS target');
await migrateCms(
  { url: url.toString(), database: 'tt_cms_content', kind: 'cms' },
  randomBytes(32).toString('hex'),
);
process.exit(0);
