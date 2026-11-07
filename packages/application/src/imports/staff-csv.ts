import { ok, fail, id, instant, type Id, type Result } from '../../../domain/src/values/core.ts';
import {
  parseStaffCsv,
  validateCsvDefinition,
  exportCsvErrors,
  type CsvError,
} from '../../../domain/src/staff-csv.ts';
import type { CsvTemplate } from '../../../domain/src/entities/csv-review.ts';
import type {
  CsvMapping,
  CsvCommand,
  StaffCsvRepository,
  CsvFiles,
  CsvRuntimeIdentity,
} from '../ports/staff-csv.ts';
import type { CsvReviewRepository } from '../ports/csv-review-repositories.ts';
import type { IngestionRepository, PublicationRepository } from '../ports/ingestion.ts';
import type { FactDecoder, ImportOperations, ImportSnapshot } from '../ports/import-service.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import { createImportService } from '../services/ingestion.ts';
import { serviceWork, demand, serviceFailure, ServiceFault } from '../services/service-work.ts';
import { canonical, exact } from '../services/service-records.ts';
export function createStaffCsvServices(
  d: Readonly<{
    staffUow: UnitOfWork;
    ingestUow: UnitOfWork;
    publishUow: UnitOfWork;
    staff: StaffCsvRepository;
    ingestSupport: StaffCsvRepository;
    publishSupport: StaffCsvRepository;
    csv: CsvReviewRepository;
    ingest: IngestionRepository;
    publisher: IngestionRepository;
    publish: PublicationRepository;
    operations: ImportOperations;
    publicationOperations: ImportOperations;
    decode: FactDecoder;
    files: CsvFiles;
    crypto: CsvRuntimeIdentity;
    mappings: readonly CsvMapping[];
    parserRevision: string;
    now: () => string;
  }>,
) {
  demand(
    /^[a-f0-9]{40}$/.test(d.parserRevision) && d.mappings.length > 0 && d.mappings.length <= 32,
  );
  const mappings = d.mappings.map((m) => {
    demand(
      /^[a-z][a-z0-9_]{0,63}$/.test(m.key) &&
        /^[a-z][a-z0-9_-]{0,79}$/.test(m.sourceKind) &&
        m.schemaVersion === '1' &&
        m.mappingVersion === '1',
    );
    return Object.freeze({
      ...m,
      columns: Object.freeze(m.columns.map((c) => Object.freeze({ ...c }))),
    });
  });
  demand(new Set(mappings.map((m) => m.key)).size === mappings.length);
  const uid = <K extends string>(kind: K, value: unknown) => {
    const r = id(kind, value);
    demand(r.ok);
    return r.value;
  };
  const clock = () => {
    const r = instant(d.now());
    demand(r.ok);
    return r.value;
  };
  const command = (v: unknown) => {
    demand(typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v));
    return v;
  };
  const run = <T>(uow: UnitOfWork, fn: (tx: Tx) => Promise<T>) =>
    serviceWork(uow, async (tx) => ok(await fn(tx)));
  const safe = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  };
  const value = <T>(r: Result<T, ApplicationFailure>) => {
    if (!r.ok) throw new ServiceFault(r.error.code, r.error);
    return r.value;
  };
  function definition(t: CsvTemplate) {
    const m = mappings.find((m) => m.key === t.key);
    demand(
      m &&
        t.sourceKind === m.sourceKind &&
        t.schemaVersion === m.schemaVersion &&
        t.mappingVersion === m.mappingVersion &&
        t.parserRevision === d.parserRevision &&
        canonical(t.columns, 65536) === canonical(m.columns, 65536),
      'integrity',
    );
    demand(t.definitionHash === templateHash(t), 'integrity');
    return m;
  }
  function templateHash(t: Omit<CsvTemplate, 'id' | 'state' | 'definitionHash'>) {
    return d.crypto.sha256(
      new TextEncoder().encode(
        canonical(
          {
            key: t.key,
            version: t.version,
            sourceKind: t.sourceKind,
            schemaVersion: t.schemaVersion,
            mappingVersion: t.mappingVersion,
            parserRevision: t.parserRevision,
            columns: t.columns,
            maxBytes: t.maxBytes,
            maxRows: t.maxRows,
          },
          65536,
        ),
      ),
    );
  }
  async function template(tx: Tx, actor: Id<'staff'>, tid: Id<'csv_template'>) {
    await d.staff.authorize(tx, actor, 'data.review');
    const t = await d.csv.template(tx, actor, tid);
    demand(t && t.state === 'active', 'not_found');
    definition(t);
    return t;
  }
  function parse(bytes: Uint8Array, t: CsvTemplate) {
    const parsed = parseStaffCsv(bytes, t),
      m = definition(t),
      errors: CsvError[] = [...parsed.errors],
      invalid = new Set(parsed.invalidRows),
      seen = new Set<string>(),
      frames: unknown[] = [],
      lines: string[] = [];
    let size = 0;
    if (!parsed.structurallyValid) return { ...parsed, frames, packetHash: null, errors };
    for (const [index, row] of parsed.rows.entries()) {
      let frame: unknown = { invalid_csv_row: true };
      if (!invalid.has(index + 1)) {
        let decoded: ReturnType<FactDecoder> | null;
        try {
          decoded = d.decode(m.map(row));
        } catch {
          decoded = null;
        }
        if (decoded?.ok) {
          frame = decoded.value;
          const r = decoded.value.record,
            key = 'sourceRecordKey' in r ? r.sourceRecordKey : r.id;
          if (seen.has(key)) {
            if (errors.length < 1000)
              errors.push({ row: index + 1, column: 'record', code: 'duplicate' });
          }
          seen.add(key);
        } else if (errors.length < 1000)
          errors.push({ row: index + 1, column: 'record', code: 'record' });
      }
      const line = canonical(frame, 16384) + '\n';
      size += new TextEncoder().encode(line).length;
      demand(size <= 33554432, 'invalid_input');
      lines.push(line);
      frames.push(JSON.parse(line));
    }
    return {
      ...parsed,
      frames,
      packetHash: d.crypto.sha256(new TextEncoder().encode(lines.join(''))),
      errors,
    };
  }
  async function load(actor: Id<'staff'>, intake: Id<'csv_intake'>) {
    return value(await run(d.staffUow, (tx) => d.staff.command(tx, actor, intake)));
  }
  async function source(actor: Id<'staff'>, c: CsvCommand) {
    const t = value(await run(d.staffUow, (tx) => template(tx, actor, c.templateId))),
      bytes = await d.files.read(c.assetId);
    demand(d.crypto.sha256(bytes) === c.rawHash, 'integrity');
    const parsed = parse(bytes, t);
    demand(
      parsed.structurallyValid &&
        parsed.packetHash === c.packetHash &&
        parsed.frames.length === c.registration.expectedRows,
      'integrity',
    );
    return { t, parsed };
  }
  function importer(c: CsvCommand) {
    const ingest: IngestionRepository = {
      ...d.ingest,
      async register(tx, input) {
        const r = await d.ingest.register(tx, { ...input, mode: 'manual' });
        await d.ingestSupport.bind(tx, c.actorId, c.id, r.id);
        return r;
      },
    };
    return createImportService({
      ingest,
      publisher: d.publisher,
      publish: d.publish,
      operations: d.operations,
      publicationOperations: d.publicationOperations,
      ingestUow: d.ingestUow,
      publishUow: d.publishUow,
      decode: d.decode,
      expires: () => c.expiresAt,
    });
  }
  return Object.freeze({
    createTemplate(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          x = exact(raw, 'mapping,maxBytes,maxRows,state,version'),
          m = mappings.find((m) => m.key === x.mapping);
        demand(
          m &&
            Number.isSafeInteger(x.version) &&
            Number(x.version) > 0 &&
            Number.isSafeInteger(x.maxBytes) &&
            Number(x.maxBytes) > 0 &&
            Number(x.maxBytes) <= 16777216 &&
            Number.isSafeInteger(x.maxRows) &&
            Number(x.maxRows) > 0 &&
            Number(x.maxRows) <= 100000 &&
            (x.state === 'draft' || x.state === 'active'),
        );
        const base = {
            key: m.key,
            version: Number(x.version),
            sourceKind: m.sourceKind,
            schemaVersion: m.schemaVersion,
            mappingVersion: m.mappingVersion,
            parserRevision: d.parserRevision,
            columns: m.columns,
            maxBytes: Number(x.maxBytes),
            maxRows: Number(x.maxRows),
          },
          t: CsvTemplate = {
            ...base,
            id: d.crypto.id('csv_template', m.key + ':' + x.version),
            state: x.state,
            definitionHash: templateHash(base),
          };
        validateCsvDefinition(t);
        return run(d.staffUow, async (tx) => {
          await d.staff.authorize(tx, actor, 'data.review');
          const old = await d.csv.template(tx, actor, t.id);
          if (old) {
            demand(canonical(old, 65536) === canonical(t, 65536), 'conflict');
            return old;
          }
          return d.csv.createTemplate(tx, actor, t);
        });
      });
    },
    template(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          tid = uid('csv_template', raw);
        return run(d.staffUow, async (tx) => {
          const t = await template(tx, actor, tid);
          return {
            template: t,
            filename: t.key + '-v' + t.version + '.csv',
            csv: t.columns.map((c) => c.name).join(',') + '\r\n',
          };
        });
      });
    },
    retire(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          tid = uid('csv_template', raw);
        return run(d.staffUow, async (tx) => {
          await d.staff.authorize(tx, actor, 'data.review');
          const t = await d.csv.template(tx, actor, tid);
          demand(t, 'not_found');
          if (t.state !== 'retired') await d.csv.retire(tx, actor, tid);
          return null;
        });
      });
    },
    upload(actorRaw: unknown, raw: unknown, input: Uint8Array) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          x = exact(
            raw,
            'command,effectiveAt,externalVersion,licenseId,market,providerId,templateId',
          ),
          key = command(x.command),
          tid = uid('csv_template', x.templateId),
          provider = uid('provider', x.providerId),
          license = uid('license', x.licenseId),
          effective = instant(x.effectiveAt);
        demand(
          effective.ok &&
            typeof x.externalVersion === 'string' &&
            x.externalVersion.length > 0 &&
            x.externalVersion.length <= 200 &&
            !x.externalVersion.includes('\0') &&
            typeof x.market === 'string' &&
            /^[A-Z]{2}$/.test(x.market) &&
            input instanceof Uint8Array &&
            input.length <= 16777216,
        );
        const t = value(await run(d.staffUow, (tx) => template(tx, actor, tid))),
          bytes = new Uint8Array(input),
          parsed = parse(bytes, t);
        if (!parsed.structurallyValid)
          return ok({
            id: null,
            phase: 'invalid' as const,
            errors: exportCsvErrors(parsed.errors),
          });
        const now = clock(),
          binding = d.crypto.hash('csv.upload.command', actor + '\0' + key),
          intake = d.crypto.id('csv_intake', binding),
          rawHash = d.crypto.sha256(bytes),
          fingerprint = d.crypto.hash(
            'csv.upload.body',
            canonical(
              { input: x, rawHash, packetHash: parsed.packetHash, templateHash: t.definitionHash },
              16384,
            ),
          );
        const c = value(
          await run(d.staffUow, (tx) =>
            d.staff.reserve(tx, actor, {
              id: intake,
              commandHash: binding,
              fingerprint,
              templateId: tid,
              assetId: d.crypto.id('asset', intake + ':raw'),
              jobId: d.crypto.id('job', intake + ':validation'),
              providerId: provider,
              licenseId: license,
              market: x.market as string,
              rawHash,
              packetHash: parsed.packetHash!,
              expiresAt: new Date(
                Date.parse(now) + 86400000,
              ).toISOString() as import('../../../domain/src/values/core.ts').Instant,
              registration: {
                id: d.crypto.id('dataset', intake),
                providerId: provider,
                licenseId: license,
                kind: t.sourceKind,
                externalVersion: x.externalVersion as string,
                checksum: parsed.packetHash!,
                effectiveAt: effective.value,
                fetchedAt: now,
                upstreamRunKey: binding,
                schemaVersion: '1',
                mappingVersion: '1',
                semantics: 'complete_snapshot',
                expectedRows: parsed.frames.length,
              },
            }),
          ),
        );
        if (c.phase !== 'uploading')
          return ok({ id: c.id, phase: c.phase, errors: exportCsvErrors(parsed.errors) });
        await d.files.store(c.assetId, 'import_source', 'text/csv', bytes, c.expiresAt);
        const registered = await run(d.ingestUow, async (tx) => {
          const dataset = await d.ingest.dataset(tx, c.registration),
            state = await d.ingest.register(tx, {
              datasetId: dataset,
              mode: 'manual',
              identity: {
                providerId: c.providerId,
                kind: c.registration.kind,
                checksum: c.packetHash,
                upstreamRunKey: c.registration.upstreamRunKey,
                schemaVersion: '1',
                mappingVersion: '1',
              },
            });
          await d.ingestSupport.bind(tx, actor, c.id, state.id);
          return state;
        });
        if (!registered.ok) return registered;
        return ok({
          id: c.id,
          phase: 'registered' as const,
          errors: exportCsvErrors(parsed.errors),
        });
      });
    },
    validate(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          intake = uid('csv_intake', raw),
          c = await load(actor, intake);
        demand(!['cancelled', 'published', 'rejected'].includes(c.phase), 'conflict');
        const { parsed } = await source(actor, c),
          snapshot: ImportSnapshot = {
            registration: c.registration,
            frames: async function* () {
              for (const row of parsed.frames) yield { row };
              yield { end: true };
            },
          },
          prepared = await importer(c).prepare(snapshot);
        value(
          await run(d.ingestUow, async (tx) => {
            await d.ingestSupport.prepared(tx, actor, intake);
            return null;
          }),
        );
        if (!prepared.ok) {
          const state = await load(actor, intake);
          if (state.phase !== 'rejected') return prepared;
        }
        const state = await load(actor, intake);
        return ok({
          id: intake,
          phase: state.phase,
          runId: state.runId,
          errors: exportCsvErrors(parsed.errors),
        });
      });
    },
    preview(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          x = exact(raw, 'command,intakeId'),
          intake = uid('csv_intake', x.intakeId),
          key = d.crypto.hash('csv.preview', actor + '\0' + command(x.command)),
          pid = d.crypto.id('csv_preview', intake + '\0' + key),
          c = await load(actor, intake);
        const captured = value(
          await run(d.publishUow, async (tx) => {
            const p = await d.publishSupport.preview(tx, actor, intake, key, pid);
            return {
              p,
              diff: p.complete
                ? null
                : await d.publicationOperations.diff(tx, p.runId, p.head?.bundleId ?? null),
              state: p.complete ? null : await d.publicationOperations.status(tx, p.runId),
            };
          }),
        );
        if (captured.p.complete) return ok(captured.p);
        const p = captured.p,
          diff = new TextEncoder().encode(
            canonical({ schema: 1, intakeId: intake, head: p.head, changes: captured.diff }, 65536),
          ),
          validation = new TextEncoder().encode(
            canonical(
              {
                schema: 1,
                intakeId: intake,
                runRevision: p.runRevision,
                fence: p.fence,
                accepted: captured.state!.accepted,
                rejected: captured.state!.rejected,
                templateId: c.templateId,
                rawHash: c.rawHash,
                packetHash: c.packetHash,
                parserRevision: d.parserRevision,
              },
              16384,
            ),
          );
        await d.files.store(
          p.diffAssetId,
          'import_evidence',
          'application/json',
          diff,
          p.expiresAt,
        );
        await d.files.store(
          p.validationAssetId,
          'import_evidence',
          'application/json',
          validation,
          p.expiresAt,
        );
        return run(d.publishUow, (tx) =>
          d.publishSupport.completePreview(
            tx,
            actor,
            p,
            d.crypto.sha256(diff),
            d.crypto.sha256(validation),
          ),
        );
      });
    },
    review(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          x = exact(raw, 'command,decision,previewId,reason'),
          pid = uid('csv_preview', x.previewId),
          key = command(x.command);
        demand(
          (x.decision === 'approved' || x.decision === 'rejected') &&
            typeof x.reason === 'string' &&
            /^[a-z][a-z0-9_]{0,63}$/.test(x.reason),
        );
        const rid = d.crypto.id('csv_review', actor + '\0' + key);
        return run(d.staffUow, async (tx) => {
          const role = await d.staff.authorize(tx, actor, 'data.review'),
            basis = await d.staff.reviewBasis(tx, actor, pid),
            input = {
              ...basis,
              id: rid,
              reviewerId: actor,
              roleRevision: role,
              decision: x.decision as 'approved' | 'rejected',
              reason: x.reason as string,
            },
            old = await d.staff.reviewReplay(tx, actor, rid);
          if (old) {
            demand(canonical(old, 16384) === canonical(input, 16384), 'conflict');
            return old;
          }
          return d.csv.review(tx, actor, input);
        });
      });
    },
    publish(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          x = exact(raw, 'command,intakeId,reviewId'),
          intake = uid('csv_intake', x.intakeId),
          review = uid('csv_review', x.reviewId),
          key = d.crypto.hash('csv.publish.command', actor + '\0' + command(x.command)),
          bundle = d.crypto.id('bundle', intake + '\0' + key);
        return run(d.publishUow, async (tx) => {
          const p = await d.publishSupport.publication(tx, actor, intake, review, key, bundle);
          if (p.published) return p.bundleId;
          const state = await d.publisher.lease(tx, p.runId, 300);
          await d.publish.bundle(tx, { id: p.bundleId, market: p.market, members: p.members });
          return d.publish.publish(tx, {
            lease: { runId: p.runId, fence: state.fence },
            bundleId: p.bundleId,
            market: p.market,
            expectedHead: p.head,
            required: p.members.map((m) => ({ key: m.key, kind: m.kind })),
            actorId: actor,
            approvalId: p.approvalId,
          });
        });
      });
    },
    cancel(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          x = exact(raw, 'command,intakeId'),
          intake = uid('csv_intake', x.intakeId),
          evidence = d.crypto.hash(
            'csv.cancel',
            canonical({ actor, intake, command: command(x.command) }, 4096),
          );
        return run(d.staffUow, async (tx) => {
          await d.staff.cancel(tx, actor, intake, evidence);
          return null;
        });
      });
    },
    errors(actorRaw: unknown, raw: unknown) {
      return safe(async () => {
        const actor = uid('staff', actorRaw),
          intake = uid('csv_intake', raw),
          c = await load(actor, intake),
          { parsed } = await source(actor, c);
        value(await run(d.staffUow, (tx) => d.staff.authorize(tx, actor, 'data.review')));
        return ok({
          filename: 'csv-errors.csv',
          mime: 'text/csv' as const,
          csv: exportCsvErrors(parsed.errors),
        });
      });
    },
    workflows: (actor: Id<'staff'>, page: Parameters<CsvReviewRepository['workflows']>[2]) =>
      run(d.staffUow, async (tx) => {
        await d.staff.authorize(tx, actor, 'data.review');
        return d.csv.workflows(tx, actor, page);
      }),
  });
}
