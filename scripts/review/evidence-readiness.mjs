import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { readReviewBytes, readReviewJson } from './repository-files.mjs';
import { buildAcceptanceInputReview } from './input-contract.mjs';
import { compileEvidenceCatalog, manifestPaths, pinList } from './evidence-catalog.mjs';
import { verifyReviewFiles } from './evidence-files.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--require-inputs'))
    throw Error('Unsupported request');
  const root = fileURLToPath(new URL('../../', import.meta.url)),
    prefix = 'docs/implementation/evidence/P1/';
  const read = (name) => readReviewJson(root, prefix + name);
  const baseline = read('p1-pr-027-evidence-review-baseline.json');
  const anchors = pinList(baseline.manifestPins);
  if (JSON.stringify(anchors.map((entry) => entry.path)) !== JSON.stringify(manifestPaths))
    throw Error('Unknown manifests');
  const manifests = [];
  for (const entry of anchors) {
    const bytes = readReviewBytes(root, entry.path);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw Error('Changed manifest');
    manifests.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  const catalog = compileEvidenceCatalog({
    baseline,
    populated: manifests[0],
    dependency: manifests[1],
    review: manifests[2],
    index: manifests[3],
  });
  const register = read('s3-service-register.json');
  const references = register.gates.flatMap((gate) => gate.localEvidence ?? []);
  const fileReview = verifyReviewFiles(root, catalog.all, references);
  const report = {
    schemaVersion: 1,
    scope: 'local-historical-evidence-review',
    currentCheck: 'repository-bytes-and-held-inputs',
    status: fileReview.issues.length ? 'drifted' : 'consistent-local-evidence',
    pinScope: {
      sources: catalog.sources.length,
      historical: catalog.historical.length,
      inputs: catalog.inputs.length,
      sp08: catalog.sp08.length,
      localReferences: references.length,
    },
    priorExceptions: catalog.priorExceptions,
    localToolExceptions: catalog.localToolExceptions,
    fileReview,
    acceptanceInputReview: null,
    historicalUnknownAdmissionReceipts: null,
    historicalExecutionOnly: true,
    fixtureExecutions: 0,
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
      decisions: read('p1-pr-027-staging-decision.json'),
      operations: read('p1-pr-027-staging-operations-budget.json'),
      specialist: read('p1-pr-017-golden-review.json'),
    });
    const history = read('p1-pr-027-io-inspection-local.json');
    const unknown = history.admissionReceipts.filter((entry) => entry.cleanupUnknown === true);
    if (
      unknown.length !== 2 ||
      history.counts.intentionallyUnknownCleanupReceipts !== 2 ||
      unknown.some((entry) => entry.freshAttemptBlocked !== true) ||
      JSON.stringify(unknown.map((entry) => entry.scenario)) !==
        JSON.stringify(['end-hang', 'inspection-loss'])
    )
      throw Error('Unknown historical state');
    report.historicalUnknownAdmissionReceipts = unknown.length;
  }
  console.log(JSON.stringify(report));
  if (fileReview.issues.length) process.exitCode = 1;
  else if (args.length) process.exitCode = 2;
} catch {
  console.error('Evidence readiness review refused; inspect repository state locally.');
  process.exitCode = 1;
}
