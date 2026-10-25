import { readFile, stat } from 'node:fs/promises';
import { id, revision } from '../../domain/src/values/core.ts';
import type { createImportService } from '../../application/src/services/ingestion.ts';
import type { PublishInput } from '../../application/src/ports/ingestion.ts';
import type { RollbackInput } from '../../application/src/ports/import-service.ts';
import { openImportSnapshot } from './import-files.ts';

export function parseHead(x: unknown): PublishInput['expectedHead'] {
  if (x === null) return null;
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('Invalid plan');
  const head = x as Record<string, unknown>,
    bundle = id('bundle', head.bundleId),
    rev = revision(head.revision);
  if (Object.keys(head).sort().join(',') !== 'bundleId,revision' || !bundle.ok || !rev.ok)
    throw Error('Invalid plan');
  return { bundleId: bundle.value, revision: rev.value };
}
export function parseImportPlan(raw: unknown, rollback: boolean) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid plan');
  const x = raw as Record<string, unknown>;
  const keys = [
    'bundleId',
    'market',
    'actorId',
    'approvalId',
    'expectedHead',
    ...(rollback ? [] : ['runId', 'members']),
  ];
  const bundle = id('bundle', x.bundleId),
    actor = id('staff', x.actorId),
    approval = id('audit_event', x.approvalId);
  if (
    Object.keys(x).sort().join(',') !== keys.sort().join(',') ||
    !bundle.ok ||
    !actor.ok ||
    !approval.ok ||
    typeof x.market !== 'string' ||
    !/^[A-Z]{2}$/.test(x.market)
  )
    throw Error('Invalid plan');
  const base = {
    bundleId: bundle.value,
    market: x.market,
    actorId: actor.value,
    approvalId: approval.value,
    expectedHead: parseHead(x.expectedHead),
  };
  if (rollback) {
    if (!base.expectedHead) throw Error('Invalid plan');
    return { ...base, expectedHead: base.expectedHead } satisfies RollbackInput;
  }
  const run = id('import_run', x.runId);
  if (!run.ok || !Array.isArray(x.members) || x.members.length < 1 || x.members.length > 16)
    throw Error('Invalid plan');
  const members = x.members.map((m) => {
    if (
      !m ||
      typeof m !== 'object' ||
      Array.isArray(m) ||
      Object.keys(m).sort().join(',') !== 'datasetId,key,kind'
    )
      throw Error('Invalid plan');
    const v = m as Record<string, unknown>,
      dataset = id('dataset', v.datasetId);
    if (
      !dataset.ok ||
      typeof v.key !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,79}$/.test(v.key) ||
      typeof v.kind !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,79}$/.test(v.kind)
    )
      throw Error('Invalid plan');
    return { key: v.key, kind: v.kind, datasetId: dataset.value };
  });
  if (new Set(members.map((m) => m.key)).size !== members.length) throw Error('Invalid plan');
  return {
    ...base,
    runId: run.value,
    members,
    required: members.map((m) => ({ key: m.key, kind: m.kind })),
  };
}
export async function runImportCommand(
  args: readonly string[],
  service: ReturnType<typeof createImportService>,
) {
  const [command, ...rest] = args;
  const allowed: Record<string, readonly string[]> = {
    'dry-run': ['manifest', 'file'],
    resume: ['manifest', 'file'],
    status: ['run'],
    diff: ['run', 'against'],
    publish: ['plan'],
    rollback: ['plan'],
  };
  if (!command || !Object.hasOwn(allowed, command) || rest.length !== allowed[command]!.length * 2)
    throw Error('Invalid import command');
  const options: Record<string, string> = {};
  for (let n = 0; n < rest.length; n += 2) {
    const key = rest[n]!.slice(2),
      v = rest[n + 1]!;
    if (
      !rest[n]!.startsWith('--') ||
      !allowed[command]!.includes(key) ||
      Object.hasOwn(options, key) ||
      !v ||
      v.startsWith('--')
    )
      throw Error('Invalid import command');
    options[key] = v;
  }
  if (command === 'dry-run' || command === 'resume')
    return service.prepare(await openImportSnapshot(options.manifest!, options.file!));
  if (command === 'status' || command === 'diff') {
    const run = id('import_run', options.run);
    if (!run.ok) throw Error('Invalid run');
    if (command === 'status') return service.status(run.value);
    const bundle = id('bundle', options.against);
    if (options.against !== 'none' && !bundle.ok) throw Error('Invalid bundle');
    return service.diff(run.value, bundle.ok ? bundle.value : null);
  }
  const info = await stat(options.plan!);
  if (!info.isFile() || info.size > 16384) throw Error('Invalid plan');
  const raw: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(options.plan!)),
  );
  const plan = parseImportPlan(raw, command === 'rollback');
  return 'runId' in plan ? service.publish(plan) : service.rollback(plan);
}
