import { ok, fail, id, type Id, type Result } from '../../../domain/src/values/core.ts';
import type { AnalysisErasureRepository } from '../ports/analysis-lifecycle.ts';
import type {
  PrivacyCrypto,
  PrivacyJournal,
  PrivacyMail,
  SignedPrivacyRecord,
} from '../ports/privacy-services.ts';
import type { ContactEncryption } from '../ports/contact-services.ts';
import type { PrivateObjects } from '../ports/assets.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import type { AIScopeRepository } from '../ports/analysis-repositories.ts';
import { serviceWork, demand, serviceFailure } from '../services/service-work.ts';
import { canonical, exact } from '../services/service-records.ts';
import type { createPrivacyServices } from '../services/privacy.ts';
export function createAnalysisErasureServices(d: {
  readonly uow: UnitOfWork;
  readonly ownerUow: UnitOfWork;
  readonly repository: AnalysisErasureRepository;
  readonly owners: AnalysisErasureRepository;
  readonly crypto: PrivacyCrypto;
  readonly journal: PrivacyJournal;
  readonly encryption: ContactEncryption;
  readonly objects: PrivateObjects;
  readonly mail: PrivacyMail;
  readonly provider: {
    erase(
      i: Readonly<{ provider: string; kind: 'file' | 'response'; reference: string; key: string }>,
    ): Promise<'erased' | 'not_stored' | 'unsupported'>;
  };
  readonly now: () => string;
}) {
  const run = <T>(fn: (tx: Tx) => Promise<T>) => serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  const ownerRun = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.ownerUow, async (tx) => ok(await fn(tx)));
  function uid<K extends string>(kind: K, raw: unknown) {
    const r = id(kind, raw);
    demand(r.ok);
    return r.value;
  }
  function capturedKeys(raw: readonly KeyDigest[]) {
    demand(Array.isArray(raw) && raw.length > 0 && raw.length <= 4);
    return Object.freeze(
      raw.map((v) => {
        const x = exact(v, 'digest,keyVersion');
        demand(
          typeof x.digest === 'string' &&
            /^[a-f0-9]{64}$/.test(x.digest) &&
            typeof x.keyVersion === 'string' &&
            /^[A-Za-z0-9_-]{1,80}$/.test(x.keyVersion),
        );
        return Object.freeze({ digest: x.digest, keyVersion: x.keyVersion });
      }),
    );
  }
  const services = {
    async removeScope(keys: readonly KeyDigest[], raw: unknown, command: string) {
      try {
        const scope = uid('ai_scope', raw),
          auth = capturedKeys(keys);
        demand(typeof command === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(command));
        return ownerRun((tx) =>
          d.owners.beginScope(
            tx,
            auth,
            scope,
            d.crypto.hash(
              'analysis-erasure-command',
              canonical({ keys: auth, scope, command }, 4096),
            ),
          ),
        );
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    forRequest: (request: Id<'privacy_request'>) =>
      run((tx) => d.repository.beginRequest(tx, request)),
    status: (job: Id<'analysis_erasure'>) => run((tx) => d.repository.status(tx, job)),
    pending: () => run((tx) => d.repository.pending(tx)),
    retry: (job: Id<'analysis_erasure'>, actor: Id<'staff'>, evidence: string) =>
      run((tx) => d.repository.operatorRetry(tx, job, actor, evidence)),
    async registerProvider(raw: unknown) {
      try {
        const x = exact(raw, 'attemptId,id,kind,provider,reference,scopeId'),
          resource = uid('erasure_resource', x.id),
          scope = uid('ai_scope', x.scopeId),
          attempt = uid('ai_attempt', x.attemptId);
        demand(
          typeof x.provider === 'string' &&
            /^[a-z][a-z0-9_-]{0,63}$/.test(x.provider) &&
            (x.kind === 'file' || x.kind === 'response') &&
            typeof x.reference === 'string' &&
            /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(x.reference),
        );
        const provider = x.provider,
          kind = x.kind,
          reference = await d.encryption.encrypt(
            new TextEncoder().encode(x.reference),
            'analysis_provider_object',
            resource,
          );
        const referenceKeys = d.crypto.markers(
          'analysis-provider-reference',
          canonical({ resource, scope, attempt, provider, kind, reference: x.reference }, 4096),
        );
        return ownerRun(async (tx) => {
          await d.owners.registerProvider(tx, {
            id: resource,
            scopeId: scope,
            attemptId: attempt,
            provider,
            kind,
            reference,
            referenceKeys,
          });
          return null;
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async workOne(
      job: Id<'analysis_erasure'>,
    ): Promise<
      Result<
        Readonly<{ status: 'pending' | 'complete' | 'blocked' | 'retry_pending' }> | null,
        ApplicationFailure
      >
    > {
      const acquired = await run((tx) => d.repository.acquire(tx, job));
      if (!acquired.ok) return acquired;
      if (!acquired.value) return ok(null);
      const l = acquired.value;
      try {
        if (l.phase === 'journal') {
          const found = await run((tx) => d.repository.marks(tx, l));
          demand(found.ok && found.value.length > 0, 'integrity');
          const pinned = await run((tx) =>
            d.repository.journal(
              tx,
              l,
              d.crypto.sign({ version: 1, kind: 'analysis_scope_erasure', marks: found.value }),
            ),
          );
          demand(pinned.ok && d.crypto.verify(pinned.value), 'forbidden');
          const signed = pinned.value;
          await d.journal.append(signed.digest, signed);
          const recorded = await run((tx) => d.repository.journaled(tx, l, signed.digest));
          demand(recorded.ok, 'unavailable');
        } else if (l.phase === 'prepare') {
          const prepared = await run((tx) => d.repository.prepare(tx, l));
          demand(prepared.ok, 'unavailable');
        } else if (l.phase === 'objects') {
          const found = await run((tx) => d.repository.object(tx, l));
          demand(found.ok, 'unavailable');
          if (found.value.asset) {
            await d.objects.erase(found.value.asset);
            const receipt = await run((tx) =>
              d.repository.receipt(
                tx,
                l,
                'objects',
                found.value.asset!.id,
                d.crypto.hash('analysis-object-erasure', found.value.asset!.id),
              ),
            );
            demand(receipt.ok, 'unavailable');
          }
        } else if (l.phase === 'providers') {
          const found = await run((tx) => d.repository.provider(tx, l));
          demand(found.ok, 'unavailable');
          if (found.value) {
            const x = found.value;
            let result: 'erased' | 'not_stored' | 'unsupported';
            if (x.kind === 'email') {
              demand(x.reference.keyVersion === 'p1-email', 'integrity');
              const raw = exact(
                JSON.parse(
                  new TextDecoder('utf-8', { fatal: true }).decode(
                    Uint8Array.from(x.reference.hex.match(/../g)!, (s) => parseInt(s, 16)),
                  ),
                ),
                'deliveryKey,messageId,provider',
              );
              demand(
                typeof raw.provider === 'string' &&
                  typeof raw.deliveryKey === 'string' &&
                  (raw.messageId === null || typeof raw.messageId === 'string'),
                'integrity',
              );
              result = await d.mail.erase({
                provider: raw.provider,
                messageId: raw.messageId,
                deliveryKey: raw.deliveryKey,
              });
            } else {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(
                await d.encryption.decrypt(x.reference, 'analysis_provider_object', x.id),
              );
              demand(/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(text), 'integrity');
              result = await d.provider.erase({
                provider: x.provider,
                kind: x.kind,
                reference: text,
                key: d.crypto.hash('analysis-provider-erasure', x.id),
              });
            }
            if (result === 'unsupported') {
              const blocked = await run((tx) => d.repository.release(tx, l, true));
              demand(blocked.ok, 'unavailable');
              return ok({ status: 'blocked' as const });
            }
            const receipt = await run((tx) =>
              d.repository.receipt(
                tx,
                l,
                'providers',
                x.id,
                d.crypto.hash('analysis-provider-receipt', x.id + ':' + result),
              ),
            );
            demand(receipt.ok, 'unavailable');
          }
        } else {
          const purged = await run((tx) => d.repository.purge(tx, l));
          demand(purged.ok, 'unavailable');
          if (purged.value === 'charges') {
            const blocked = await run((tx) => d.repository.release(tx, l, true));
            demand(blocked.ok, 'unavailable');
            return ok({ status: 'blocked' as const });
          }
          if (purged.value === 'complete') {
            const done = await run((tx) => d.repository.finish(tx, l));
            demand(done.ok, 'unavailable');
            return ok({ status: 'complete' as const });
          }
        }
        const released = await run((tx) => d.repository.release(tx, l, false));
        demand(released.ok, 'unavailable');
        return ok({ status: 'pending' as const });
      } catch {
        const released = await run((tx) => d.repository.release(tx, l, false, true));
        if (!released.ok) return released;
        const state = await run((tx) => d.repository.status(tx, job));
        return state.ok
          ? ok({
              status: state.value === 'blocked' ? ('blocked' as const) : ('retry_pending' as const),
            })
          : state;
      }
    },
    async sweep() {
      return run(async (tx) => {
        const scopes = await d.repository.expired(tx);
        const jobs: Id<'analysis_erasure'>[] = [];
        for (const scope of scopes) jobs.push(await d.repository.beginExpired(tx, scope));
        return Object.freeze(jobs);
      });
    },
    async save(keys: readonly KeyDigest[], raw: unknown) {
      try {
        const x = exact(raw, 'command,noticeVersion,uploadId'),
          upload = uid('photo_upload', x.uploadId),
          auth = capturedKeys(keys);
        demand(
          typeof x.command === 'string' &&
            /^[A-Za-z0-9_-]{16,128}$/.test(x.command) &&
            typeof x.noticeVersion === 'string' &&
            x.noticeVersion.length <= 100,
        );
        const notice = x.noticeVersion,
          evidence = d.crypto.hash(
            'photo-save-choice',
            canonical({ keys: auth, upload, notice, command: x.command }, 4096),
          );
        return ownerRun((tx) => d.owners.save(tx, auth, upload, notice, evidence));
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async replay(signed: SignedPrivacyRecord) {
      try {
        const raw = d.crypto.verify(signed);
        demand(raw, 'forbidden');
        const snapshot = exact(raw, 'capturedAt,entries,version');
        demand(
          snapshot.version === 1 &&
            typeof snapshot.capturedAt === 'string' &&
            Number.isFinite(Date.parse(snapshot.capturedAt)) &&
            Array.isArray(snapshot.entries) &&
            snapshot.entries.length <= 1000,
          'forbidden',
        );
        const age = Date.parse(d.now()) - Date.parse(snapshot.capturedAt);
        demand(age >= -5000 && age <= 300000, 'forbidden');
        const marks = snapshot.entries.flatMap((entry) => {
          const x = exact(entry, 'kind,marks,version');
          demand(
            x.version === 1 &&
              x.kind === 'analysis_scope_erasure' &&
              Array.isArray(x.marks) &&
              x.marks.length <= 25,
            'forbidden',
          );
          return x.marks;
        });
        demand(marks.length <= 1000, 'invalid_input');
        return run(async (tx) => {
          await d.repository.replay(tx, marks, signed.digest);
          return { replayed: marks.length, trafficActivation: false as const };
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  };
  return Object.freeze(services);
}
export function withFreshAnalysisScopes(
  base: AIScopeRepository,
  rights: AnalysisErasureRepository,
  createId: () => Id<'ai_scope'>,
): AIScopeRepository {
  return Object.freeze<AIScopeRepository>({
    ...base,
    async create(tx, input) {
      return base.create(tx, {
        ...input,
        id: (await rights.freshScope(tx, input.id)) ? createId() : input.id,
      });
    },
  });
}
export function withAnalysisPrivacy<T extends ReturnType<typeof createPrivacyServices>>(
  base: T,
  rights: ReturnType<typeof createAnalysisErasureServices>,
  retry: T['retry'],
): T {
  return {
    ...base,
    retry,
    async workOne(request) {
      const job = await rights.forRequest(request);
      if (!job.ok) return job;
      if (job.value) {
        const state = await rights.status(job.value);
        if (!state.ok) return state;
        if (state.value === 'blocked') return ok({ status: 'manual_review' as const });
        if (state.value !== 'complete') {
          const worked = await rights.workOne(job.value);
          if (!worked.ok) return worked;
          return ok({
            status:
              worked.value?.status === 'blocked'
                ? ('manual_review' as const)
                : ('processing' as const),
          });
        }
      }
      return base.workOne(request);
    },
  };
}
