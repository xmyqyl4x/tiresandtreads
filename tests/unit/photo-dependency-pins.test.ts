import { it, expect } from 'vitest';
import {
  mkdtempSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { photoDependencyPins } from '../../scripts/review/product-source-pins.mjs';
import { reviewRestoreEvidence } from '../../scripts/review/restore-evidence.mjs';
it('reconciles exactly the declared photo tooling dependencies without promoting historical execution to acceptance', () => {
  const report = reviewRestoreEvidence(process.cwd());
  expect(
    JSON.parse(
      readFileSync('docs/implementation/evidence/P2/p2-pr-014-dependency-transition.json', 'utf8'),
    ).exactPins,
  ).toEqual(photoDependencyPins);
  expect(report.fileReview).toMatchObject({ matchedPins: 378, issues: [] });
  expect(report).toMatchObject({
    historicalExecutionOnly: true,
    fixtureExecutions: 0,
    accepted: false,
    runtimeAdmission: false,
    hostedAccepted: false,
    providerDispatches: 0,
    actualRecipientNotifications: 0,
    casesClosed: 0,
    gatesClosed: 0,
  });
});
it.each(['package.json', 'pnpm-lock.yaml'])(
  'still detects further unreviewed drift in %s and leaves the changed bytes intact',
  (path) => {
    const parent = realpathSync(tmpdir()),
      root = mkdtempSync(join(parent, 'tt-photo-dependencies-'));
    try {
      const report = reviewRestoreEvidence(process.cwd());
      for (const p of [
        ...report.reviewedPaths,
        'docs/implementation/evidence/P1/p1-pr-027-restore-readiness-baseline.json',
      ]) {
        const target = join(root, p);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(p, target);
      }
      const target = join(root, path);
      writeFileSync(target, readFileSync(target, 'utf8') + '\n');
      const before = readFileSync(target);
      const adverse = reviewRestoreEvidence(root);
      expect(adverse.fileReview.issues).toEqual([{ path, code: 'digest-mismatch' }]);
      expect(adverse.recordedHandoff).toBeNull();
      expect(adverse.accepted).toBe(false);
      expect(readFileSync(target)).toEqual(before);
    } finally {
      cleanup(root, parent);
    }
  },
  30000,
);

function cleanup(root: string, parent: string) {
  if (dirname(root) !== parent || realpathSync(root) !== root || lstatSync(root).isSymbolicLink())
    throw Error('Owned review directory changed');
  rmSync(root, { recursive: true });
}
