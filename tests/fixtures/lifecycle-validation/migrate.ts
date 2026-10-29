import { disposableTargets } from '../foundation/target.ts';
import { migrateCms } from '../../../scripts/database/cms.ts';
import { lifecycleDatabases } from './reader.ts';

try {
  disposableTargets(process.env);
  const raw = process.env.TT_LIFECYCLE_CMS_URL ?? '',
    secret = process.env.TT_LIFECYCLE_CMS_SECRET ?? '',
    url = new URL(raw);
  if (
    process.env.PROVIDER_MODE !== 'fixtures' ||
    url.protocol !== 'postgresql:' ||
    url.hostname !== 'postgres' ||
    url.port !== '5432' ||
    url.username !== 'tt_cms_migrator' ||
    !/^[a-f0-9]{64}$/.test(url.password) ||
    url.pathname !== '/' + lifecycleDatabases.cms ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(secret)
  )
    throw Error();
  await migrateCms({ kind: 'cms', database: lifecycleDatabases.cms, url: raw }, secret);
  process.exit(0);
} catch {
  console.error('Disposable lifecycle CMS migration refused');
  process.exit(1);
}
