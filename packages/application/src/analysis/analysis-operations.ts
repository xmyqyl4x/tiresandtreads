import { ok, fail, id, instant, type Result } from '../../../domain/src/values/core.ts';
import { partnerPrincipal, type PartnerPrincipal } from '../../../domain/src/partner-policy.ts';
import type { PartnerAuthority, PartnerClock } from '../ports/partner-services.ts';
import type { UnitOfWork, TransactionContext, ApplicationFailure } from '../ports/transactions.ts';
import type {
  AnalysisOperationsRepository,
  AnalysisTask,
  OperationsReceipt,
} from '../ports/analysis-operations.ts';
import { demand, serviceFailure, serviceWork } from '../services/service-work.ts';
import { exact } from '../services/service-records.ts';
export function createAnalysisOperationsService(d: {
  uow: UnitOfWork;
  authority: PartnerAuthority;
  clock: PartnerClock;
  repository: AnalysisOperationsRepository;
  digest: (v: unknown) => string;
  execute: (task: AnalysisTask, request: string) => Promise<Result<unknown, ApplicationFailure>>;
}) {
  const run = <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  async function safe<T>(fn: () => Promise<Result<T, ApplicationFailure>>) {
    try {
      return await fn();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  }
  async function actor(handle: string) {
    demand(typeof handle === 'string' && handle.length > 0 && handle.length <= 2048);
    const proof = await d.authority.verify(handle);
    demand(proof.ok, 'forbidden');
    const p = partnerPrincipal(proof.value, d.clock.now());
    demand(p.ok && p.value.staffId, 'forbidden');
    return p.value;
  }
  function fresh(p: PartnerPrincipal) {
    demand(partnerPrincipal(p, d.clock.now()).ok && p.staffId, 'forbidden');
  }
  async function capabilities(tx: TransactionContext, p: PartnerPrincipal) {
    fresh(p);
    const r = d.repository;
    return {
      aiObserve: await r.authorize(tx, p.staffId!, p.subject, 'ai.observe'),
      aiControl: await r.authorize(tx, p.staffId!, p.subject, 'ai.control'),
      photoObserve: await r.authorize(tx, p.staffId!, p.subject, 'photo.observe'),
    };
  }
  async function control(tx: TransactionContext, p: PartnerPrincipal) {
    fresh(p);
    demand(await d.repository.authorize(tx, p.staffId!, p.subject, 'ai.control'), 'forbidden');
  }
  function identity<K extends string>(kind: K, raw: unknown) {
    const v = id(kind, raw);
    demand(v.ok);
    return v.value;
  }
  function digest(v: unknown) {
    const h = d.digest(v);
    demand(/^[a-f0-9]{64}$/.test(h), 'internal');
    return h;
  }
  const service = {
    session(handle: string) {
      return safe(async () => {
        const p = await actor(handle);
        return run(async (tx) => {
          const c = await capabilities(tx, p);
          demand(c.aiObserve || c.aiControl || c.photoObserve, 'forbidden');
          fresh(p);
          return { capabilities: c };
        });
      });
    },
    read(handle: string, rawDay: unknown) {
      return safe(async () => {
        demand(typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay));
        const day = rawDay,
          from = instant(day + 'T00:00:00.000Z'),
          now = new Date(d.clock.now());
        demand(
          from.ok &&
            new Date(from.value).toISOString().slice(0, 10) === day &&
            day <= now.toISOString().slice(0, 10),
        );
        const until = instant(new Date(Date.parse(from.value) + 86400000).toISOString());
        demand(until.ok, 'internal');
        const p = await actor(handle);
        return run(async (tx) => {
          const c = await capabilities(tx, p);
          demand(c.aiObserve || c.photoObserve, 'forbidden');
          const data = await d.repository.snapshot(tx, from.value, until.value, {
            ai: c.aiObserve,
            photo: c.photoObserve,
          });
          fresh(p);
          return {
            day,
            from: from.value,
            until: until.value,
            checkedAt: now.toISOString(),
            capabilities: c,
            data,
          };
        });
      });
    },
    receipt(
      handle: string,
      rawId: unknown,
    ): Promise<Result<OperationsReceipt, ApplicationFailure>> {
      return safe(async () => {
        const command = identity('ai_operation', rawId),
          p = await actor(handle);
        return run(async (tx) => {
          await control(tx, p);
          const r = await d.repository.receipt(tx, command, p.staffId!);
          demand(r, 'not_found');
          fresh(p);
          return r;
        });
      });
    },
    disable(handle: string, raw: unknown): Promise<Result<OperationsReceipt, ApplicationFailure>> {
      return safe(async () => {
        const x = exact(raw, 'fingerprint,id,policy'),
          command = identity('ai_operation', x.id),
          policy = identity('ai_policy', x.policy);
        demand(typeof x.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(x.fingerprint));
        const fingerprint = x.fingerprint,
          p = await actor(handle),
          hash = digest({ operation: 'disable', policy, fingerprint });
        return run(async (tx) => {
          await control(tx, p);
          const claimed = await d.repository.claim(tx, {
            id: command,
            actor: p.staffId!,
            operation: 'disable',
            target: identity('ai_target', policy),
            digest: hash,
          });
          if (!claimed.created) return claimed.receipt;
          const changed = await d.repository.disable(tx, policy, fingerprint);
          fresh(p);
          return d.repository.finish(tx, command, p.staffId!, changed ? 'succeeded' : 'refused');
        });
      });
    },
    resume(handle: string, raw: unknown): Promise<Result<OperationsReceipt, ApplicationFailure>> {
      return safe(async () => {
        const x = exact(raw, 'id,request'),
          command = identity('ai_operation', x.id),
          request = identity('ai_request', x.request),
          p = await actor(handle),
          hash = digest({ operation: 'resume', request });
        const admitted = await run(async (tx) => {
          await control(tx, p);
          const claimed = await d.repository.claim(tx, {
            id: command,
            actor: p.staffId!,
            operation: 'resume',
            target: identity('ai_target', request),
            digest: hash,
          });
          if (!claimed.created) return { receipt: claimed.receipt, task: null };
          const task = await d.repository.work(tx, request);
          fresh(p);
          return {
            receipt: task
              ? claimed.receipt
              : await d.repository.finish(tx, command, p.staffId!, 'refused'),
            task,
          };
        });
        if (!admitted.ok) return admitted;
        if (!admitted.value.task) return ok(admitted.value.receipt);
        // Durable approval precedes the existing worker. It still owns privacy, source, budget,
        // lease, critical validation and unknown-charge checks. No request/attempt is reset here.
        const authorized = await run(async (tx) => control(tx, p));
        let state: 'succeeded' | 'refused' | 'unknown' = 'refused';
        if (authorized.ok) {
          try {
            const r = await d.execute(admitted.value.task, request);
            state = r.ok ? 'succeeded' : r.error.code === 'commit_unknown' ? 'unknown' : 'refused';
          } catch {
            state = 'unknown';
          }
        }
        // System receipt completion remains durable even if caller access is revoked during work.
        const saved = await run((tx) => d.repository.finish(tx, command, p.staffId!, state));
        if (!saved.ok) return saved;
        return service.receipt(handle, command);
      });
    },
  };
  return Object.freeze(service);
}
