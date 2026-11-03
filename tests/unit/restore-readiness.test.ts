import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileEvidenceCatalog, manifestPaths } from '../../scripts/review/evidence-catalog.mjs';
import { compileRestoreCatalog } from '../../scripts/review/restore-catalog.mjs';
const prefix = 'docs/implementation/evidence/P1/';
function inputs() {
  const read = (name: string) => JSON.parse(readFileSync(prefix + name, 'utf8'));
  const old = manifestPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
  return {
    prior: compileEvidenceCatalog({
      baseline: read('p1-pr-027-evidence-review-baseline.json'),
      populated: old[0],
      dependency: old[1],
      review: old[2],
      index: old[3],
    }),
    baseline: read('p1-pr-027-restore-readiness-baseline.json'),
    contract: read('p1-pr-027-restore-handoff-contract.json'),
    contractBaseline: read('p1-pr-027-restore-handoff-baseline.json'),
    proof: read('p1-pr-027-restore-handoff-local.json'),
    sources: read('p1-pr-027-restore-handoff-sources.json'),
  };
}
type Input = ReturnType<typeof inputs>;
it('extends the prior catalog without changing its source, history or exception provenance', () => {
  const input = inputs(),
    before = JSON.stringify(input),
    result = compileRestoreCatalog(input);
  expect(result.sources).toHaveLength(206);
  expect(result.historical).toHaveLength(163);
  expect(result.inputs).toHaveLength(4);
  expect(result.sp08).toHaveLength(23);
  expect(result.proofSources).toHaveLength(17);
  expect(result.recorded).toMatchObject({
    nativeProfiles: 16,
    artifactRefusals: 3,
    actualRestoreReplayProfiles: 13,
    repeatedExistingCustodyExecutions: 26,
    newUniqueCustodyTests: 0,
    focusedControls: 45,
    modeledOnly: ['RH17'],
  });
  expect(JSON.stringify(input)).toBe(before);
});
it('returns deterministic defensive inventories and distinguishes native and publication sources', () => {
  const input = inputs(),
    first = compileRestoreCatalog(input);
  expect(first.recorded.provenance.nativeSource).not.toBe(
    first.recorded.provenance.publicationSource,
  );
  first.sources.pop();
  expect(compileRestoreCatalog(input).sources).toHaveLength(206);
  expect(compileRestoreCatalog(input)).toEqual(compileRestoreCatalog(input));
});
const adverse: [string, (input: Input) => void][] = [
  [
    'dropped prior source',
    (x) => {
      x.contractBaseline.sourcePins.shift();
      x.sources.sourcePins = x.contractBaseline.sourcePins;
    },
  ],
  [
    'changed prior digest',
    (x) => {
      x.contractBaseline.sourcePins[0].sha256 = '0'.repeat(64);
      x.sources.sourcePins = x.contractBaseline.sourcePins;
    },
  ],
  [
    'duplicate proof source',
    (x) => {
      x.proof.sourcePins.push(x.proof.sourcePins[0]);
    },
  ],
  [
    'same-size proof path substitution',
    (x) => {
      x.proof.sourcePins[0].path = 'tests/unreviewed.ts';
    },
  ],
  [
    'lost historical pin',
    (x) => {
      x.sources.frozenHistoricalEvidence.pop();
    },
  ],
  [
    'changed current input',
    (x) => {
      x.sources.inputPins[0].sha256 = '0'.repeat(64);
    },
  ],
  [
    'missing SP08 pin',
    (x) => {
      x.sources.sp08Pins.pop();
    },
  ],
  [
    'contract anchor substitution',
    (x) => {
      x.sources.frozenReviewedContract[0].path = 'docs/unreviewed.md';
    },
  ],
  [
    'unreviewed exception',
    (x) => {
      x.proof.sourceExceptions.push({ path: 'unreviewed' });
    },
  ],
  [
    'history exception',
    (x) => {
      x.proof.historicalEvidenceExceptions.push({ path: 'unreviewed' });
    },
  ],
  [
    'actual acceptance record',
    (x) => {
      x.proof.actualAcceptanceRecords.push({ accepted: true });
    },
  ],
  [
    'lifted API hold across records',
    (x) => {
      for (const record of [x.contract, x.contractBaseline, x.proof, x.sources])
        record.holds.APIsFrontends = 'open';
    },
  ],
  [
    'authority claim',
    (x) => {
      x.proof.native.profiles[0].authenticated = true;
    },
  ],
  [
    'gate closure',
    (x) => {
      x.proof.native.gatesClosed = 1;
    },
  ],
  [
    'missing native profile',
    (x) => {
      x.proof.native.profiles.pop();
    },
  ],
  [
    'duplicate native profile',
    (x) => {
      x.proof.native.profiles[1] = x.proof.native.profiles[0];
    },
  ],
  [
    'modeled RH17 represented as native',
    (x) => {
      x.proof.native.profiles.push({ profile: 'end-unobserved', native: true });
    },
  ],
  [
    'reordered cleanup',
    (x) => {
      x.proof.native.cleanup.reverse();
    },
  ],
  [
    'unconfirmed cleanup',
    (x) => {
      x.proof.native.cleanup[0].ownedProjectRemoved = false;
    },
  ],
  [
    'revised historical receipt',
    (x) => {
      x.proof.native.cleanup[0].earlierReceiptUnchanged = false;
    },
  ],
  [
    'tooling cleanup not checked',
    (x) => {
      x.proof.native.checkedToolingTagRemoval = false;
    },
  ],
  [
    'restore on artifact refusal',
    (x) => {
      x.proof.native.profiles[1].restoreExecuted = true;
    },
  ],
  [
    'missing privacy replay',
    (x) => {
      x.proof.native.profiles[0].privacyReplayExecuted = false;
    },
  ],
  [
    'missing driver end',
    (x) => {
      x.proof.native.profiles[0].observation.nativeEndsObserved = 3;
    },
  ],
  [
    'missing ledger finding',
    (x) => {
      x.proof.native.profiles[9].observation.findings = [];
    },
  ],
  [
    'observer loss upgraded to success',
    (x) => {
      x.proof.native.profiles[14].observation.status = 'success';
    },
  ],
  [
    'pending-SQL cancellation claim',
    (x) => {
      x.proof.native.profiles[14].observation.noPendingSqlKillClaim = false;
    },
  ],
  [
    'mutation attributed to normal observer',
    (x) => {
      x.proof.native.profiles[0].observation.observerMutationStatements = 1;
    },
  ],
  [
    'reused tests labeled unique',
    (x) => {
      x.proof.native.newUniqueCustodyTests = 26;
    },
  ],
  [
    'changed summary count',
    (x) => {
      x.proof.native.actualRestoreReplayProfiles = 12;
    },
  ],
  [
    'unobserved parent write probe',
    (x) => {
      x.proof.native.positiveParentAssertions.rejectedPermanentTableStatements25006 = 3;
    },
  ],
  [
    'native/publication chronology conflation',
    (x) => {
      x.baseline.provenance.nativeSource = x.baseline.provenance.publicationSource;
      x.proof.nativeExecutionSource = x.baseline.provenance.nativeSource;
    },
  ],
  [
    'changed contract lineage',
    (x) => {
      x.proof.acceptedContractMerge = '0'.repeat(40);
    },
  ],
  [
    'weakened claim boundary',
    (x) => {
      x.proof.claimsNotMade.pop();
    },
  ],
  [
    'RH17 native contract row',
    (x) => {
      x.contract.cases[16].evidenceKind = 'native execution';
    },
  ],
];
for (const [name, change] of adverse)
  it('refuses ' + name, () => {
    const input = inputs();
    change(input);
    expect(() => compileRestoreCatalog(input)).toThrow('Restore readiness refused');
  });
