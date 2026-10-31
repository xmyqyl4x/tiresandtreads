import { resource, binding } from './resources.ts';
import { material } from './material.ts';
import { must } from './contract.ts';
// Pinned-runtime, network-none helper. Raw Docker inspect can contain setup
// credentials: emit only the fixed, sanitized projection, never the input.
try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    must(Buffer.byteLength(raw) <= 2097152);
  }
  const r = JSON.parse(raw);
  must(Array.isArray(r.containers) && r.containers.length === 2);
  const domains = r.containers.map((c: unknown, slot: number) =>
    resource(c, r.project, slot as 0 | 1, r.variant),
  );
  const b = binding({
    version: 1,
    project: r.project,
    fixtureGeneration: r.fixtureGeneration,
    variant: r.variant,
    domains,
    material: material(),
  });
  process.stdout.write(JSON.stringify(b));
} catch {
  throw Error('Disposable resource binding refused');
}
