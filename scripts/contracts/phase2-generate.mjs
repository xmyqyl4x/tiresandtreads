import { writeFileSync, readFileSync } from 'node:fs';
import { phase2OpenApi } from './phase2-openapi.ts';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check'))
  throw Error('Use no arguments or --check');
const path = 'docs/api/phase2-local.openapi.json',
  bytes = JSON.stringify(phase2OpenApi(), null, 2) + '\n';
if (args[0] === '--check') {
  if (readFileSync(path, 'utf8') !== bytes) throw Error('Phase2 OpenAPI artifact is stale');
} else writeFileSync(path, bytes);
