import { resource, binding } from '../tls-admission/resources.ts';
import { material } from '../tls-admission/material.ts';
import { must, digest } from '../tls-admission/contract.ts';

// Trusted network-none parent observation. Raw inspect may contain setup
// credentials; output only controlled predicates, never input or identities.
try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    must(Buffer.byteLength(raw) <= 2097152);
  }
  const r = JSON.parse(raw),
    b = binding(r.expected);
  must(['before', 'container', 'tls-volume', 'shared-tls'].includes(r.mode));
  must(Array.isArray(r.containers) && r.containers.length === 2 && material() === b.material);
  const domains: ReturnType<typeof resource>[] = r.containers.map((x: unknown, i: number) =>
    resource(x, b.project, i as 0 | 1, 'valid'),
  );
  if (r.mode === 'before') must(digest(domains) === digest(b.domains));
  else {
    const slot = r.mode === 'shared-tls' ? 1 : 0,
      peer = slot === 0 ? 1 : 0;
    const now = domains[slot]!,
      old = b.domains[slot]!;
    must(digest(domains[peer]) === digest(b.domains[peer]));
    must(now.id !== old.id && now.startedAt !== old.startedAt);
    const mount = (d: typeof now, path: string) =>
      d.mounts.find((x) => x.destination === path)!.name;
    must(mount(now, '/var/lib/postgresql') === mount(old, '/var/lib/postgresql'));
    if (r.mode === 'container') must(digest(now.mounts) === digest(old.mounts));
    if (r.mode === 'tls-volume')
      must(
        mount(now, '/tls') === b.project + '_source-tls-replacement' &&
          mount(now, '/tls') !== mount(old, '/tls'),
      );
    if (r.mode === 'shared-tls') {
      must(mount(now, '/tls') === mount(domains[0]!, '/tls'));
      let refused = false;
      try {
        binding({ ...b, domains });
      } catch {
        refused = true;
      }
      must(refused);
    }
  }
  process.stdout.write(
    JSON.stringify({
      mode: r.mode,
      currentOwnedResourceFactsChecked: true,
      materialDigestUnchanged: true,
      changedResourceNotAdopted: true,
      sharedTlsMount: r.mode === 'shared-tls',
      volumeAndIncarnationChanged: r.mode === 'tls-volume',
      originalDataVolumesPreserved: true,
      casesClosed: 0,
      gatesClosed: 0,
    }),
  );
} catch {
  throw Error('Fixed routing/resource witness refused');
}
