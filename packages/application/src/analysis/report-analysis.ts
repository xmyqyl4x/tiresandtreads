import {
  id,
  instant,
  revision,
  ok,
  fail,
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
import { createAnalysisRunner } from './analysis-runner.ts';
import type {
  AnalysisCommandCache,
  AnalysisExecutionRuntime,
} from '../ports/analysis-execution.ts';
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
  cache?: AnalysisCommandCache;
  runtime?: AnalysisExecutionRuntime;
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
    attachment(keys: readonly KeyDigest[], raw: unknown) {
      return safely(async () => {
        const x = exact(raw, 'reportId,version'),
          reportId = uuid('report', x.reportId),
          authorization = capturedKeys(keys);
        demand(
          typeof x.version === 'number' &&
            Number.isSafeInteger(x.version) &&
            x.version >= 1 &&
            x.version <= 2147483647,
        );
        const version = x.version;
        return run(async (tx) => {
          const who = await owner(tx, authorization),
            evidence = await d.repository.evidence(tx, who.subjectId, reportId, version);
          demand(evidence, 'not_found');
          const projection = await d.attachments.report(tx, who.subjectId, reportId, version);
          return ok({
            state: projection ? ('available' as const) : ('unavailable' as const),
            reportId,
            version,
            attachment: projection
              ? {
                  revision: projection.revision,
                  kind: projection.kind,
                  output: projection.output,
                  generatedAt: projection.generatedAt,
                  validUntil: projection.validUntil,
                }
              : null,
          });
        });
      });
    },
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
          const manifest = {
            parameters: { ...packet },
            bundle_id: packet.bundleId,
            authoritative_hash: packet.authoritativeHash,
            rule_version: packet.ruleVersion,
          };
          const request =
            (d.cache
              ? await d.cache.lookup(tx, { scope, policy, key, manifest, reportId, version })
              : null) ??
            (await d.requests.create(tx, {
              id: d.crypto.id('ai_request', scopeKey + '\0' + key),
              scopeId: scope.id,
              key,
              manifest,
              deadlineSeconds: 120,
            }));
          const work = await d.repository.enqueue(tx, {
            requestId: request.id,
            reportId,
            version,
            ownerId: who.subjectId,
            packet,
            expectedAttachment: evidence.attachmentRevision,
          });
          if (d.cache) await d.cache.remember(tx, { scope, key, request, reportId, version });
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
              request.expiresAt <= clock()
                ? 'expired'
                : request.state === 'queued' || request.state === 'running'
                  ? 'pending'
                  : 'unavailable',
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
        const committed = await run(async (tx) => {
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
          return ok(
            Object.freeze({
              scopeId,
              allowed,
              permissionRevision: changed.permissionRevision.toString(),
              cleanupPending: !allowed,
            }),
          );
        });
        if (!committed.ok || allowed) return committed;
        // Permission denial commits before any potentially contended cleanup work.
        // Billing/terminalization failures must never restore processing permission.
        const cleaned = await run(async (tx) => ok(await d.repository.withdraw(tx, scopeId)));
        return ok(
          Object.freeze({ ...committed.value, cleanupPending: !cleaned.ok || cleaned.value }),
        );
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
          const scope = await d.scopes.scope(tx, request.scopeId);
          demand(scope && scope.kind === 'owner' && scope.ownerId === who.subjectId, 'not_found');
          const processing = Object.freeze({
            scopeId: scope.id,
            permissionRevision: scope.permissionRevision.toString(),
            allowed: scope.processingAllowed,
          });
          const response = (
            state: AnalysisStatus['state'],
            output: AnalysisStatus['output'] = null,
          ) =>
            ok(
              Object.freeze({
                ...view(work.reportId, work.version, state, requestId, output),
                processing,
              }),
            );
          if (!(await currentWork(tx, work))) return response('unavailable');
          if (request.state === 'accepted') {
            const attached = await d.repository.output(tx, work);
            return response(attached ? 'available' : 'expired', attached);
          }
          const state =
            request.expiresAt <= clock()
              ? 'expired'
              : request.state === 'queued' || request.state === 'running'
                ? 'pending'
                : 'unavailable';
          return response(state);
        });
      });
    },
    execute: createAnalysisRunner<AnalysisWork>({
      ...d,
      async prepare(tx, requestId) {
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
        return {
          work,
          request,
          scope,
          policy,
          jobId: work.jobId,
          configurationHash: work.configuration.configurationHash,
          jobType: 'ai.report-analysis',
          resourceId: requestId,
        };
      },
      current: currentWork,
      invoke: (work, attempt) =>
        d.provider.analyze({
          packet: work.packet,
          configuration: work.configuration,
          deadlineMs: 25000,
          attempt,
        }),
      validate(work, raw) {
        const selected = validateAnalysisSelection(work.packet, raw);
        if (!selected.ok) return null;
        return {
          output: json(renderAnalysisSelection(work.packet, selected.value), 16384),
          expiresAt: work.packet.sources
            .map((s) => s.validUntil)
            .sort()[0]! as import('../../../domain/src/values/core.ts').Instant,
          sources: work.packet.sources.map((s) => ({
            key: s.id,
            datasetId: uuid('dataset', s.id),
            adviceId: null,
            claimHash: d.crypto.hash(
              'ai.source-claims',
              canonical({
                source: s.id,
                claims: work.packet.claims.filter((c) => c.citations.includes(s.id)),
              }),
            ),
            rightsUntil: s.validUntil as import('../../../domain/src/values/core.ts').Instant,
          })),
        };
      },
      async publish(tx, work, scope, artifact) {
        await d.attachments.append(tx, {
          reportId: work.reportId,
          version: work.version,
          expectedRevision: work.expectedAttachment,
          artifactId: artifact.id,
          scopeId: scope.id,
          ownerId: work.ownerId,
          kind: 'owner',
          authorizationScopeId: scope.id,
          permissionRevision: scope.permissionRevision,
          subjectRevision: scope.subjectRevision!,
        });
      },
    }).execute,
  });
}
