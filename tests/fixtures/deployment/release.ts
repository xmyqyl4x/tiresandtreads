import { writeFileSync } from 'node:fs';
import { admitLocalRelease } from '../../../scripts/deployment/preflight.ts';

try {
  if (process.argv.length !== 3 || Buffer.byteLength(process.argv[2] ?? '') > 8192) throw Error();
  const release = admitLocalRelease(JSON.parse(process.argv[2]!), process.env);
  // Create with the controller's container identity; never inherit host UID/mode through copy.
  writeFileSync('/deployment/release.json', JSON.stringify(release), { mode: 0o600, flag: 'wx' });
  console.log('Local release admitted and written by fixture controller');
} catch {
  console.error('Local release fixture refused');
  process.exitCode = 1;
}
