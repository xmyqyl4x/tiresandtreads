import { issueLocalCallbackKeys } from '../../packages/integrations/src/http/callback-keys.ts';
try {
  if (
    process.env.LOCAL_PRODUCT_API !== 'enabled' ||
    !['dev-local', 'stage-local', 'test-local'].includes(process.env.APP_ENV ?? '') ||
    process.env.PROVIDER_MODE !== 'fixtures' ||
    process.argv.length !== 3
  )
    throw Error();
  process.stdout.write(JSON.stringify(await issueLocalCallbackKeys(process.argv[2]!)) + '\n');
} catch {
  process.stderr.write('Synthetic local callback keys refused\n');
  process.exitCode = 1;
}
