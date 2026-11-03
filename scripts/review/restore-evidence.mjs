import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { readReviewBytes, readReviewJson } from './repository-files.mjs';
import { compileEvidenceCatalog, pinList, reviewPath } from './evidence-catalog.mjs';
import { compileRestoreCatalog, restoreManifestPaths } from './restore-catalog.mjs';
import { verifyReviewFiles } from './evidence-files.mjs';
import { buildAcceptanceInputReview } from './input-contract.mjs';
const prefix = 'docs/implementation/evidence/P1/';
const baselinePath = prefix + 'p1-pr-027-restore-readiness-baseline.json';
export function reviewRestoreEvidence(root) {
  try {
    const baseline = readReviewJson(root, baselinePath),
      anchors = pinList(baseline.manifestPins);
    if (JSON.stringify(anchors.map((p) => p.path)) !== JSON.stringify(restoreManifestPaths))
      throw Error('Unknown manifests');
    const manifests = anchors.map((pin) => {
      const bytes = readReviewBytes(root, pin.path);
      if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
        throw Error('Changed restore manifest');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    });
    const prior = compileEvidenceCatalog({
      populated: manifests[0],
      dependency: manifests[1],
      review: manifests[2],
      index: manifests[3],
      baseline: manifests[4],
    });
    const catalog = compileRestoreCatalog({
      prior,
      baseline,
      contract: manifests[5],
      contractBaseline: manifests[6],
      proof: manifests[7],
      sources: manifests[8],
    });
    const register = readReviewJson(root, prefix + 's3-service-register.json');
    const references = register.gates.flatMap((g) => g.localEvidence ?? []);
    if (references.length !== 264) throw Error('Changed local references');
    const fileReview = verifyReviewFiles(root, catalog.all, [...references, baselinePath]);
    const reviewedPaths = [
      ...new Set([...catalog.all.map((p) => p.path), ...references.map(reviewPath), baselinePath]),
    ].sort();
    const report = {
      schemaVersion: 1,
      scope: 'local-restore-evidence-readiness',
      currentCheck: 'repository-bytes-and-held-inputs',
      status: fileReview.issues.length ? 'drifted' : 'consistent-restore-evidence',
      pinScope: {
        sources: catalog.sources.length,
        historical: catalog.historical.length,
        inputs: catalog.inputs.length,
        sp08: catalog.sp08.length,
        proofSources: catalog.proofSources.length,
        localReferences: references.length,
      },
      priorExceptions: prior.priorExceptions,
      localToolExceptions: prior.localToolExceptions,
      newExceptions: 0,
      fileReview,
      reviewedPaths,
      recordedHandoff: null,
      acceptanceInputReview: null,
      historicalUnknownAdmissionReceipts: null,
      historicalExecutionOnly: true,
      fixtureExecutions: 0,
      gitHistoryVerifiedNow: false,
      ciReexecutedNow: false,
      accepted: false,
      endpointImplementationAllowed: false,
      publicActivation: false,
      runtimeAdmission: false,
      independentDurability: false,
      authenticated: false,
      targetFencing: false,
      hostedAccepted: false,
      providerDispatches: 0,
      actualRecipientNotifications: 0,
      casesClosed: 0,
      gatesClosed: 0,
    };
    if (!fileReview.issues.length) {
      report.acceptanceInputReview = buildAcceptanceInputReview({
        register,
        decisions: readReviewJson(root, prefix + 'p1-pr-027-staging-decision.json'),
        operations: readReviewJson(root, prefix + 'p1-pr-027-staging-operations-budget.json'),
        specialist: readReviewJson(root, prefix + 'p1-pr-017-golden-review.json'),
      });
      const history = readReviewJson(root, prefix + 'p1-pr-027-io-inspection-local.json');
      const unknown = history.admissionReceipts.filter((p) => p.cleanupUnknown === true);
      if (
        history.counts.intentionallyUnknownCleanupReceipts !== 2 ||
        unknown.length !== 2 ||
        unknown.some((p) => p.freshAttemptBlocked !== true) ||
        JSON.stringify(unknown.map((p) => p.scenario)) !==
          JSON.stringify(['end-hang', 'inspection-loss'])
      )
        throw Error('Changed uncertainty');
      report.historicalUnknownAdmissionReceipts = 2;
      report.recordedHandoff = catalog.recorded;
    }
    return report;
  } catch {
    throw Error('Restore readiness refused');
  }
}
