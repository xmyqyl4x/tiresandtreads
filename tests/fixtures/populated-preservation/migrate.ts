import { migrateCms } from '../../../scripts/database/cms.ts';
import { must } from '../tls-admission/contract.ts';
try {
  const raw = process.env.POPULATED_CMS_URL ?? '';
  const u = new URL(raw);
  must(
    process.env.APP_ENV === 'test-local' &&
      process.env.PROVIDER_MODE === 'fixtures' &&
      /^tt-test-[a-f0-9]{16}$/.test(process.env.ISOLATED_TEST_PROJECT ?? '') &&
      u.protocol === 'postgresql:' &&
      ['postgres.preflight.test', 'recovery-postgres.preflight.test'].includes(u.hostname) &&
      u.port === '5432' &&
      u.username === 'tt_cms_migrator' &&
      /^[a-f0-9]{64}$/.test(u.password) &&
      u.pathname === '/tt_cms_recovery' &&
      !u.search &&
      !u.hash,
  );
  await migrateCms(
    { kind: 'cms', database: 'tt_cms_recovery', url: raw },
    process.env.POSTGRES_PASSWORD!,
  );
  process.exit(0);
} catch {
  console.error('Fixed synthetic CMS migration refused');
  process.exit(1);
}
