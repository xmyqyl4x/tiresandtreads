import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { digest, must } from './contract.ts';

// Trusted same-run custodian comparison, not an independent authentication seal.
// No bytes, keys or individual credential digests leave this fixed-path reader.
export function material() {
  const groups = [
    { path: '/owners', files: ['context.json'], limit: 32768 },
    { path: '/trust', files: ['ca.crt', 'wrong-ca.crt'], limit: 65536 },
    ...['source', 'target'].map((domain) => ({
      path: '/custody/' + domain,
      files: ['server.valid.crt', 'server.expired.crt', 'server.future.crt', 'server.key'],
      limit: 65536,
    })),
  ];
  return digest(
    groups.map((g) => {
      must(JSON.stringify(readdirSync(g.path).sort()) === JSON.stringify([...g.files].sort()));
      return g.files.map((name) => {
        const path = g.path + '/' + name,
          stat = lstatSync(path);
        must(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= g.limit);
        if (name === 'server.key')
          must(stat.size <= 8192 && stat.uid === 999 && (stat.mode & 0o777) === 0o600);
        if (name === 'context.json') must((stat.mode & 0o777) === 0o600);
        return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
      });
    }),
  );
}
