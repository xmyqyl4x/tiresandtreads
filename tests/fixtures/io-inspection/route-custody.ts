import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { binding } from '../tls-admission/resources.ts';
import { must, digest } from '../tls-admission/contract.ts';
import { readJson } from '../multitarget-plan/json.ts';

// Trusted network-none preparation; the host file stays private. Only this
// fixed actor has DAC_OVERRIDE; no owner/admin credential or server-key mount.
must(process.argv.length === 2 && process.getuid?.() === 0);
const source = lstatSync('/binding.json');
must(source.isFile() && !source.isSymbolicLink() && source.size > 0 && source.size <= 32768);
const b = binding(readJson(readFileSync('/binding.json', 'utf8'), 32768));
must(
  b.project === process.env.ISOLATED_TEST_PROJECT &&
    b.fixtureGeneration === process.env.FIXTURE_GENERATION,
);
must(
  Object.keys(b).sort().join(',') === 'domains,fixtureGeneration,material,project,variant,version',
);
for (const d of b.domains) {
  must(
    Object.keys(d).sort().join(',') === 'address,aliases,command,id,mounts,network,slot,startedAt',
  );
  for (const m of d.mounts) must(Object.keys(m).sort().join(',') === 'destination,name,rw');
}
must(readdirSync('/routes').length === 0);
const raw = JSON.stringify(b);
must(Buffer.byteLength(raw) <= 32768);
writeFileSync('/routes/binding.json', raw, { flag: 'wx', mode: 0o400 });
const prepared = lstatSync('/routes/binding.json');
must(prepared.uid === 0 && (prepared.mode & 0o777) === 0o400 && prepared.isFile());
must(digest(binding(JSON.parse(readFileSync('/routes/binding.json', 'utf8')))) === digest(b));
console.log(
  'IO_ROUTE_CUSTODY_EVIDENCE ' +
    JSON.stringify({
      boundedMetadataOnly: true,
      ownerUid: 0,
      mode: '0400',
      hostFilePermissionsChanged: false,
      sqlDispatches: 0,
      providerDispatches: 0,
      casesClosed: 0,
      gatesClosed: 0,
    }),
);
