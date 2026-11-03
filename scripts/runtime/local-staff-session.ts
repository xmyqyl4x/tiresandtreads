import { loadServiceHostSettings } from '../../packages/integrations/src/service-host-config.ts';
import { issueLocalStaffFiles } from '../../packages/integrations/src/http/fixture-files.ts';
try {
  const env = process.env;
  if (
    env.LOCAL_PRODUCT_API !== 'enabled' ||
    !['dev-local', 'stage-local', 'test-local'].includes(env.APP_ENV ?? '') ||
    env.PROVIDER_MODE !== 'fixtures' ||
    process.argv.length !== 4
  )
    throw Error();
  const settings = loadServiceHostSettings(env),
    secret = new Uint8Array(
      Buffer.from(settings.keys.report.values[settings.keys.report.current]!, 'hex'),
    );
  const files = await issueLocalStaffFiles({
    directory: process.argv[2]!,
    staffId: process.argv[3]!,
    secret,
  });
  process.stdout.write(JSON.stringify(files) + '\n');
} catch {
  process.stderr.write('Synthetic local staff fixture refused\n');
  process.exitCode = 1;
}
