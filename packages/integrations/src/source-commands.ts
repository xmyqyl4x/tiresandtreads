import { readFile, stat } from 'node:fs/promises';
import { id } from '../../domain/src/values/core.ts';
import { parseSourceSpec } from '../../application/src/services/source-policy.ts';
import { sourceLocation } from './sources/nhtsa.ts';
import type { createImportRuntime } from './import-runtime.ts';
export async function runSourceCommand(
  args: readonly string[],
  runtime: Awaited<ReturnType<typeof createImportRuntime>>,
) {
  const [command, flag, value] = args;
  if (command === 'tick' && args.length === 1) return runtime.sourceRefresh.tick();
  if (command === 'refresh' && flag === '--connector' && args.length === 3) {
    const parsed = id('source_connector', value);
    if (!parsed.ok) throw Error('Invalid connector');
    return runtime.sourceRefresh.refresh(parsed.value);
  }
  if (command === 'recall-ready' && flag === '--dataset' && args.length === 3) {
    const parsed = id('dataset', value);
    if (!parsed.ok) throw Error('Invalid dataset');
    return runtime.sourceRefresh.requireRecall(parsed.value);
  }
  if (command !== 'register' || flag !== '--plan' || !value || args.length !== 3)
    throw Error('Invalid source command');
  const info = await stat(value);
  if (!info.isFile() || info.size > 8192) throw Error('Invalid source plan');
  const x: Record<string, unknown> = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(value)),
  );
  if (
    !x ||
    Array.isArray(x) ||
    Object.keys(x).sort().join(',') !== 'actorId,approvalId,id,licenseId,providerId,spec'
  )
    throw Error('Invalid source plan');
  const connector = id('source_connector', x.id),
    provider = id('provider', x.providerId),
    license = id('license', x.licenseId),
    actor = id('staff', x.actorId),
    approval = id('audit_event', x.approvalId),
    spec = parseSourceSpec(x.spec);
  if (!connector.ok || !provider.ok || !license.ok || !actor.ok || !approval.ok || !spec.ok)
    throw Error('Invalid source plan');
  return runtime.registerSource({
    id: connector.value,
    providerId: provider.value,
    licenseId: license.value,
    actorId: actor.value,
    approvalId: approval.value,
    spec: spec.value,
    ...sourceLocation(spec.value),
  });
}
