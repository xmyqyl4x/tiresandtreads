import { fileURLToPath } from 'node:url';
import { reviewRestoreEvidence } from './restore-evidence.mjs';
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--require-inputs'))
    throw Error('Unsupported request');
  const report = reviewRestoreEvidence(fileURLToPath(new URL('../../', import.meta.url)));
  console.log(JSON.stringify(report));
  if (report.fileReview.issues.length) process.exitCode = 1;
  else if (args.length) process.exitCode = 2;
} catch {
  console.error('Restore readiness refused; inspect repository state locally.');
  process.exitCode = 1;
}
