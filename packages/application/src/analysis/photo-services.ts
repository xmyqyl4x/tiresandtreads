import {
  id,
  instant,
  revision,
  ok,
  fail,
  type Id,
  type Instant,
  type Result,
} from '../../../domain/src/values/core.ts';
import {
  photoFieldValue,
  photoReadingSet,
  imageMime,
  type PhotoReadings,
} from '../../../domain/src/photo-policy.ts';
import type { PhotoCandidate, PhotoField } from '../../../domain/src/entities/photo.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import type {
  PhotoServiceRepository,
  PhotoIntent,
  PhotoIntentView,
  PhotoView,
  PhotoWork,
  PhotoCodec,
  PhotoScanner,
  PhotoExtractionProvider,
} from '../ports/photo-services.ts';
import type {
  PhotoAssetRepository,
  PhotoWorkerRepository,
  PhotoOwnerRepository,
} from '../ports/photo-repositories.ts';
import type {
  AIScopeRepository,
  AIRequestRepository,
  AIReuseRepository,
  AIArtifactRepository,
  AIBudgetRepository,
} from '../ports/analysis-repositories.ts';
import type { AnalysisAdmission } from '../ports/report-analysis.ts';
import type { AnalysisExecutionRuntime } from '../ports/analysis-execution.ts';
import type { PrivateObjects, AssetLocation } from '../ports/assets.ts';
import type { ReportCrypto } from '../ports/report-services.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { JobRepository } from '../ports/jobs.ts';
import { demand, serviceWork, serviceFailure } from '../services/service-work.ts';
import { exact, json, canonical } from '../services/service-records.ts';
import { createAnalysisRunner } from './analysis-runner.ts';
const limitations = Object.freeze([
  'confirmation_required',
  'no_condition_assessment',
  'no_fitment_clearance',
] as const);
export function createPhotoServices(d: {
  uow: UnitOfWork;
  repository: PhotoServiceRepository;
  assets: PhotoAssetRepository;
  worker: PhotoWorkerRepository;
  owners: PhotoOwnerRepository;
  scopes: AIScopeRepository;
  requests: AIRequestRepository;
  reuse: AIReuseRepository;
  artifacts: AIArtifactRepository;
  budgets: AIBudgetRepository;
  jobs: JobRepository;
  runtime: AnalysisExecutionRuntime;
  admission: AnalysisAdmission;
  objects: PrivateObjects;
  codec: PhotoCodec;
  scanner: PhotoScanner;
  provider: PhotoExtractionProvider;
  crypto: Pick<ReportCrypto, 'id' | 'hash'>;
  hashBytes: (bytes: Uint8Array) => string;
  now: () => string;
  noticeVersion: string;
}) {
  demand(/^[A-Za-z0-9_-]{1,100}$/.test(d.noticeVersion));
  const run = <T>(fn: (tx: Tx) => Promise<Result<T, ApplicationFailure>>) => serviceWork(d.uow, fn),
    safe = async <T>(fn: () => Promise<Result<T, ApplicationFailure>>) => {
      try {
        return await fn();
      } catch (e) {
        return fail(serviceFailure(e));
      }
    };
  function clock() {
    const r = instant(d.now());
    demand(r.ok, 'internal');
    return r.value;
  }
  function uuid<K extends string>(kind: K, raw: unknown) {
    const r = id(kind, raw);
    demand(r.ok);
    return r.value;
  }
  function keys(raw: readonly KeyDigest[]) {
    demand(Array.isArray(raw) && raw.length >= 1 && raw.length <= 4);
    return Object.freeze(
      raw.map((x) => {
        const y = exact(x, 'digest,keyVersion');
        demand(
          typeof y.digest === 'string' &&
            /^[a-f0-9]{64}$/.test(y.digest) &&
            typeof y.keyVersion === 'string' &&
            /^[A-Za-z0-9_-]{1,80}$/.test(y.keyVersion),
        );
        return Object.freeze({ digest: y.digest, keyVersion: y.keyVersion });
      }),
    );
  }
  async function owner(tx: Tx, k: readonly KeyDigest[]) {
    const who = await d.repository.owner(tx, k);
    demand(who, 'forbidden');
    return who.subjectId;
  }
  async function authorized(tx: Tx, k: readonly KeyDigest[], upload: Id<'photo_upload'>) {
    const person = await owner(tx, k),
      i = await d.repository.intent(tx, person, upload);
    demand(i, 'not_found');
    return i;
  }
  async function cleanup(person: Id<'subject'>, upload: Id<'photo_upload'>) {
    const prepared = await run(async (tx) => ok(await d.repository.delete(tx, person, upload)));
    if (!prepared.ok) return true;
    for (const asset of prepared.value) {
      const retiring = await run(async (tx) => ok(await d.assets.deleting(tx, asset)));
      if (!retiring.ok) return true;
      try {
        await d.objects.erase(retiring.value);
      } catch {
        return true;
      }
      const removed = await run(async (tx) => {
        await d.assets.deleted(tx, retiring.value);
        return ok(null);
      });
      if (!removed.ok) return true;
    }
    const finished = await run(async (tx) => ok(await d.repository.deleted(tx, person, upload)));
    return !finished.ok || !finished.value;
  }
  async function view(tx: Tx, i: PhotoIntent): Promise<PhotoView> {
    demand(await d.repository.current(tx, i), 'not_found');
    const status = await d.owners.status(tx, i.ownerId, i.id),
      candidates = status ? await d.owners.candidates(tx, i.ownerId, i.id) : Object.freeze([]),
      dot = candidates.find((c) => c.field === 'dot_tin');
    return Object.freeze({
      id: i.id,
      state: status?.state ?? i.state,
      expiresAt: i.expiresAt,
      candidates,
      confirmations: status ? await d.owners.confirmations(tx, i.ownerId, i.id) : Object.freeze([]),
      dotStatus: dot?.value ? 'unverified_full' : dot?.rawText ? 'partial' : 'not_visible',
      limitations,
    });
  }
  const execute = createAnalysisRunner<PhotoWork>({
    ...d,
    async prepare(tx, requestId) {
      const work = await d.repository.work(tx, requestId),
        request = await d.requests.get(tx, requestId);
      demand(work && request, 'not_found');
      demand(await d.repository.currentWork(tx, work), 'unavailable');
      const scope = await d.scopes.scope(tx, request.scopeId),
        policy = await d.scopes.policy(tx, request.policyId);
      demand(
        scope &&
          policy &&
          scope.kind === 'owner' &&
          scope.ownerId === work.ownerId &&
          policy.task === 'photo_extraction' &&
          policy.status === 'active' &&
          work.configuration.schema === 'photo-selection-v1' &&
          work.configuration.validator === 'photo-fields-v1',
        'unavailable',
      );
      return {
        work,
        request,
        scope,
        policy,
        jobId: work.jobId,
        configurationHash: work.configuration.configurationHash,
        jobType: 'p2.photo.extract',
        resourceId: work.extractionId,
      };
    },
    current: d.repository.currentWork,
    async started(tx, w, job) {
      await d.worker.start(tx, w.ownerId, w.extractionId, job);
    },
    async failed(tx, w, job) {
      await d.repository.failed(tx, w.requestId, job);
    },
    async invoke(w, attempt) {
      const bytes = await d.objects.get(w.sanitized);
      demand(
        d.hashBytes(bytes) === w.sanitized.sha256 && imageMime(bytes) === 'image/jpeg',
        'integrity',
      );
      const guard = await run(async (tx) => ok(await d.repository.currentWork(tx, w)));
      demand(guard.ok && guard.value, 'unavailable');
      return d.provider.extract({
        bytes,
        sha256: w.sanitized.sha256,
        configuration: w.configuration,
        attempt,
        deadlineMs: 25000,
      });
    },
    validate(w, raw) {
      const output = photoReadingSet(raw, clock());
      if (!output.ok) return null;
      return {
        output: json(output.value, 8192),
        sources: [],
        expiresAt: w.expiresAt,
        retainSeconds: Math.min(
          2592000,
          Math.floor((Date.parse(w.expiresAt) - Date.parse(clock())) / 1000) - 5,
        ),
      };
    },
    async publish(tx, w, _scope, artifact, job) {
      const fields = artifact.output.fields as unknown as PhotoReadings['fields'],
        candidates: PhotoCandidate[] = fields.map((f) =>
          Object.freeze({
            ...f,
            id: d.crypto.id('photo_candidate', w.requestId + '\0' + f.field),
            uploadId: w.uploadId,
            ordinal: 0,
          }),
        );
      await d.worker.complete(tx, {
        ownerId: w.ownerId,
        extractionId: w.extractionId,
        lease: job,
        artifactId: artifact.id,
        candidates,
      });
    },
  });
  return Object.freeze({
    async execute(requestId: Id<'ai_request'>) {
      const result = await execute.execute(requestId);
      await run(async (tx) => {
        await d.repository.failed(tx, requestId);
        return ok(null);
      });
      return result;
    },
    capture(k: readonly KeyDigest[], raw: unknown) {
      return safe(async () => {
        const x = exact(raw, 'key,policyId'),
          auth = keys(k),
          policy = uuid('ai_policy', x.policyId);
        demand(typeof x.key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(x.key));
        const key = String(x.key);
        return run(async (tx) => {
          const person = await owner(tx, auth),
            batchId = await d.repository.capture(
              tx,
              person,
              d.crypto.id('photo_batch', person + '\0' + key),
              policy,
              key,
            );
          return ok({ batchId });
        });
      });
    },
    intent(k: readonly KeyDigest[], raw: unknown) {
      return safe(async () => {
        const x = exact(raw, 'allowed,batchId,key,mime,noticeVersion,policyId,sha256,size'),
          auth = keys(k),
          batchId = uuid('photo_batch', x.batchId),
          policyId = uuid('ai_policy', x.policyId);
        demand(
          typeof x.allowed === 'boolean' &&
            x.noticeVersion === d.noticeVersion &&
            typeof x.key === 'string' &&
            /^[A-Za-z0-9_-]{16,128}$/.test(x.key) &&
            typeof x.mime === 'string' &&
            ['image/jpeg', 'image/png', 'image/webp'].includes(x.mime) &&
            typeof x.sha256 === 'string' &&
            /^[a-f0-9]{64}$/.test(x.sha256) &&
            typeof x.size === 'number' &&
            Number.isSafeInteger(x.size) &&
            x.size >= 1 &&
            x.size <= 10485760,
        );
        const captured = {
            allowed: x.allowed,
            key: x.key,
            mime: x.mime as PhotoIntent['mime'],
            sha256: x.sha256,
            size: x.size,
          },
          fingerprint = d.crypto.hash(
            'photo-command',
            canonical({
              ...captured,
              batchId,
              policyId,
              noticeVersion: d.noticeVersion,
              codec: 'photo-codec-v1',
            }),
          );
        return run<PhotoIntentView>(async (tx) => {
          const person = await owner(tx, auth);
          if (!captured.allowed)
            return ok({ state: 'manual' as const, id: null, grant: null, grantUntil: null });
          const subjectRevision = await d.repository.subjectRevision(tx, person),
            upload = d.crypto.id('photo_upload', person + '\0' + captured.key),
            grant = d.crypto.hash('photo-upload-grant', upload),
            old = await d.repository.intent(tx, person, upload);
          if (old) {
            demand(old.fingerprint === fingerprint, 'conflict');
            demand(await d.repository.current(tx, old), 'unavailable');
            return ok({ state: old.state, id: old.id, grant, grantUntil: old.grantUntil });
          }
          const policy = await d.scopes.policy(tx, policyId);
          demand(
            policy && policy.task === 'photo_extraction' && policy.status === 'active',
            'unavailable',
          );
          const scope = await d.scopes.create(tx, {
              id: d.crypto.id('ai_scope', upload),
              policyId,
              ownerId: person,
              key: d.crypto.hash('photo-scope', person + '\0' + upload),
              subjectRevision,
              noticeVersion: d.noticeVersion,
              evidenceHash: d.crypto.hash('photo-choice', fingerprint),
            }),
            expiresAt = new Date(Date.parse(clock()) + 86400000).toISOString() as Instant,
            originalId = d.crypto.id('asset', upload + 'original'),
            sanitizedId = d.crypto.id('asset', upload + 'sanitized');
          await d.assets.register(tx, {
            id: originalId,
            kind: 'original',
            mime: captured.mime,
            sha256: captured.sha256,
            size: captured.size,
            expiresAt,
          });
          const i = await d.repository.create(tx, {
            id: upload,
            ownerId: person,
            scopeId: scope.id,
            policyId,
            batchId,
            key: captured.key,
            fingerprint,
            grantHash: d.crypto.hash('photo-upload-proof', grant),
            originalId,
            sanitizedId,
            mime: captured.mime,
            sha256: captured.sha256,
            size: captured.size,
          });
          return ok({ state: i.state, id: i.id, grant, grantUntil: i.grantUntil });
        });
      });
    },
    finalize(k: readonly KeyDigest[], raw: unknown, input: Uint8Array) {
      return safe(async () => {
        const x = exact(raw, 'grant,uploadId'),
          upload = uuid('photo_upload', x.uploadId),
          auth = keys(k);
        demand(
          typeof x.grant === 'string' &&
            /^[a-f0-9]{64}$/.test(x.grant) &&
            input instanceof Uint8Array &&
            input.length >= 1 &&
            input.length <= 10485760,
        );
        const grant = String(x.grant),
          bytes = new Uint8Array(input),
          sha = d.hashBytes(bytes),
          lease = d.crypto.id('photo_lease');
        const admission = await run<{ i: PhotoIntent; original: AssetLocation | null }>(
          async (tx) => {
            const i = await authorized(tx, auth, upload);
            demand(
              i.grantHash === d.crypto.hash('photo-upload-proof', grant) &&
                i.sha256 === sha &&
                i.size === bytes.length &&
                imageMime(bytes) === i.mime,
              'invalid_input',
            );
            demand(await d.repository.current(tx, i), 'unavailable');
            if (i.state === 'ready') return ok({ i, original: null });
            const claimed = await d.repository.claim(tx, i.ownerId, i.id, lease);
            demand(claimed, 'conflict');
            const original = await d.assets.register(tx, {
              id: i.originalId,
              kind: 'original',
              mime: i.mime,
              sha256: i.sha256,
              size: i.size,
              expiresAt: i.expiresAt,
            });
            return ok({ i: claimed, original });
          },
        );
        if (!admission.ok) return admission;
        const { i, original } = admission.value;
        if (!original) return run(async (tx) => ok(await view(tx, i)));
        try {
          const originalVersion = await d.objects.put(original, bytes);
          demand((await d.scanner.scan(bytes)) === 'clean', 'unavailable');
          const sanitized = await d.codec.sanitize(bytes, i.mime);
          demand(
            sanitized.mime === 'image/jpeg' &&
              imageMime(sanitized.bytes) === 'image/jpeg' &&
              sanitized.bytes.length >= 1 &&
              sanitized.bytes.length <= 10485760 &&
              [
                sanitized.width,
                sanitized.height,
                sanitized.originalWidth,
                sanitized.originalHeight,
              ].every((v) => Number.isInteger(v) && v >= 1) &&
              sanitized.originalWidth * sanitized.originalHeight <= 40000000 &&
              sanitized.width <= 4096 &&
              sanitized.height <= 4096,
            'invalid_input',
          );
          const prepared = await run(async (tx) => {
            demand(await d.repository.current(tx, i, lease), 'unavailable');
            return ok(
              await d.assets.register(tx, {
                id: i.sanitizedId,
                kind: 'sanitized',
                mime: 'image/jpeg',
                sha256: d.hashBytes(sanitized.bytes),
                size: sanitized.bytes.length,
                expiresAt: i.expiresAt,
              }),
            );
          });
          demand(prepared.ok, 'unavailable');
          const sanitizedVersion = await d.objects.put(prepared.value, sanitized.bytes);
          return await run(async (tx) => {
            demand(await d.repository.current(tx, i, lease), 'unavailable');
            await d.assets.ready(tx, original, originalVersion);
            await d.assets.ready(tx, prepared.value, sanitizedVersion);
            const scope = await d.scopes.scope(tx, i.scopeId);
            demand(scope && scope.ownerId === i.ownerId, 'integrity');
            await d.worker.create(tx, {
              id: i.id,
              ownerId: i.ownerId,
              batchId: i.batchId,
              scopeId: i.scopeId,
              originalAssetId: i.originalId,
              width: sanitized.originalWidth,
              height: sanitized.originalHeight,
              permissionRevision: scope.permissionRevision,
              subjectRevision: scope.subjectRevision!,
              invalidationRevision: scope.invalidationRevision,
              expiresAt: i.expiresAt,
            });
            await d.worker.sanitized(tx, i.ownerId, i.id, i.sanitizedId);
            await d.repository.finish(tx, i, lease);
            return ok(await view(tx, { ...i, state: 'ready', lease: null, leaseUntil: null }));
          });
        } catch (e) {
          const rejected = await run(async (tx) => ok(await d.repository.reject(tx, i, lease)));
          // A stale finalizer must not withdraw or erase a replacement's work.
          if (rejected.ok && rejected.value) await cleanup(i.ownerId, i.id);
          return fail(serviceFailure(e));
        }
      });
    },
    extract(k: readonly KeyDigest[], raw: unknown) {
      return safe(async () => {
        const x = exact(raw, 'key,uploadId'),
          auth = keys(k),
          upload = uuid('photo_upload', x.uploadId);
        demand(typeof x.key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(x.key));
        const command = String(x.key);
        return run(async (tx) => {
          const i = await authorized(tx, auth, upload);
          demand(i.state === 'ready' && (await d.repository.current(tx, i)), 'unavailable');
          const reused = await d.repository.reusable(tx, i.ownerId, i.id);
          if (reused) return ok(reused);
          const sanitized = await d.assets.get(tx, i.sanitizedId);
          demand(sanitized, 'unavailable');
          const request = await d.requests.create(tx, {
            id: d.crypto.id('ai_request', i.id + '\0' + command),
            scopeId: i.scopeId,
            key: command,
            manifest: {
              parameters: { schema: 'photo-fields-v1' },
              sanitized_sha256: sanitized.sha256,
            },
            deadlineSeconds: 120,
          });
          if (request.state === 'queued')
            await d.repository.enqueue(tx, i.ownerId, i.id, request.id);
          return ok({ id: request.id, state: request.state });
        });
      });
    },
    get(k: readonly KeyDigest[], raw: unknown) {
      return safe(async () => {
        const upload = uuid('photo_upload', raw),
          auth = keys(k);
        return run(async (tx) => ok(await view(tx, await authorized(tx, auth, upload))));
      });
    },
    confirm(k: readonly KeyDigest[], raw: unknown) {
      return safe(async () => {
        const x = exact(raw, 'candidateId,field,revision,uploadId,value'),
          auth = keys(k),
          upload = uuid('photo_upload', x.uploadId),
          rev = revision(x.revision);
        demand(rev.ok);
        const field = String(x.field),
          parsed = photoFieldValue(field, x.value, clock());
        demand(parsed.ok);
        const candidateId = x.candidateId === null ? null : uuid('photo_candidate', x.candidateId);
        return run(async (tx) => {
          const i = await authorized(tx, auth, upload);
          demand(await d.repository.current(tx, i), 'not_found');
          const candidates = await d.owners.candidates(tx, i.ownerId, i.id),
            candidate =
              candidateId === null
                ? null
                : candidates.find((c) => c.id === candidateId && c.field === field);
          demand(candidateId === null || (candidate && candidate.value !== null), 'not_found');
          return ok(
            await d.owners.confirm(tx, i.ownerId, {
              uploadId: i.id,
              field: field as PhotoField,
              revision: rev.value,
              candidateId,
              origin:
                candidate === null
                  ? 'manual'
                  : candidate?.value === parsed.value
                    ? 'accepted_candidate'
                    : 'corrected_candidate',
              value: parsed.value,
            }),
          );
        });
      });
    },
    manual(raw: unknown) {
      try {
        const x = exact(raw, 'field,value');
        return photoFieldValue(x.field, x.value, clock());
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    remove(k: readonly KeyDigest[], raw: unknown) {
      return safe(async () => {
        const upload = uuid('photo_upload', raw),
          auth = keys(k);
        const admission = await run(async (tx) => {
          const i = await authorized(tx, auth, upload);
          await d.repository.delete(tx, i.ownerId, i.id);
          return ok(i.ownerId);
        });
        if (!admission.ok) return admission;
        return ok({ id: upload, cleanupPending: await cleanup(admission.value, upload) });
      });
    },
    expire() {
      return safe(async () => {
        const rows = await run(async (tx) => ok(await d.repository.expired(tx)));
        if (!rows.ok) return rows;
        let pending = 0;
        for (const r of rows.value) if (await cleanup(r.ownerId, r.id)) pending++;
        return ok({ processed: rows.value.length, pending });
      });
    },
  });
}
