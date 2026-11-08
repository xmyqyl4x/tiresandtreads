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
import { reviewRestoreEvidence } from '../../scripts/review/restore-evidence.mjs';
const prefix = 'docs/implementation/evidence/P1/';
it('refuses tampering with the staff source transition without changing its bytes', () =>
  owned((root) => {
    const path = join(root, prefix + 'p1-pr-039-current-source-exceptions.json'),
      adverse = readFileSync(path, 'utf8') + ' ';
    writeFileSync(path, adverse);
    expect(() => reviewRestoreEvidence(root)).toThrow('Restore readiness refused');
    expect(readFileSync(path, 'utf8')).toBe(adverse);
  }));
it('refuses tampering with the second exact editorial transition and preserves the changed bytes', () =>
  owned((root) => {
    const path = join(root, prefix + 'p1-pr-038-current-source-exceptions.json');
    const before = readFileSync(path, 'utf8') + ' ';
    writeFileSync(path, before);
    expect(() => reviewRestoreEvidence(root)).toThrow('Restore readiness refused');
    expect(readFileSync(path, 'utf8')).toBe(before);
  }));
function cleanup(root: string, parent: string) {
  if (dirname(root) !== parent || realpathSync(root) !== root || lstatSync(root).isSymbolicLink())
    throw Error('Owned review directory changed');
  rmSync(root, { recursive: true });
}
function owned(test: (root: string) => void) {
  const parent = realpathSync(tmpdir()),
    root = mkdtempSync(join(parent, 'tt-restore-review-'));
  try {
    const report = reviewRestoreEvidence(process.cwd());
    for (const path of [
      ...report.reviewedPaths,
      prefix + 'p1-pr-027-restore-readiness-baseline.json',
    ]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, target);
    }
    test(root);
  } finally {
    cleanup(root, parent);
  }
}
it(
  'checks actual bytes, reports native-program drift and leaves the adverse bytes untouched',
  () =>
    owned((root) => {
      const path = join(root, 'tests/fixtures/restore-handoff/observe.ts');
      writeFileSync(path, 'SYNTHETIC_SECRET\n');
      const before = readFileSync(path),
        report = reviewRestoreEvidence(root);
      expect(report.status).toBe('drifted');
      expect(report.fileReview.issues).toContainEqual({
        path: 'tests/fixtures/restore-handoff/observe.ts',
        code: 'digest-mismatch',
      });
      expect(report.recordedHandoff).toBeNull();
      expect(report.accepted).toBe(false);
      expect(JSON.stringify(report)).not.toContain('SYNTHETIC_SECRET');
      expect(readFileSync(path)).toEqual(before);
    }),
  30000,
);
it(
  'refuses a changed raw manifest before semantic interpretation or receipt reporting',
  () =>
    owned((root) => {
      const path = join(root, prefix + 'p1-pr-027-restore-handoff-local.json');
      const value = JSON.parse(readFileSync(path, 'utf8'));
      value.publication = 'SYNTHETIC_SECRET';
      writeFileSync(path, JSON.stringify(value));
      expect(() => reviewRestoreEvidence(root)).toThrow('Restore readiness refused');
      expect(readFileSync(path, 'utf8')).toContain('SYNTHETIC_SECRET');
    }),
  30000,
);
it(
  'reports a missing proof source without treating historical execution as current validation',
  () =>
    owned((root) => {
      rmSync(join(root, 'tests/fixtures/restore-handoff/observe.ts'));
      const report = reviewRestoreEvidence(root);
      expect(report.fileReview.issues).toContainEqual({
        path: 'tests/fixtures/restore-handoff/observe.ts',
        code: 'unreadable',
      });
      expect(report.recordedHandoff).toBeNull();
      expect(report.fixtureExecutions).toBe(0);
    }),
  30000,
);

it(
  'detects unreviewed lockfile drift after the exact product-source overlay without changing bytes',
  () =>
    owned((root) => {
      const path = join(root, 'pnpm-lock.yaml');
      writeFileSync(path, readFileSync(path, 'utf8') + '# unexpected current change\n');
      const before = readFileSync(path),
        report = reviewRestoreEvidence(root);
      expect(report.newExceptions).toBe(5);
      expect(report.fileReview.issues).toContainEqual({
        path: 'pnpm-lock.yaml',
        code: 'digest-mismatch',
      });
      expect(report.accepted).toBe(false);
      expect(report.recordedHandoff).toBeNull();
      expect(readFileSync(path)).toEqual(before);
    }),
  30000,
);
it(
  'refuses tampering with the exact current-source exception manifest',
  () =>
    owned((root) => {
      const path = join(root, prefix + 'p1-pr-037-current-source-exceptions.json');
      const value = JSON.parse(readFileSync(path, 'utf8'));
      value.exceptions[0].currentSha256 = 'f'.repeat(64);
      writeFileSync(path, JSON.stringify(value));
      expect(() => reviewRestoreEvidence(root)).toThrow('Restore readiness refused');
    }),
  30000,
);
