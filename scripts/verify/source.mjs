import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ignored = new Set([
  '.git',
  '.local',
  '.work',
  'node_modules',
  '.next',
  'coverage',
  'test-results',
  'playwright-report',
]);
const paths = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const name = path.posix.join(directory.replaceAll('\\', '/'), entry.name);
    if (name === 'docs/sources') continue; // Preserve supplied archives byte-for-byte.
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${name}`);
    if (entry.isDirectory()) walk(name);
    else paths.push(name);
  }
}
walk('.');
const folded = new Set();
for (const name of paths) {
  const key = name.toLowerCase();
  if (folded.has(key)) throw new Error(`Case-colliding source path: ${name}`);
  folded.add(key);
  if (/\/(\.env($|\.)|.*\.(pem|dump)$)/.test('/' + name) && !name.endsWith('.env.example'))
    throw new Error(`Private environment/artifact in source: ${name}`);
  if (statSync(name).size > 2_000_000 || !/\.(ts|tsx|mjs|cjs|json|ya?ml|sql|md)$/.test(name))
    continue;
  const text = readFileSync(name, 'utf8');
  if (!name.endsWith('.md') && text.includes('\r')) throw new Error(`Use LF line endings: ${name}`);
  if (
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      text,
    )
  )
    throw new Error(`Possible credential/private key in ${name}; inspect locally`);
}
console.log(
  `Source hygiene passed: ${paths.length} files; no case collisions, private env artifacts or recognized credential patterns`,
);
