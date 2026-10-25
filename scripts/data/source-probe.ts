import { readFile, stat } from 'node:fs/promises';
import { parseSourceSpec } from '../../packages/application/src/services/source-policy.ts';
import { probeSource } from '../../packages/integrations/src/sources/probe.ts';
try {
  const [flag, path, ...extra] = process.argv.slice(2);
  if (flag !== '--spec' || !path || extra.length) throw Error('Invalid probe');
  const info = await stat(path);
  if (!info.isFile() || info.size > 2048) throw Error('Invalid probe');
  const spec = parseSourceSpec(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))),
  );
  if (!spec.ok) throw Error('Invalid probe');
  const result = await probeSource(spec.value);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error: { code: 'unavailable', messageKey: 'errors.source_probe' },
    }),
  );
  process.exitCode = 1;
}
