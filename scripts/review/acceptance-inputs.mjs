import { fileURLToPath } from 'node:url';
import { readReviewJson } from './repository-files.mjs';
import { buildAcceptanceInputReview } from './input-contract.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--require-inputs'))
    throw Error('Unsupported review request');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const read = (name) => readReviewJson(root, 'docs/implementation/evidence/P1/' + name);
  const report = buildAcceptanceInputReview({
    register: read('s3-service-register.json'),
    decisions: read('p1-pr-027-staging-decision.json'),
    operations: read('p1-pr-027-staging-operations-budget.json'),
    specialist: read('p1-pr-017-golden-review.json'),
  });
  console.log(JSON.stringify(report));
  if (args.length) process.exitCode = 2;
} catch {
  console.error('Acceptance input review refused; inspect repository state locally.');
  process.exitCode = 1;
}
