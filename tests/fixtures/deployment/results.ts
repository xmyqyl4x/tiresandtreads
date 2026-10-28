import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { localProviderProject } from '../../../packages/config/src/provider-preflight.ts';

localProviderProject(process.env);
const counts = { access: 4, 'database-outage': 1, 'candidate-loss': 1, rollback: 1 } as const;
const phase = process.argv[2] as keyof typeof counts;
assert.equal(process.argv.length, 3);
assert(Object.hasOwn(counts, phase));
const path = `/deployment/results-${phase}.json`;
assert(statSync(path).isFile() && statSync(path).size <= 1_048_576);
const result = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(result.success, true);
assert.equal(result.numTotalTests, 7);
assert.equal(result.numPassedTests, counts[phase]);
assert.equal(result.numFailedTests, 0);
assert.equal(result.numPendingTests, 7 - counts[phase]);
console.log(`Deployment phase ${phase}: required ${counts[phase]} cases passed`);
