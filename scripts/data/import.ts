import { createImportRuntime } from '../../packages/integrations/src/import-runtime.ts';
import { runImportCommand } from '../../packages/integrations/src/import-commands.ts';

try {
  const runtime = await createImportRuntime(process.env);
  try {
    const result = await runImportCommand(process.argv.slice(2), runtime.service);
    console.log(
      JSON.stringify(result, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
    if (!result.ok) process.exitCode = 1;
  } finally {
    await runtime.shutdown();
  }
} catch {
  // Never print connection URLs, source bytes, filesystem paths or provider errors.
  console.error(
    JSON.stringify({
      ok: false,
      error: { code: 'invalid_input', messageKey: 'errors.import_command', retryable: false },
    }),
  );
  process.exitCode = 1;
}
