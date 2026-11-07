import {
  id,
  instant,
  revision,
  ok,
  fail,
  maxInt64,
  type Id,
  type Result,
} from '../../../domain/src/values/core.ts';
import {
  analysisSchema,
  analysisValidator,
  buildAnalysisPacket,
  validateAnalysisSelection,
  renderAnalysisSelection,
} from '../../../domain/src/analysis-policy.ts';
import type {
  AIScopeRepository,
  AIRequestRepository,
  AIArtifactRepository,
  AIReuseRepository,
  AIBudgetRepository,
  AIAttachmentRepository,
} from '../ports/analysis-repositories.ts';
import type {
  ReportAnalysisRepository,
  AnalysisProvider,
  AnalysisProviderResult,
  AnalysisAdmission,
  AnalysisStatus,
  AnalysisWork,
} from '../ports/report-analysis.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { ReportCrypto } from '../ports/report-services.ts';
import type { JobRepository } from '../ports/jobs.ts';
import { canonical, exact, json } from '../services/service-records.ts';
import { demand, serviceFailure, serviceWork } from '../services/service-work.ts';

export function createReportAnalysisServices(d: {
  uow: UnitOfWork;
  repository: ReportAnalysisRepository;
  scopes: AIScopeRepository;
  requests: AIRequestRepository;
  artifacts: AIArtifactRepository;
  reuse: AIReuseRepository;
  budgets: AIBudgetRepository;
  attachments: AIAttachmentRepository;
  admission: AnalysisAdmission;
  provider: AnalysisProvider;
  jobs: JobRepository;
  crypto: Pick<ReportCrypto, 'id' | 'hash'>;
  now: () => string;
  noticeVersion: string;
}) {
  const run = <T>(work: (tx: Tx) => Promise<Result<T, ApplicationFailure>>) =>
    serviceWork(d.uow, work);
  const safely = async <T>(
    work: () => Promise<Result<T, ApplicationFailure>>,
  ): Promise<Result<T, ApplicationFailure>> => {
    try {
      return await work();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  };
  function uuid<K extends string>(kind: K, value: unknown) {
    const r = id(kind, value);
    demand(r.ok);
    return r.value;
  }
  function clock() {
    const r = instant(d.now());
    demand(r.ok, 'internal');
    return r.value;
  }
  function capturedKeys(keys: readonly KeyDigest[]) {
    demand(Array.isArray(keys) && keys.length >= 1 && keys.length <= 4);
    const result = keys.map((k) => {
      demand(
        k &&
          typeof k.keyVersion === 'string' &&
          /^[A-Za-z0-9_-]{1,100}$/.test(k.keyVersion) &&
          /^[a-f0-9]{64}$/.test(k.digest),
      );
      return Object.freeze({ keyVersion: k.keyVersion, digest: k.digest });
    });
    demand(new Set(result.map((k) => k.keyVersion)).size === result.length);
    return Object.freeze(result);
  }
  async function owner(tx: Tx, keys: readonly KeyDigest[]) {
    const who = await d.repository.owner(tx, keys);
    demand(who, 'forbidden');
    return who;
  }
  function view(
    reportId: Id<'report'>,
    version: number,
    state: AnalysisStatus['state'],
    requestId: Id<'ai_request'> | null = null,
    output: AnalysisStatus['output'] = null,
  ): AnalysisStatus {
    return Object.freeze({ id: requestId, state, reportId, version, output });
  }
  async function currentWork(tx: Tx, work: AnalysisWork) {
    if (!(await d.repository.current(tx, work))) return false;
    const evidence = await d.repository.evidence(tx, work.ownerId, work.reportId, work.version);
    if (!evidence) return false;
    const rebuilt = buildAnalysisPacket(evidence, clock());
    return rebuilt.ok && canonical(rebuilt.value) === canonical(work.packet);
  }
  return Object.freeze({
    request(keys: readonly KeyDigest[], raw: unknown) {
      return safely(async () => {
        const x = exact(raw, 'allowed,key,noticeVersion,policyId,reportId,version'),
          reportId = uuid('report', x.reportId),
          policyId = uuid('ai_policy', x.policyId),
          version = Number(x.version),
          authorization = capturedKeys(keys);
        demand(
          typeof x.version === 'number' &&
            Number.isSafeInteger(version) &&
            version >= 1 &&
            version <= 2147483647,
        );
        demand(
          typeof x.allowed === 'boolean' &&
            x.noticeVersion === d.noticeVersion &&
            typeof x.key === 'string' &&
            /^[A-Za-z0-9_-]{16,128}$/.test(x.key),
        );
        const allowed = x.allowed,
          key = x.key,
          notice = String(x.noticeVersion),
          at = clock();
        return run(async (tx) => {
          const who = await owner(tx, authorization),
            evidence = await d.repository.evidence(tx, who.subjectId, reportId, version);
          demand(evidence, 'not_found');
          if (!allowed) return ok(view(reportId, version, 'not_requested'));
          const configuration = await d.repository.configuration(tx, policyId),
            policy = await d.scopes.policy(tx, policyId);
          if (
            !configuration ||
            !policy ||
            policy.status !== 'active' ||
            policy.task !== 'report_analysis' ||
            configuration.schema !== analysisSchema ||
            configuration.validator !== analysisValidator
          )
            return ok(view(reportId, version, 'unavailable'));
          const built = buildAnalysisPacket(evidence, at);
          if (!built.ok || built.value.sources.length === 0)
            return ok(view(reportId, version, 'unavailable'));
          const packet = built.value,
            scopeKey = d.crypto.hash('ai.owner-scope', who.subjectId + '\0' + policyId);
          let scope = await d.repository.scope(tx, who.subjectId, policyId, scopeKey);
          if (!scope)
            scope = await d.scopes.create(tx, {
              id: d.crypto.id('ai_scope', scopeKey),
              ownerId: who.subjectId,
              policyId,
              key: scopeKey,
              subjectRevision: evidence.subjectRevision,
              noticeVersion: notice,
              evidenceHash: d.crypto.hash(
                'ai.processing-choice',
                canonical({ notice, key, policyId, owner: who.subjectId }),
              ),
            });
          demand(
            scope.ownerId === who.subjectId &&
              scope.kind === 'owner' &&
              scope.state === 'active' &&
              scope.processingAllowed &&
              scope.subjectRevision === evidence.subjectRevision &&
              scope.noticeVersion === notice,
            'forbidden',
          );
          const request = await d.requests.create(tx, {
            id: d.crypto.id('ai_request', scopeKey + '\0' + key),
            scopeId: scope.id,
            key,
            manifest: {
              parameters: { ...packet },
              bundle_id: packet.bundleId,
              authoritative_hash: packet.authoritativeHash,
              rule_version: packet.ruleVersion,
            },
            deadlineSeconds: 120,
          });
          const work = await d.repository.enqueue(tx, {
            requestId: request.id,
            reportId,
            version,
            ownerId: who.subjectId,
            packet,
            expectedAttachment: evidence.attachmentRevision,
          });
          if (request.state === 'accepted') {
            const output = (await currentWork(tx, work))
              ? await d.repository.output(tx, work)
              : null;
            return ok(
              view(reportId, version, output ? 'available' : 'expired', request.id, output),
            );
          }
          return ok(
            view(
              reportId,
              version,
              request.state === 'queued' || request.state === 'running' ? 'pending' : 'unavailable',
              request.id,
            ),
          );
        });
      });
    },
    choice(keys: readonly KeyDigest[], raw: unknown) {
      return safely(async () => {
        const x = exact(raw, 'allowed,expectedRevision,noticeVersion,scopeId'),
          scopeId = uuid('ai_scope', x.scopeId),
          expected = revision(x.expectedRevision),
          authorization = capturedKeys(keys);
        demand(
          expected.ok && typeof x.allowed === 'boolean' && x.noticeVersion === d.noticeVersion,
        );
        const allowed = x.allowed,
          notice = String(x.noticeVersion);
        return run(async (tx) => {
          const who = await owner(tx, authorization),
            scope = await d.scopes.scope(tx, scopeId);
          demand(scope && scope.kind === 'owner' && scope.ownerId === who.subjectId, 'forbidden');
          const subjectRevision = await d.repository.subjectRevision(tx, who.subjectId);
          const changed = await d.scopes.choice(tx, {
            scopeId,
            expectedRevision: expected.value,
            subjectRevision,
            allowed,
            noticeVersion: notice,
            evidenceHash: d.crypto.hash(
              'ai.processing-choice',
              canonical({ scopeId, revision: expected.value, allowed, notice }),
            ),
          });
          if (!allowed) await d.repository.withdraw(tx, scopeId);
          return ok(
            Object.freeze({
              scopeId,
              allowed,
              permissionRevision: changed.permissionRevision.toString(),
            }),
          );
        });
      });
    },
    status(keys: readonly KeyDigest[], raw: unknown) {
      return safely(async () => {
        const requestId = uuid('ai_request', raw),
          authorization = capturedKeys(keys);
        return run(async (tx) => {
          const who = await owner(tx, authorization),
            work = await d.repository.work(tx, requestId),
            request = await d.requests.get(tx, requestId);
          demand(work && request && work.ownerId === who.subjectId, 'not_found');
          if (!(await currentWork(tx, work)))
            return ok(view(work.reportId, work.version, 'unavailable', requestId));
          if (request.state === 'accepted') {
            const attached = await d.repository.output(tx, work);
            return ok(
              view(
                work.reportId,
                work.version,
                attached ? 'available' : 'expired',
                requestId,
                attached,
              ),
            );
          }
          const state =
            request.expiresAt <= clock()
              ? 'expired'
              : request.state === 'queued' || request.state === 'running'
                ? 'pending'
                : 'unavailable';
          return ok(view(work.reportId, work.version, state, requestId));
        });
      });
    },
    execute(raw: unknown) {
      return safely<
        Readonly<{ requestId: Id<'ai_request'>; state: 'available' | 'unavailable' | 'deferred' }>
      >(async () => {
        const requestId = uuid('ai_request', raw);
        const admission = await run(async (tx) => {
          const work = await d.repository.work(tx, requestId),
            request = await d.requests.get(tx, requestId);
          demand(work && request, 'not_found');
          demand(await currentWork(tx, work), 'unavailable');
          const scope = await d.scopes.scope(tx, request.scopeId),
            policy = await d.scopes.policy(tx, request.policyId);
          demand(
            scope &&
              policy &&
              scope.state === 'active' &&
              scope.processingAllowed &&
              policy.status === 'active',
            'unavailable',
          );
          if (request.state !== 'queued') return ok(null);
          const job = await d.jobs.lease(tx, work.jobId);
          if (!job) return ok(null);
          demand(
            job.input.type === 'ai.report-analysis' && String(job.input.resourceId) === requestId,
            'integrity',
          );
          const lease = await d.reuse.claim(
            tx,
            scope.id,
            request.digest,
            d.crypto.id('ai_holder', job.token),
            120,
          );
          demand(lease, 'conflict');
          const plan = await d.admission.plan(tx, policy, scope, request);
          demand(
            plan &&
              plan.configurationHash === work.configuration.configurationHash &&
              plan.currency === 'USD' &&
              plan.windows.length >= 1 &&
              plan.windows.length <= 3,
            'unavailable',
          );
          const windows = plan.windows.map((w) => {
            demand(
              id('ai_budget', w.id).ok &&
                typeof w.amountMinor === 'bigint' &&
                w.amountMinor > 0n &&
                w.amountMinor <= maxInt64,
            );
            return Object.freeze({ ...w });
          });
          demand(new Set(windows.map((w) => w.id)).size === windows.length);
          const attempt = await d.requests.attempt(tx, {
            id: d.crypto.id('ai_attempt', requestId + '\0attempt-1'),
            requestId,
            ordinal: 1,
            currency: 'USD',
          });
          demand(attempt.state === 'created', 'conflict');
          await d.budgets.reserve(tx, attempt.id, windows);
          await d.requests.transition(tx, requestId, 'queued', 'running');
          await d.requests.start(tx, attempt.id);
          await d.jobs.fence(tx, job);
          return ok({ work, request, scope, attempt, lease, job, windows });
        });
        if (!admission.ok) return admission;
        if (!admission.value) return ok(Object.freeze({ requestId, state: 'deferred' as const }));
        const a = admission.value;
        let response: AnalysisProviderResult;
        try {
          response = await d.provider.analyze({
            packet: a.work.packet,
            configuration: a.work.configuration,
            deadlineMs: 25000,
            attempt: a.attempt.id,
          });
        } catch {
          response = {
            state: 'unavailable',
            providerRequestId: null,
            inputTokens: null,
            outputTokens: null,
            costMinor: null,
          };
        }
        const selected =
          response.state === 'complete'
            ? validateAnalysisSelection(a.work.packet, response.output)
            : null;
        const excess =
          response.costMinor !== null && a.windows.some((w) => response.costMinor! > w.amountMinor);
        const accepted = selected?.ok === true && !excess;
        const uncertain = response.state === 'timeout' || response.state === 'unavailable';
        const error = accepted
          ? null
          : excess
            ? 'unknown_charge'
            : response.state === 'refused'
              ? 'refused'
              : response.state === 'timeout'
                ? 'timeout'
                : response.state === 'unavailable'
                  ? 'provider_unavailable'
                  : 'invalid_output';
        const charged = await run(async (tx) => {
          await d.requests.finish(tx, {
            id: a.attempt.id,
            state: accepted ? 'succeeded' : uncertain ? 'uncertain' : 'failed',
            providerRequestId: response.providerRequestId,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            costMinor: response.costMinor,
            costStatus: response.costMinor === null ? 'unknown' : 'reconciled',
            error,
          });
          await d.budgets.reconcile(tx, a.attempt.id, {
            state: response.costMinor === null || excess ? 'uncertain' : 'settled',
            costMinor: response.costMinor === null || excess ? null : response.costMinor,
            reason: null,
            evidenceId: null,
          });
          return ok(null);
        });
        if (!charged.ok) return charged;
        if (!accepted || !selected?.ok) {
          const finished = await run(async (tx) => {
            await d.jobs.fence(tx, a.job);
            const current = await d.requests.get(tx, requestId);
            if (current?.state === 'running')
              await d.requests.transition(
                tx,
                requestId,
                'running',
                uncertain ? 'uncertain' : 'failed',
              );
            await d.jobs.complete(tx, a.job);
            return ok(null);
          });
          if (!finished.ok) return finished;
          return ok(Object.freeze({ requestId, state: 'unavailable' as const }));
        }
        const published = await run(async (tx) => {
          await d.jobs.fence(tx, a.job);
          demand(await currentWork(tx, a.work), 'unavailable');
          const current = await d.requests.get(tx, requestId);
          demand(current?.state === 'running', 'conflict');
          const validSeconds = Math.min(
            604800,
            ...a.work.packet.sources.map(
              (s) => Math.floor((Date.parse(s.validUntil) - Date.parse(clock())) / 1000) - 5,
            ),
          );
          demand(validSeconds > 0, 'unavailable');
          await d.requests.transition(tx, requestId, 'running', 'accepted');
          const artifact = await d.artifacts.publish(tx, {
            id: d.crypto.id('ai_artifact', requestId),
            requestId,
            attemptId: a.attempt.id,
            lease: a.lease,
            output: json(renderAnalysisSelection(a.work.packet, selected.value), 16384),
            validSeconds,
            retainSeconds: 2592000,
            sources: a.work.packet.sources.map((s) => ({
              key: s.id,
              datasetId: uuid('dataset', s.id),
              adviceId: null,
              claimHash: d.crypto.hash(
                'ai.source-claims',
                canonical({
                  source: s.id,
                  claims: a.work.packet.claims.filter((c) => c.citations.includes(s.id)),
                }),
              ),
              rightsUntil: s.validUntil as import('../../../domain/src/values/core.ts').Instant,
            })),
          });
          await d.attachments.append(tx, {
            reportId: a.work.reportId,
            version: a.work.version,
            expectedRevision: a.work.expectedAttachment,
            artifactId: artifact.id,
            scopeId: a.scope.id,
            ownerId: a.work.ownerId,
            kind: 'owner',
            authorizationScopeId: a.scope.id,
            permissionRevision: a.scope.permissionRevision,
            subjectRevision: a.scope.subjectRevision!,
          });
          await d.jobs.complete(tx, a.job);
          return ok(Object.freeze({ requestId, state: 'available' as const }));
        });
        if (!published.ok) return published;
        return published;
      });
    },
  });
}
