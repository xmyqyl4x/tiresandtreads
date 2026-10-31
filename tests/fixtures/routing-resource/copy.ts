import { readdirSync, lstatSync, readFileSync, writeFileSync, chownSync, chmodSync } from 'node:fs';
import { must } from '../tls-admission/contract.ts';

// Network-none owned TLS-volume replacement, byte-identical to the original.
const files = ['server.expired.crt', 'server.future.crt', 'server.key', 'server.valid.crt'];
must(JSON.stringify(readdirSync('/original').sort()) === JSON.stringify(files));
must(readdirSync('/replacement').length === 0);
for (const name of files) {
  const src = '/original/' + name,
    dst = '/replacement/' + name,
    stat = lstatSync(src);
  must(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65536);
  if (name === 'server.key') must(stat.uid === 999 && (stat.mode & 0o777) === 0o600);
  const bytes = readFileSync(src);
  writeFileSync(dst, bytes, { flag: 'wx', mode: stat.mode & 0o777 });
  chownSync(dst, stat.uid, stat.gid);
  chmodSync(dst, stat.mode & 0o777);
  must(readFileSync(dst).equals(bytes));
}
console.log(
  'RR_COPY_EVIDENCE ' +
    JSON.stringify({
      files: 4,
      bytesIdentical: true,
      privateKeyOwnerModePreserved: true,
      sqlDispatches: 0,
      providerDispatches: 0,
    }),
);
