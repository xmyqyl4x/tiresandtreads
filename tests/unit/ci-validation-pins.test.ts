import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
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
import {
  reconcileProductPins,
  ciValidationPins,
} from '../../scripts/review/product-source-pins.mjs';
import { reviewRestoreEvidence } from '../../scripts/review/restore-evidence.mjs';
const path = '.github/workflows/ci.yml',
  manifest = JSON.parse(
    readFileSync('docs/implementation/evidence/P2/p2-pr-026-ci-transition.json', 'utf8'),
  ) as {
    exactPins: { path: string; baselineSha256: string; currentSha256: string }[];
  },
  pin = manifest.exactPins[0]!,
  sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
it('reconciles only the exact current CI budget while preserving historical bytes and held readiness', () => {
  const history = 'docs/implementation/evidence/P1/p1-pr-027-restore-handoff-sources.json',
    before = readFileSync(history),
    current = readFileSync(path, 'utf8'),
    unrelated = { path: 'tests/fixtures/restore-handoff/observe.ts', sha256: 'a'.repeat(64) },
    input = [{ path, sha256: pin.baselineSha256 }, unrelated],
    original = JSON.stringify(input);
  expect(manifest.exactPins).toHaveLength(1);
  expect(manifest.exactPins).toEqual(ciValidationPins);
  expect(pin.path).toBe(path);
  expect(sha(current)).toBe(pin.currentSha256);
  expect(sha(current.replace('timeout-minutes: 40', 'timeout-minutes: 25'))).toBe(
    pin.baselineSha256,
  );
  expect(before.toString()).toContain(pin.baselineSha256);
  const reconciled = reconcileProductPins(process.cwd(), input);
  expect(reconciled.exceptions).toBe(1);
  expect(reconciled.pins).toEqual([{ path, sha256: pin.currentSha256 }, unrelated]);
  expect(JSON.stringify(input)).toBe(original);
  const report = reviewRestoreEvidence(process.cwd());
  expect(report.fileReview).toMatchObject({ matchedPins: 378, issues: [] });
  expect(report).toMatchObject({
    newExceptions: 5,
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
  expect(manifest).toMatchObject({
    verificationCommandChanged: false,
    historicalManifestsRewritten: false,
    actualAcceptance: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
  expect(readFileSync(history)).toEqual(before);
});
it('refuses an unreviewed CI baseline without admitting arbitrary current bytes', () => {
  expect(() => reconcileProductPins(process.cwd(), [{ path, sha256: 'f'.repeat(64) }])).toThrow();
});
it.each([
  ['another timeout', (s: string) => s.replace('timeout-minutes: 40', 'timeout-minutes: 41')],
  ['different command', (s: string) => s.replace('node scripts/verify/local.mjs', 'true')],
  ['additional bytes', (s: string) => s + '\n'],
] as const)(
  'refuses further CI drift (%s) without repairing bytes or reporting readiness',
  (_name, change) => {
    const parent = realpathSync(tmpdir()),
      root = mkdtempSync(join(parent, 'tt-ci-budget-pins-'));
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
      writeFileSync(target, change(readFileSync(target, 'utf8')));
      const before = readFileSync(target),
        adverse = reviewRestoreEvidence(root);
      expect(adverse.fileReview.issues).toEqual([{ path, code: 'digest-mismatch' }]);
      expect(adverse.recordedHandoff).toBeNull();
      expect(adverse.accepted).toBe(false);
      expect(adverse.runtimeAdmission).toBe(false);
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
