import { createImportRuntime } from '../../packages/integrations/src/import-runtime.ts';
import { runSourceCommand } from '../../packages/integrations/src/source-commands.ts';
try {
  const runtime = await createImportRuntime(process.env);
  try {
    const result = await runSourceCommand(process.argv.slice(2), runtime);
    console.log(JSON.stringify(result, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
    if (!result.ok || (Array.isArray(result.value) && result.value.some((x) => !x.result.ok)))
      process.exitCode = 1;
  } finally {
    await runtime.shutdown();
  }
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error: { code: 'unavailable', messageKey: 'errors.source_command', retryable: false },
    }),
  );
  process.exitCode = 1;
}
