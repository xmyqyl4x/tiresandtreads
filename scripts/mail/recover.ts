import { createTransactions } from '../../packages/db/src/transactions.ts';
import { createRuntimePool } from '../../packages/db/src/runtime-pool.ts';
import { createMailEventsRuntime } from '../../packages/integrations/src/mail-events-runtime.ts';
import { createResendProvider } from '../../packages/integrations/src/resend.ts';
import { runMailCommand } from '../../packages/integrations/src/mail-commands.ts';
try {
  const raw = process.env.MAIL_OPERATIONS_DATABASE_URL;
  if (!raw) throw Error('Missing configuration');
  const url = new URL(raw),
    versions = (process.env.CONTACT_LOOKUP_VERSIONS ?? '').split(',');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username !== 'tt_private_runtime' ||
    !url.password ||
    versions.length > 4 ||
    versions.some((v) => !/^[A-Za-z0-9_-]{1,80}$/.test(v))
  )
    throw Error('Invalid configuration');
  const pool = createRuntimePool(raw, 1);
  try {
    const provider = createResendProvider({
      enabled: process.env.MAIL_PROVIDER_READS_ENABLED === 'true',
      senderAddresses: [],
      apiKey: async () => process.env.RESEND_API_KEY ?? null,
    });
    const services = await createMailEventsRuntime({
      scope: createTransactions(pool.pool),
      lookupVersions: versions,
      retrieve: provider.retrieve,
    });
    const result = await runMailCommand(process.argv.slice(2), services);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await pool.drain();
  }
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error: { code: 'unavailable', messageKey: 'errors.mail_operations', retryable: false },
    }),
  );
  process.exitCode = 1;
}
