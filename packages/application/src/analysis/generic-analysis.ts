import {
  id,
  instant,
  ok,
  fail,
  type Id,
  type Instant,
  type Result,
} from '../../../domain/src/values/core.ts';
import {
  normalizeSharedParameters,
  validateGenericSelection,
  renderGenericSelection,
  type GenericAnalysisPacket,
} from '../../../domain/src/analysis-reuse-policy.ts';
import type {
  GenericAnalysisRepository,
  GenericAnalysisProvider,
  GenericAnalysisView,
  GenericDefinition,
  GenericWork,
} from '../ports/generic-analysis.ts';
import type {
  AIScopeRepository,
  AIRequestRepository,
  AIReuseRepository,
  AIArtifactRepository,
  AIBudgetRepository,
} from '../ports/analysis-repositories.ts';
import type { AnalysisExecutionRuntime } from '../ports/analysis-execution.ts';
import type { AnalysisAdmission } from '../ports/report-analysis.ts';
import type {
  UnitOfWork,
  ApplicationFailure,
  TransactionContext as Tx,
} from '../ports/transactions.ts';
import type { ReportCrypto } from '../ports/report-services.ts';
import type { JobRepository } from '../ports/jobs.ts';
import { serviceWork, serviceFailure, demand } from '../services/service-work.ts';
import { exact, json, canonical } from '../services/service-records.ts';
import { createAnalysisRunner } from './analysis-runner.ts';
export function createGenericAnalysisServices(d: {
  uow: UnitOfWork;
  repository: GenericAnalysisRepository;
  scopes: AIScopeRepository;
  requests: AIRequestRepository;
  reuse: AIReuseRepository;
  artifacts: AIArtifactRepository;
  budgets: AIBudgetRepository;
  jobs: JobRepository;
  runtime: AnalysisExecutionRuntime;
  admission: AnalysisAdmission;
  provider: GenericAnalysisProvider;
  crypto: Pick<ReportCrypto, 'id' | 'hash'>;
  now: () => string;
  validitySeconds?: number;
}) {
  const validity = d.validitySeconds ?? 604800;
  demand(Number.isInteger(validity) && validity >= 10 && validity <= 604800);
  const run = <T>(work: (tx: Tx) => Promise<Result<T, ApplicationFailure>>) =>
    serviceWork(d.uow, work);
  const safely = async <T>(work: () => Promise<Result<T, ApplicationFailure>>) => {
    try {
      return await work();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  };
  function clock() {
    const at = instant(d.now());
    demand(at.ok, 'internal');
    return at.value;
  }
  function uuid<K extends string>(kind: K, raw: unknown) {
    const value = id(kind, raw);
    demand(value.ok);
    return value.value;
  }
  function view(
    state: GenericAnalysisView['state'],
    requestId: Id<'ai_request'> | null = null,
    output: GenericAnalysisView['output'] = null,
  ): GenericAnalysisView {
    return Object.freeze({ state, id: requestId, output });
  }
  async function queue(
    tx: Tx,
    definition: GenericDefinition,
    raw: unknown,
    allowed: boolean,
    refreshKey: string | null = null,
  ): Promise<GenericAnalysisView> {
    const policy = await d.scopes.policy(tx, definition.policyId);
    demand(
      policy &&
        policy.task === 'generic_explanation' &&
        policy.sharedAllowed &&
        policy.status === 'active',
      'unavailable',
    );
    const normalized = normalizeSharedParameters(raw, policy.sharedParameters);
    demand(normalized.ok);
    const parameters = normalized.value,
      scopeKey = d.crypto.hash('ai.generic-scope', definition.id + '\0' + policy.id);
    let scope = await d.repository.scope(tx, definition, scopeKey);
    if (!scope) {
      if (!allowed) return view('unavailable');
      scope = await d.scopes.create(tx, {
        id: d.crypto.id('ai_scope', scopeKey),
        policyId: policy.id,
        ownerId: null,
        subjectRevision: null,
        key: scopeKey,
        noticeVersion: 'generic-processing-v1',
        evidenceHash: d.crypto.hash(
          'ai.generic-review',
          canonical({
            definition: definition.id,
            policy: policy.id,
            fact: definition.fact.id,
            text: definition.fact.text,
          }),
        ),
      });
    }
    demand(
      scope.kind === 'shared' &&
        scope.ownerId === null &&
        scope.state === 'active' &&
        scope.processingAllowed,
      'unavailable',
    );
    const digest = await d.repository.digest(tx, scope, policy, definition, parameters),
      hit = await d.repository.lookup(
        tx,
        scope,
        digest,
        definition.id,
        refreshKey !== null,
        validity,
      );
    if (hit) {
      if (hit.output) {
        await d.repository.touch(tx, scope, digest);
        return view('available', hit.requestId, hit.output);
      }
      return view('pending', hit.requestId);
    }
    if (!allowed || (await d.repository.blocked(tx, scope, digest))) return view('unavailable');
    // The scope lock and pending lookup coalesce misses; each terminal generation gets a fresh key.
    const key = refreshKey ?? 'generic-' + d.crypto.id('ai_request');
    const request = await d.requests.create(tx, {
      id: d.crypto.id('ai_request', scopeKey + '\0' + key),
      scopeId: scope.id,
      key,
      manifest: { parameters, rule_version: definition.id, advice_revision: definition.fact.id },
      deadlineSeconds: 120,
    });
    const packet: GenericAnalysisPacket = Object.freeze({
      schema: 'generic-evidence-v1',
      definition: definition.id,
      parameters,
      fact: definition.fact,
    });
    await d.repository.enqueue(tx, request, definition, packet);
    return view(
      request.state === 'queued' || request.state === 'running' ? 'pending' : 'unavailable',
      request.id,
    );
  }
  const execute = createAnalysisRunner<GenericWork>({
    ...d,
    async prepare(tx, requestId) {
      const work = await d.repository.work(tx, requestId),
        request = await d.requests.get(tx, requestId);
      demand(work && request, 'not_found');
      demand(await d.repository.current(tx, work), 'unavailable');
      const scope = await d.scopes.scope(tx, request.scopeId),
        policy = await d.scopes.policy(tx, request.policyId);
      demand(
        scope &&
          scope.kind === 'shared' &&
          policy &&
          policy.task === 'generic_explanation' &&
          policy.status === 'active' &&
          work.configuration.schema === 'generic-selection-v1' &&
          work.configuration.validator === 'generic-validator-v1',
        'unavailable',
      );
      return {
        work,
        request,
        scope,
        policy,
        jobId: work.jobId,
        configurationHash: work.configuration.configurationHash,
        jobType: 'ai.generic-analysis',
        resourceId: requestId,
      };
    },
    current: (tx, work) => d.repository.current(tx, work),
    invoke: (work, attempt) =>
      d.provider.analyze({
        packet: work.packet,
        configuration: work.configuration,
        attempt,
        deadlineMs: 25000,
      }),
    validate(work, raw) {
      const selected = validateGenericSelection(work.packet, raw);
      if (!selected.ok) return null;
      const until = Math.min(
        Date.parse(work.packet.fact.validUntil),
        Date.parse(clock()) + validity * 1000,
      );
      return {
        output: json(renderGenericSelection(work.packet, selected.value), 8192),
        expiresAt: new Date(until).toISOString() as Instant,
        sources: [
          {
            key: work.packet.fact.id,
            datasetId: null,
            adviceId: uuid('advice_fact', work.packet.fact.id),
            claimHash: d.crypto.hash(
              'ai.generic-claim',
              canonical({ fact: work.packet.fact, parameters: work.packet.parameters }),
            ),
            rightsUntil: work.packet.fact.validUntil as Instant,
          },
        ],
      };
    },
    async publish() {
      /* Generic public output is cached; it never mutates an owner report. */
    },
  }).execute;
  return Object.freeze({
    read(raw: unknown) {
      return safely(async () => {
        const x = exact(raw, 'allowed,definitionId,parameters'),
          definitionId = uuid('ai_definition', x.definitionId),
          parameters = json(x.parameters, 2048);
        demand(typeof x.allowed === 'boolean');
        const allowed = x.allowed;
        return run(async (tx) => {
          const definition = await d.repository.definition(tx, definitionId);
          if (!definition) return ok(view('unavailable'));
          return ok(await queue(tx, definition, parameters, allowed));
        });
      });
    },
    execute,
    async refreshPopular() {
      // Commit reuse-row expiry before refresh enqueue acquires scope roots.
      const maintained = await run(async (tx) => {
        await d.repository.maintain(tx);
        return ok(null);
      });
      if (!maintained.ok) return maintained;
      return run(async (tx) => {
        const inputs = await d.repository.refresh(tx),
          requests: Id<'ai_request'>[] = [];
        for (const input of inputs) {
          const definition = await d.repository.definition(tx, input.definitionId);
          if (!definition) continue;
          const result = await queue(tx, definition, input.parameters, true, input.key);
          if (result.state === 'pending' && result.id) requests.push(result.id);
        }
        return ok(
          Object.freeze({
            scheduled: requests.length,
            requestIds: Object.freeze(requests),
            hourlyMaximum: 25,
          }),
        );
      });
    },
  });
}
