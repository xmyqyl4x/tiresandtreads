import {
  id,
  instant,
  ok,
  fail,
  maxInt64,
  type Id,
  type Result,
} from '../../../domain/src/values/core.ts';
import type {
  AIRequest,
  AIScope,
  AIPolicy,
  AIArtifact,
} from '../../../domain/src/entities/analysis.ts';
import type {
  AIScopeRepository,
  AIRequestRepository,
  AIReuseRepository,
  AIArtifactRepository,
  AIBudgetRepository,
} from '../ports/analysis-repositories.ts';
import type { AnalysisAdmission, AnalysisProviderResult } from '../ports/report-analysis.ts';
import type {
  AnalysisExecutionRuntime,
  AnalysisValidatedOutput,
} from '../ports/analysis-execution.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import type { JobRepository } from '../ports/jobs.ts';
import type { ReportCrypto } from '../ports/report-services.ts';
import { demand, serviceWork, serviceFailure } from '../services/service-work.ts';
import { json } from '../services/service-records.ts';
export interface AnalysisPreparation<W> {
  readonly request: AIRequest;
  readonly scope: AIScope;
  readonly policy: AIPolicy;
  readonly work: W;
  readonly jobId: Id<'job'>;
  readonly configurationHash: string;
  readonly jobType: string;
  readonly resourceId: string;
}
export function createAnalysisRunner<W>(d: {
  uow: UnitOfWork;
  scopes: AIScopeRepository;
  requests: AIRequestRepository;
  reuse: AIReuseRepository;
  artifacts: AIArtifactRepository;
  budgets: AIBudgetRepository;
  jobs: JobRepository;
  admission: AnalysisAdmission;
  crypto: Pick<ReportCrypto, 'id' | 'hash'>;
  now: () => string;
  runtime?: AnalysisExecutionRuntime;
  prepare(tx: Tx, id: Id<'ai_request'>): Promise<AnalysisPreparation<W>>;
  current(tx: Tx, work: W): Promise<boolean>;
  invoke(work: W, attempt: Id<'ai_attempt'>): Promise<AnalysisProviderResult>;
  validate(work: W, raw: unknown): AnalysisValidatedOutput | null;
  publish(tx: Tx, work: W, scope: AIScope, artifact: AIArtifact): Promise<void>;
}) {
  const run = <T>(work: (tx: Tx) => Promise<Result<T, ApplicationFailure>>) =>
    serviceWork(d.uow, work);
  function clock() {
    const r = instant(d.now());
    demand(r.ok, 'internal');
    return r.value;
  }
  type Admitted = {
    p: AnalysisPreparation<W>;
    job: NonNullable<Awaited<ReturnType<JobRepository['lease']>>>;
    lease: NonNullable<Awaited<ReturnType<AIReuseRepository['claim']>>>;
    attempt: Awaited<ReturnType<AIRequestRepository['attempt']>>;
    windows: readonly Readonly<{ id: Id<'ai_budget'>; amountMinor: bigint }>[];
    ceilings: Readonly<{ input: bigint; output: bigint }> | null;
  };
  return Object.freeze({
    async execute(
      raw: unknown,
    ): Promise<
      Result<
        Readonly<{ requestId: Id<'ai_request'>; state: 'available' | 'unavailable' | 'deferred' }>,
        ApplicationFailure
      >
    > {
      try {
        const parsed = id('ai_request', raw);
        demand(parsed.ok);
        const requestId = parsed.value;
        const admission = await run<Admitted | null>(async (tx) => {
          const p = await d.prepare(tx, requestId);
          if (p.request.state !== 'queued' && (!d.runtime || p.request.state !== 'running'))
            return ok(null);
          const dispatch = d.runtime
            ? await d.runtime.next(tx, p.request, p.policy)
            : { ordinal: 1, lease: null, generation: 0n };
          if (!dispatch) return ok(null);
          const job = await d.jobs.lease(tx, p.jobId);
          if (!job) return ok(null);
          demand(
            job.input.type === p.jobType &&
              job.input.version === 1 &&
              String(job.input.resourceId) === p.resourceId &&
              id('resource', p.resourceId).ok,
            'integrity',
          );
          const lease =
            dispatch.lease ??
            (await d.reuse.claim(
              tx,
              p.scope.id,
              p.request.digest,
              d.crypto.id('ai_holder', job.token),
              120,
            ));
          demand(lease, 'conflict');
          const plan = await d.admission.plan(tx, p.policy, p.scope, p.request);
          demand(
            plan &&
              plan.configurationHash === p.configurationHash &&
              plan.currency === 'USD' &&
              plan.windows.length >= 1 &&
              plan.windows.length <= 3,
            'unavailable',
          );
          demand(
            (plan.inputCeiling === undefined && plan.outputCeiling === undefined) ||
              (typeof plan.inputCeiling === 'bigint' &&
                plan.inputCeiling >= 1n &&
                plan.inputCeiling <= 1048576n &&
                typeof plan.outputCeiling === 'bigint' &&
                plan.outputCeiling >= 1n &&
                plan.outputCeiling <= 4096n),
          );
          const ceilings =
            plan.inputCeiling === undefined
              ? null
              : { input: plan.inputCeiling, output: plan.outputCeiling! };
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
            id: d.crypto.id('ai_attempt', requestId + '\0attempt-' + dispatch.ordinal),
            requestId,
            ordinal: dispatch.ordinal,
            currency: 'USD',
          });
          demand(attempt.state === 'created', 'conflict');
          await d.budgets.reserve(tx, attempt.id, windows);
          if (p.request.state === 'queued')
            await d.requests.transition(tx, requestId, 'queued', 'running');
          await d.requests.start(tx, attempt.id);
          if (d.runtime)
            await d.runtime.begin(tx, {
              request: p.request,
              attemptId: attempt.id,
              dispatch,
              lease,
            });
          await d.jobs.fence(tx, job);
          return ok({ p, job, lease, attempt, windows, ceilings });
        });
        if (!admission.ok) return admission;
        if (!admission.value) return ok(Object.freeze({ requestId, state: 'deferred' }));
        const a = admission.value;
        let response: AnalysisProviderResult;
        try {
          response = await d.invoke(a.p.work, a.attempt.id);
        } catch {
          response = {
            state: 'unavailable',
            providerRequestId: null,
            inputTokens: null,
            outputTokens: null,
            costMinor: null,
          };
        }
        let validated: AnalysisValidatedOutput | null = null;
        try {
          if (response.state === 'complete') validated = d.validate(a.p.work, response.output);
        } catch {
          validated = null;
        }
        const excess =
            (response.costMinor !== null &&
              a.windows.some((w) => response.costMinor! > w.amountMinor)) ||
            (a.ceilings !== null &&
              ((response.inputTokens !== null && response.inputTokens > a.ceilings.input) ||
                (response.outputTokens !== null && response.outputTokens > a.ceilings.output))),
          accepted = validated !== null && !excess,
          uncertain = response.state === 'timeout' || response.state === 'unavailable';
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
        let retry = false;
        if (d.runtime) {
          const r = await run((tx) =>
            d
              .runtime!.finish(tx, {
                request: a.p.request,
                attemptId: a.attempt.id,
                response,
                accepted,
                remainingMs: Math.max(0, Date.parse(a.p.request.expiresAt) - Date.parse(clock())),
              })
              .then(ok),
          );
          if (!r.ok) return r;
          retry = r.value;
        }
        if (!accepted || !validated) {
          const finished = await run(async (tx) => {
            const currentInput = await d.current(tx, a.p.work);
            await d.jobs.fence(tx, a.job);
            const current = await d.requests.get(tx, requestId);
            const again = retry && current?.state === 'running' && currentInput;
            if (again) await d.jobs.fail(tx, a.job);
            else {
              if (current?.state === 'running')
                await d.requests.transition(
                  tx,
                  requestId,
                  'running',
                  uncertain ? 'uncertain' : 'failed',
                );
              await d.jobs.complete(tx, a.job);
            }
            return ok(again);
          });
          if (!finished.ok) return finished;
          return ok(
            Object.freeze({ requestId, state: finished.value ? 'deferred' : 'unavailable' }),
          );
        }
        const output = validated;
        return await run(async (tx) => {
          demand(await d.current(tx, a.p.work), 'unavailable');
          await d.jobs.fence(tx, a.job);
          demand((await d.requests.get(tx, requestId))?.state === 'running', 'conflict');
          const validSeconds = Math.min(
            604800,
            Math.floor((Date.parse(output.expiresAt) - Date.parse(clock())) / 1000) - 5,
          );
          demand(validSeconds > 0, 'unavailable');
          await d.requests.transition(tx, requestId, 'running', 'accepted');
          const artifact = await d.artifacts.publish(tx, {
            id: d.crypto.id('ai_artifact', requestId),
            requestId,
            attemptId: a.attempt.id,
            lease: a.lease,
            output: json(output.output, 16384),
            validSeconds,
            retainSeconds: 2592000,
            sources: output.sources,
          });
          await d.publish(tx, a.p.work, a.p.scope, artifact);
          await d.jobs.complete(tx, a.job);
          return ok(Object.freeze({ requestId, state: 'available' as const }));
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  });
}
