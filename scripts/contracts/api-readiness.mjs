import { localApiDocument } from './local-api.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
// Explicit coverage classification: adding a binding requires an intentional service/UC decision.
const classification = {
  createOwnerSession: {
    category: 'ownerSessions',
    service: 'identity.session',
    useCases: ['UC01'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  getOwnerSession: {
    category: 'ownerSessions',
    service: 'identity.session',
    useCases: ['UC01'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  createReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  readReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  readDraft: {
    category: 'reports',
    service: 'reports.readDraft',
    useCases: ['UC03'],
    databaseProof: 'tests/database/web-results.test.ts',
  },
  saveDraft: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  refineReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  compareReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  saveQuote: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  readQuotes: {
    category: 'reports',
    service: 'reports.readQuotes',
    useCases: ['UC04'],
    databaseProof: 'tests/database/web-comparison.test.ts',
  },
  readQuote: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  readComparison: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  shareReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  revokeShare: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  readSharedReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  forkReport: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  ownerPdf: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  sharedPdf: {
    category: 'reports',
    service: 'reports',
    useCases: ['UC01', 'UC03', 'UC04', 'UC05'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  downloadPdf: {
    category: 'privateAssets',
    service: 'assets.download',
    useCases: ['UC05', 'UC06'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  lookupReference: {
    category: 'references',
    service: 'reference.query',
    useCases: ['UC01', 'UC02'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  getContent: {
    category: 'education',
    service: 'content.readPage',
    useCases: ['UC13'],
    databaseProof: 'tests/database/http-composed-host.test.ts',
  },
  toolsize: {
    category: 'publicTools',
    service: 'publicPolicy',
    useCases: ['UC02', 'UC13'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  toolchecklist: {
    category: 'publicTools',
    service: 'publicPolicy',
    useCases: ['UC02', 'UC13'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  toolscorecard: {
    category: 'publicTools',
    service: 'publicPolicy',
    useCases: ['UC02', 'UC13'],
    databaseProof: 'tests/database/http-public-owner.test.ts',
  },
  getConsentPolicy: {
    category: 'consent',
    service: 'contacts',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  requestContact: {
    category: 'consent',
    service: 'contacts',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  getBrowserConsent: {
    category: 'consent',
    service: 'contacts',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  setBrowserConsent: {
    category: 'consent',
    service: 'contacts',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  requestDelivery: {
    category: 'delivery',
    service: 'delivery',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  getDelivery: {
    category: 'delivery',
    service: 'delivery',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  cancelDelivery: {
    category: 'delivery',
    service: 'delivery',
    useCases: ['UC06', 'UC08'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  requestOwnerRights: {
    category: 'privacy',
    service: 'privacy',
    useCases: ['UC10'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  requestEmailRights: {
    category: 'privacy',
    service: 'privacy',
    useCases: ['UC10'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  privacyStatus: {
    category: 'privacy',
    service: 'privacy',
    useCases: ['UC10'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  confirmPrivacyProof: {
    category: 'privacy',
    service: 'privacy',
    useCases: ['UC10'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  staffQueue: {
    category: 'staff',
    service: 'staff',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  recoverOperation: {
    category: 'staff',
    service: 'staff',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  prepareImport: {
    category: 'ingestion',
    service: 'imports',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  importStatus: {
    category: 'ingestion',
    service: 'imports',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  importDiff: {
    category: 'ingestion',
    service: 'imports',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  publishImport: {
    category: 'ingestion',
    service: 'imports',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  rollbackImport: {
    category: 'ingestion',
    service: 'imports',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  enqueueContent: {
    category: 'cmsSeo',
    service: 'content',
    useCases: ['UC13'],
    databaseProof: 'tests/database/http-composed-host.test.ts',
  },
  auditSeo: {
    category: 'cmsSeo',
    service: 'content',
    useCases: ['UC13'],
    databaseProof: 'tests/database/http-composed-host.test.ts',
  },
  seoMetrics: {
    category: 'cmsSeo',
    service: 'content',
    useCases: ['UC13'],
    databaseProof: 'tests/database/http-composed-host.test.ts',
  },
  operationsMetrics: {
    category: 'operations',
    service: 'operations.metrics',
    useCases: ['UC09'],
    databaseProof: 'tests/database/http-operations.test.ts',
  },
  adRevenue: {
    category: 'commercial',
    service: 'commercial',
    useCases: ['UC17'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  redirectAffiliate: {
    category: 'commercial',
    service: 'commercial',
    useCases: ['UC17'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  receiveMailCallback: {
    category: 'callbacks',
    service: 'mail.acceptVerified/workflows.dispatch',
    useCases: ['UC07'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  wakeDurableJob: {
    category: 'callbacks',
    service: 'mail.acceptVerified/workflows.dispatch',
    useCases: ['UC07'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  issueAnalyticsGrant: {
    category: 'analytics',
    service: 'analytics',
    useCases: ['UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  collectEvents: {
    category: 'analytics',
    service: 'analytics',
    useCases: ['UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  getEmailPreferences: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  confirmEmail: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  withdrawEmail: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  getEmailConfirmation: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  readEmailConfirmation: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  confirmEmailLink: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  readEmailUnsubscribe: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  oneClickUnsubscribe: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  oneClickUnsubscribeApi: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  readPreferences: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  updatePreferences: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  visitEmailLink: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  recordEmailFeedback: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
  recordEmailLinkFeedback: {
    category: 'emailActions',
    service: 'actions/contacts/confirmationQuery',
    useCases: ['UC07', 'UC08'],
    databaseProof: 'tests/database/http-callbacks.test.ts',
  },
};
export function localApiReadiness() {
  const document = localApiDocument();
  const inventory = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => {
      const mapped = classification[op.operationId];
      if (!mapped) throw Error('Unclassified local operation');
      return {
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        actor: op['x-access'],
        ...mapped,
        requestSchema: op.requestBody
          ? 'OpenAPI requestBody'
          : 'OpenAPI path/query/header parameters',
        responseSchema:
          'OpenAPI responses; shared ApiReply or declared empty/redirect/binary response',
        idempotencyRequired: op.parameters.some(
          (p) => p.in === 'header' && p.name === 'Idempotency-Key',
        ),
        maxBodyBytes: op['x-max-body-bytes'],
        successStatuses: Object.keys(op.responses).filter((code) => Number(code) < 400),
      };
    }),
  );
  if (inventory.length !== Object.keys(classification).length)
    throw Error('Stale local operation classification');
  return {
    schemaVersion: 1,
    scope: 'local-development-only',
    status: 'local-contracts-available',
    S3Accepted: false,
    S4Accepted: false,
    G0Accepted: false,
    publicActivation: false,
    hostedProvisioning: false,
    purchases: false,
    actualNotifications: false,
    clients: [
      'packages/contracts/src/http.ts',
      'packages/contracts/src/report-client.ts',
      'packages/contracts/src/operation-client.ts',
      'packages/contracts/src/event-client.ts',
      'packages/contracts/src/assessment-client.ts',
      'packages/contracts/src/results-client.ts',
      'packages/contracts/src/comparison-client.ts',
      'packages/contracts/src/browser-consent-client.ts',
      'packages/contracts/src/transport.ts',
    ],
    fullJourneyProof: 'tests/database/http-complete-journey.test.ts',
    actualHostProof: 'tests/database/http-composed-host.test.ts',
    admissionProof: 'tests/usecases/http-admission.test.ts',
    remainingAcceptance: [
      'G1-specialist',
      'G1-fitment-catalog',
      'G1-prices',
      'G2-provider-effects',
      'G2-privacy-policy',
      'S3-service-host',
      'G0',
      'S4-live-acceptance',
    ],
    inventory,
  };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/contracts/api-readiness.mjs')) {
  const target = 'docs/api/local-v1.inventory.json',
    serialized = JSON.stringify(localApiReadiness(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== serialized) throw Error('Local inventory differs');
  } else writeFileSync(target, serialized);
}
