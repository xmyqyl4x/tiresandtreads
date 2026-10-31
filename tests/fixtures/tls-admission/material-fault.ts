import { readFileSync, writeFileSync } from 'node:fs';
// Parent-only fixed synthetic setup control. The observer cannot invoke it.
// Never repair or re-adopt this generation; destroy its entire owned project.
const path = '/owners/context.json';
if (process.env.TLS_MATERIAL_FAULT === 'material') {
  writeFileSync(path, readFileSync(path, 'utf8') + '\n', { mode: 0o600 });
} else if (process.env.TLS_MATERIAL_FAULT === 'credential') {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  value.owners[0].password = '0'.repeat(64);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
} else throw Error('Disposable material control refused');
