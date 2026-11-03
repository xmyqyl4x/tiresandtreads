import { combinePins, manifestPaths, mergeReviewedPins, pinList } from './evidence-catalog.mjs';

const prefix = 'docs/implementation/evidence/P1/';
export const restoreManifestPaths = Object.freeze([
  ...manifestPaths,
  prefix + 'p1-pr-027-evidence-review-baseline.json',
  ...['contract', 'baseline', 'local', 'sources'].map(
    (s) => prefix + 'p1-pr-027-restore-handoff-' + s + '.json',
  ),
]);
export const proofDocumentPaths = Object.freeze([
  'docs/implementation/P1-PR-027-restore-handoff-proof.md',
  prefix + 'p1-pr-027-restore-handoff-proof-validation.md',
]);
const contractPaths = [
  'docs/implementation/P1-PR-027-restore-handoff-contract.md',
  ...['contract.json', 'baseline.json', 'contract-validation.md'].map(
    (s) => prefix + 'p1-pr-027-restore-handoff-' + s,
  ),
];
const supportPaths = [
  '.github/workflows/restore-handoff.yml',
  ...[
    'admit.ts',
    'audit.ts',
    'common.ts',
    'compose.yaml',
    'contract.ts',
    'fault.ts',
    'files.ts',
    'observe.ts',
    'prepare.ts',
    'run.mjs',
    'samples.ts',
    'seal.ts',
    'write-denial.ts',
  ].map((s) => 'tests/fixtures/restore-handoff/' + s),
  'tests/unit/restore-handoff-files.test.ts',
  'tests/unit/restore-handoff.test.ts',
  'tests/usecases/restore-handoff-cli.test.ts',
].sort();
const profiles = [
  'positive',
  'bundle-corrupt',
  'bundle-project',
  'bundle-manifest',
  'checkpoint-missing',
  'checkpoint-stale',
  'checkpoint-changed',
  'image-binding',
  'config-binding',
  'app-history',
  'cms-history',
  'target-row',
  'source-row',
  'quarantine',
  'observer-loss',
  'inspection-loss',
];
const held = {
  'HS01-HS08': 'proposed',
  operatorsCoverageRates: 'unconfirmed',
  S3Gates: 'six pending; actual records empty',
  specialistLicensed: 'pending',
  APIsFrontends: 'held',
  hostedProvisioning: false,
  purchases: false,
  actualRecipientNotifications: false,
  productionPolicyChanged: false,
  casesClosed: 0,
  gatesClosed: 0,
};
function must(value) {
  if (!value) throw Error('Restore readiness refused');
}
function same(a, b) {
  must(JSON.stringify(a) === JSON.stringify(b));
}
function sorted(raw) {
  return pinList(raw).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
function samePins(a, b) {
  same(sorted(a), sorted(b));
}
function empty(value) {
  must(Array.isArray(value) && value.length === 0);
}
function flags(row) {
  for (const key of [
    'actualAcceptance',
    'runtimeAdmission',
    'hostedAccepted',
    'productActivation',
    'independentDurability',
    'authenticated',
    'targetFencing',
  ])
    must(row[key] === false);
  for (const key of [
    'providerDispatches',
    'actualRecipientNotifications',
    'casesClosed',
    'gatesClosed',
  ])
    must(row[key] === 0);
}
function heldRecord(row) {
  must(row && Object.keys(row).length === Object.keys(held).length);
  for (const [key, value] of Object.entries(held)) must(row[key] === value);
}
function recordedProof(contract, proof, provenance) {
  must(
    contract.scope === 'local-restore-readonly-handoff-contract' &&
      contract.productionExecutor === false,
  );
  must(
    proof.scope === 'disposable-restore-readonly-handoff-proof' &&
      proof.nativeSourceWasClean === true,
  );
  same(
    contract.cases.map((c) => c.id),
    Array.from({ length: 17 }, (_, i) => 'RH' + String(i + 1).padStart(2, '0')),
  );
  same(
    contract.cases.map((c) => c.profile),
    [...profiles, 'end-unobserved'],
  );
  must(contract.cases.every((c) => c.acceptance === 'open; no original case/gate closure'));
  must(contract.cases[16].evidenceKind === 'pure receipt-state control only');
  must(contract.limits.nativeProfiles === 16 && contract.limits.pureReceiptRows === 1);
  must(Array.isArray(contract.claimsNotMade) && contract.claimsNotMade.length === 11);
  same(contract.claimsNotMade, proof.claimsNotMade);
  const n = proof.native;
  must(
    n.nativeProfiles === 16 &&
      n.artifactRefusals === 3 &&
      n.actualRestoreReplayProfiles === 13 &&
      n.repeatedExistingCustodyExecutions === 26 &&
      n.newUniqueCustodyTests === 0,
  );
  must(
    n.allOwnedProjectsRemoved === true &&
      n.checkedToolingTagRemoval === true &&
      n.casesClosed === 0 &&
      n.gatesClosed === 0,
  );
  same(
    n.profiles.map((p) => p.profile),
    profiles,
  );
  same(
    n.cleanup.map((p) => p.profile),
    profiles,
  );
  must(
    n.cleanup.every((c) => c.ownedProjectRemoved === true && c.earlierReceiptUnchanged === true),
  );
  for (const p of n.profiles) {
    must(p.native === true);
    flags(p);
    if (p.profile.startsWith('bundle-')) {
      must(
        p.stage === 'artifact-admission' &&
          p.status === 'refused' &&
          p.restoreExecuted === false &&
          p.privacyReplayExecuted === false &&
          p.targetEmpty === true &&
          p.targetProductConnectClosed === true,
      );
      continue;
    }
    must(
      p.stage === 'post-replay-readonly' &&
        p.restoreExecuted === true &&
        p.privacyReplayExecuted === true &&
        p.maintenanceClosed === true &&
        p.postFaultFourEndpointParity === true,
    );
    const o = p.observation;
    if (p.profile === 'observer-loss') {
      must(
        o.status === 'unavailable' &&
          o.code === 'observer-loss' &&
          o.complete === false &&
          o.freshAttemptBlocked === true &&
          o.firstDriverEndObserved === true &&
          o.wholeBatchComplete === false &&
          o.actualOwnedProcessLoss === true &&
          o.noPendingSqlKillClaim === true,
      );
      continue;
    }
    flags(o);
    must(o.observerMutationStatements === 0);
    const finding = {
      'app-history': '1/app:history',
      'cms-history': '1/cms:history',
      'target-row': '1/app:rows',
      'source-row': '0/app:rows',
      quarantine: '1/app:quarantined',
    }[p.profile];
    if (p.profile === 'positive' || finding) {
      must(
        o.attemptedEndpoints === 4 &&
          o.completedEndpointObservations === 4 &&
          o.verifiedTlsEndpoints === 4 &&
          o.readOnlyTransactions === 4 &&
          o.nativeEndsObserved === 4 &&
          o.cleanupUnknown === false,
      );
      if (finding)
        must(
          o.status === 'refused' &&
            o.code === 'catalog-drift' &&
            o.complete === false &&
            o.freshAttemptBlocked === true &&
            o.findings.includes(finding),
        );
      else
        must(
          o.status === 'success' &&
            o.code === 'compatible' &&
            o.complete === true &&
            o.freshAttemptBlocked === false &&
            o.findings.length === 0,
        );
    } else {
      const code = {
        'checkpoint-missing': 'checkpoint-missing',
        'checkpoint-stale': 'checkpoint-stale',
        'checkpoint-changed': 'checkpoint-changed',
        'image-binding': 'image',
        'config-binding': 'config',
        'inspection-loss': 'checkpoint-unavailable',
      }[p.profile];
      must(
        o.code === code &&
          o.status === (p.profile === 'inspection-loss' ? 'unavailable' : 'refused'),
      );
      must(
        o.complete === false &&
          o.freshAttemptBlocked === true &&
          o.cleanupUnknown === false &&
          o.attemptedEndpoints === 0 &&
          o.completedEndpointObservations === 0 &&
          o.verifiedTlsEndpoints === 0 &&
          o.readOnlyTransactions === 0 &&
          o.nativeEndsObserved === 0 &&
          o.findings.length === 0,
      );
    }
  }
  const f = proof.focused,
    parent = n.positiveParentAssertions;
  must(
    f.focusedExecutions === 45 &&
      f.unitControls === 42 &&
      f.functionalUseCases === 3 &&
      f.actualFileDigestGuardMutantKilled === true &&
      f.nativeRestoreProfilesExecutedAtThisStep === 0 &&
      f.originalCasesClosed === 0 &&
      f.S3GatesClosed === 0,
  );
  must(
    parent.repeatedIdenticalFourEndpointRead === true &&
      parent.rejectedPermanentTableStatements25006 === 4 &&
      parent.sourcePasswordsRejectedOnTargetPerReplayProfile === 2 &&
      parent.maintenanceClosedEndpointsPerReplayProfile === 4,
  );
  must(
    n.pureRH17 === 'separately modeled in focused/root unit suite; not a native end-hang execution',
  );
  must(
    proof.evidenceKinds.RH17 ===
      'pure receipt-state control in unit suite; no new native end-hang claim',
  );
  return {
    nativeProfiles: 16,
    artifactRefusals: 3,
    actualRestoreReplayProfiles: 13,
    repeatedExistingCustodyExecutions: 26,
    newUniqueCustodyTests: 0,
    focusedControls: 45,
    modeledOnly: ['RH17'],
    normalObserverMutationStatements: 0,
    separateRejectedWriteProbes: 4,
    parentAssertionCountsAreDerived: true,
    historicalExecutionOnly: true,
    provenance: { ...provenance },
  };
}
export function compileRestoreCatalog(raw) {
  try {
    const { prior, baseline, contract, contractBaseline, proof, sources } = raw;
    must(
      [baseline, contract, contractBaseline, proof, sources].every((r) => r.schemaVersion === 1),
    );
    must(baseline.scope === 'local-restore-readiness-baseline');
    empty(baseline.sourceExceptions);
    empty(baseline.evidenceExceptions);
    same(
      pinList(baseline.manifestPins).map((p) => p.path),
      restoreManifestPaths,
    );
    same(
      pinList(baseline.supplementalPins).map((p) => p.path),
      proofDocumentPaths,
    );
    for (const r of [contract, contractBaseline, proof, sources]) heldRecord(r.holds);
    empty(contract.actualAcceptanceRecords);
    empty(proof.actualAcceptanceRecords);
    empty(proof.sourceExceptions);
    empty(proof.historicalEvidenceExceptions);
    empty(sources.sourceExceptions);
    empty(contractBaseline.sourceExceptions);
    empty(contractBaseline.evidenceExceptions);
    const provenance = baseline.provenance;
    same(
      Object.keys(provenance).sort(),
      [
        'contractSource',
        'contractMerge',
        'nativeSource',
        'nativeTree',
        'publicationSource',
        'publicationTree',
        'proofMerge',
      ].sort(),
    );
    must(Object.values(provenance).every((s) => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)));
    must(
      provenance.nativeSource !== provenance.publicationSource &&
        provenance.nativeTree !== provenance.publicationTree,
    );
    must(
      baseline.baselineCommit === provenance.proofMerge &&
        proof.acceptedContractMerge === provenance.contractMerge &&
        sources.baselineCommit === provenance.contractMerge &&
        proof.reviewedContractSource === provenance.contractSource &&
        proof.nativeExecutionSource === provenance.nativeSource &&
        proof.nativeExecutionTree === provenance.nativeTree,
    );
    must(contract.baselineCommit === contractBaseline.baselineCommit);
    samePins(contractBaseline.sourcePins, sources.sourcePins);
    samePins(contractBaseline.frozenHistoricalEvidence, sources.frozenHistoricalEvidence);
    samePins(contractBaseline.inputPins, sources.inputPins);
    samePins(contractBaseline.sp08Pins, sources.sp08Pins);
    const previousSources = mergeReviewedPins(prior.sources, sources.sourcePins, []);
    const historical = mergeReviewedPins(prior.historical, sources.frozenHistoricalEvidence, []);
    samePins(prior.inputs, sources.inputPins);
    samePins(prior.sp08, sources.sp08Pins);
    must(
      previousSources.length === 189 &&
        historical.length === 163 &&
        sources.inputPins.length === 4 &&
        sources.sp08Pins.length === 23,
    );
    const proofSources = sorted(proof.sourcePins);
    same(
      proofSources.map((p) => p.path),
      supportPaths,
    );
    same(
      sorted(sources.frozenReviewedContract).map((p) => p.path),
      contractPaths.slice().sort(),
    );
    const compiledSources = combinePins([previousSources, proofSources]);
    must(compiledSources.length === 206);
    const contractSource = proofSources.find(
      (p) => p.path === 'tests/fixtures/restore-handoff/contract.ts',
    );
    must(contractSource.sha256 === proof.focused.restoredContractSha256);
    const recorded = recordedProof(contract, proof, provenance);
    const all = combinePins([
      compiledSources,
      historical,
      sources.inputPins,
      sources.sp08Pins,
      sources.frozenReviewedContract,
      baseline.manifestPins,
      baseline.supplementalPins,
      prior.all,
    ]);
    return {
      sources: compiledSources,
      historical,
      inputs: sorted(sources.inputPins),
      sp08: sorted(sources.sp08Pins),
      proofSources,
      all,
      recorded,
    };
  } catch {
    throw Error('Restore readiness refused');
  }
}
