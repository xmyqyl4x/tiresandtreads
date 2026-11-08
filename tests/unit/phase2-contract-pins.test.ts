import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { apiContractPins, photoDependencyPins } from '../../scripts/review/product-source-pins.mjs';

it('chains the exact API script transition after photo dependencies without changing historical pins', () => {
  const manifest = JSON.parse(
    readFileSync('docs/implementation/evidence/P2/p2-pr-020-contract-transition.json', 'utf8'),
  );
  expect(manifest.exactPins).toEqual(apiContractPins);
  expect(apiContractPins).toHaveLength(1);
  expect(apiContractPins[0]).toMatchObject({
    path: 'package.json',
    baselineSha256: photoDependencyPins.find((x) => x.path === 'package.json')!.currentSha256,
    currentSha256: createHash('sha256').update(readFileSync('package.json')).digest('hex'),
  });
  expect(manifest).toMatchObject({
    dependencyChange: false,
    historicalManifestsRewritten: false,
    actualAcceptance: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
});

it('keeps both default contract commands checking P1 and the opt-in P2 artifact', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(scripts['contracts:generate']).toBe(
    'node scripts/contracts/openapi.mjs && node scripts/contracts/phase2-generate.mjs',
  );
  expect(scripts['contracts:check']).toBe(
    'node scripts/contracts/openapi.mjs --check && node scripts/contracts/phase2-generate.mjs --check',
  );
});
