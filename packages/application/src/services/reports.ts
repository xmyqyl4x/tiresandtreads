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
import { normalizeAssessment } from '../../../engine/src/input.ts';
import { evaluate } from '../../../engine/src/evaluate.ts';
import type { AssessmentInput, EngineResult } from '../../../engine/src/model.ts';
import type {
  OwnerRepository,
  ReportRepository,
  CapabilityRepository,
} from '../ports/owner-report.ts';
import type { Owner, Version, KeyDigest, JsonObject } from '../ports/private-records.ts';
import type {
  ReportEvidence,
  PreparedReport,
  ReportCrypto,
  ReportAccessRepository,
  ReportEncryption,
} from '../ports/report-services.ts';
import type { CommandRepository, CommandIdentity, CommandResponse } from '../ports/jobs.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import {
  exact,
  object,
  demand,
  canonical,
  json,
  reportDiff,
  publicReport,
  publicComparison,
  serviceFailure,
  ReportFault,
  reportWork,
} from './report-records.ts';
import { buildComparison, parsePrivateQuote } from './report-comparison.ts';
import { pageRequest } from '../ports/pagination.ts';
type Receipt = CommandResponse;
function uuid<K extends string>(kind: K, x: unknown) {
  const r = id(kind, x);
  demand(r.ok);
  return r.value;
}
function rev(x: unknown) {
  const r = revision(x);
  demand(r.ok);
  return r.value;
}
function integer(x: unknown) {
  demand(Number.isSafeInteger(x) && Number(x) > 0 && Number(x) <= 2147483647);
  return Number(x);
}
function input(raw: unknown) {
  const r = normalizeAssessment(raw);
  demand(r.ok);
  return r.value;
}
function expiry(at: string, days: number, cap?: string): Instant {
  const value = new Date(new Date(at).getTime() + days * 86400000).toISOString();
  return (cap && cap < value ? cap : value) as Instant;
}
function unwrap<T>(r: Result<T, ApplicationFailure>) {
  if (!r.ok) throw new ReportFault(r.error.code, r.error);
  return r.value;
}
export function createReportServices(deps: {
  readonly uow: UnitOfWork;
  readonly owners: OwnerRepository;
  readonly reports: ReportRepository;
  readonly capabilities: CapabilityRepository;
  readonly access: ReportAccessRepository;
  readonly commands: CommandRepository;
  readonly evidence: ReportEvidence;
  readonly crypto: ReportCrypto;
  readonly encryption: ReportEncryption;
  readonly now: () => string;
}) {
  const { uow, owners, reports, capabilities: caps, access, commands, evidence, crypto } = deps;
  const run = <T>(work: (tx: Tx) => Promise<Result<T, ApplicationFailure>>) =>
    reportWork(uow, work);
  function clock() {
    const t = instant(deps.now());
    demand(t.ok, 'internal');
    return t.value;
  }
  async function safely<T>(
    work: () => Promise<Result<T, ApplicationFailure>>,
  ): Promise<Result<T, ApplicationFailure>> {
    try {
      return await work();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  }
  async function owner(tx: Tx, keys: readonly KeyDigest[], reportId?: Id<'report'>) {
    const who = await owners.resolve(tx, keys);
    demand(who, 'forbidden');
    if (reportId) {
      demand(await reports.head(tx, who, reportId), 'not_found');
      await reports.touch(tx, who, reportId);
    }
    return who;
  }
  function identity(actor: string, operation: string, key: string, body: unknown): CommandIdentity {
    demand(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key));
    return {
      actorHash: crypto.hash('actor', actor),
      operation: 'report.' + operation,
      keyHash: crypto.hash('command-key', key),
      bodyHash: crypto.hash('command-body', canonical(body)),
      canonicalVersion: 1,
    };
  }
  async function execute<P>(
    keys: readonly KeyDigest[],
    operation: string,
    key: string,
    reportId: Id<'report'> | null,
    body: unknown,
    prepare: (who: Owner, at: Instant) => Promise<P>,
    effect: (tx: Tx, who: Owner, p: P, at: Instant) => Promise<Receipt>,
    validate?: (p: P) => Promise<boolean>,
  ) {
    const at = clock();
    const initial = await run(async (tx) => {
      const who = await owner(tx, keys, reportId ?? undefined),
        command = identity(who.subjectId, operation, key, body);
      return ok({ who, command, previous: await commands.lookup(tx, command) });
    });
    if (!initial.ok) return initial;
    if (initial.value.previous) return ok(initial.value.previous);
    const p = await prepare(initial.value.who, at);
    if (validate) demand(await validate(p), 'conflict');
    return run(async (tx) => {
      const who = await owner(tx, keys, reportId ?? undefined);
      demand(who.subjectId === initial.value.who.subjectId, 'forbidden');
      const previous = await commands.claim(tx, initial.value.command);
      if (previous) return ok(previous);
      const result = await effect(tx, who, p, at);
      await commands.complete(tx, initial.value.command, result);
      return ok(result);
    });
  }
  async function compile(answers: AssessmentInput, at: Instant) {
    const prepared = unwrap(await evidence.prepare(answers, at));
    demand(prepared.snapshot.asOf === at, 'integrity');
    const result = evaluate(answers, prepared.snapshot);
    demand(result.ok, 'integrity');
    return { prepared, result: result.value, answers };
  }
  async function valid(p: { prepared: PreparedReport }) {
    return unwrap(await evidence.current(p.prepared));
  }
  function version(
    reportId: Id<'report'>,
    n: number,
    base: number | null,
    p: { prepared: PreparedReport; result: EngineResult; answers: AssessmentInput },
    extra: JsonObject = {},
  ): Version {
    const result = p.result;
    return {
      reportId,
      version: n,
      baseVersion: base,
      bundleId: uuid('bundle', result.versions.bundleId),
      ruleVersionId: uuid('rule', result.versions.ruleVersionId),
      engineVersion: result.versions.engine,
      schemaVersion: 1,
      input: json(p.answers, 65536),
      output: json({
        schemaVersion: 1,
        purpose: 'technical_evaluation',
        issuanceAuthorized: false,
        result,
        evidence: p.prepared.snapshot,
        prices: p.prepared.prices,
        products: p.prepared.products,
        ...extra,
      }),
    };
  }
  async function publish(
    tx: Tx,
    who: Owner,
    head: NonNullable<Awaited<ReturnType<ReportRepository['head']>>>,
    v: Version,
  ) {
    // Output may contain up to 1,000 decisions, but indexed report items retain only the <=5 picks.
    const r = object(v.output.result),
      picks = r.picks as string[],
      decisions = r.decisions as JsonObject[];
    const items = picks.map((key, i) => ({
      key,
      skuId: null,
      kind: 'picked' as const,
      rank: i + 1,
      snapshot: decisions.find((d) => d.id === key)!,
    }));
    await reports.publish(tx, who, head.revision, v, items);
    return {
      schema_version: 1 as const,
      resource_id: v.reportId as string as Id<'resource'>,
      status: 'created' as const,
      report_id: v.reportId,
      report_version: v.version,
    };
  }
  async function read(
    tx: Tx,
    keys: readonly KeyDigest[],
    reportId: Id<'report'>,
    n: number | null,
  ) {
    const who = await owner(tx, keys, reportId),
      head = await reports.head(tx, who, reportId);
    demand(head && head.currentVersion, 'not_found');
    const v = await reports.version(tx, who, reportId, n ?? head.currentVersion);
    demand(v, 'not_found');
    return { who, head, v };
  }
  async function tokenReply(r: Result<Receipt, ApplicationFailure>, purpose: 'share' | 'download') {
    if (!r.ok) return r;
    const receipt = r.value;
    demand(
      receipt.token_key_version && receipt.expires_at && receipt.expires_at > clock(),
      'forbidden',
    );
    const token = crypto.token(purpose, receipt.resource_id, receipt.token_key_version);
    const permission = await run(async (tx) =>
      ok(
        purpose === 'share'
          ? await caps.resolveShare(tx, [token.key])
          : await caps.download(tx, [token.key]),
      ),
    );
    demand(permission.ok && permission.value, 'forbidden');
    return ok({ ...receipt, token: token.token });
  }
  const service = {
    readQuote(keys: readonly KeyDigest[], report: unknown, quote: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          quoteId = uuid('quote', quote);
        const r = await run(async (tx) => {
          const who = await owner(tx, keys, reportId),
            page = pageRequest(100, null);
          demand(page.ok);
          const q = (await reports.quotes(tx, who, reportId, page.value)).items.find(
            (q) => q.id === quoteId,
          );
          demand(q, 'not_found');
          return ok({ q, notes: await access.quoteNotes(tx, who, reportId, quoteId) });
        });
        if (!r.ok) return r;
        const notes = r.value.notes
          ? exact(
              JSON.parse(
                new TextDecoder().decode(
                  await deps.encryption.decrypt(r.value.notes, 'quote', quoteId),
                ),
              ),
              'productText,shopName',
            )
          : null;
        if (notes)
          demand(
            typeof notes.productText === 'string' &&
              notes.productText.length <= 200 &&
              (notes.shopName === null ||
                (typeof notes.shopName === 'string' && notes.shopName.length <= 200)),
            'integrity',
          );
        const authorized = await run(async (tx) => {
          await owner(tx, keys, reportId);
          return ok(null);
        });
        if (!authorized.ok) return authorized;
        return ok(json({ quote: r.value.q, private: notes }));
      });
    },
    readComparison(keys: readonly KeyDigest[], report: unknown, n: unknown, revision: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          number = integer(n),
          expected = rev(revision),
          at = clock();
        const r = await run(async (tx) => {
          const p = await read(tx, keys, reportId, number),
            comparison = await reports.comparison(tx, p.who, reportId, number, expected);
          demand(comparison, 'not_found');
          return ok({ ...p, comparison });
        });
        if (!r.ok) return r;
        const safety = unwrap(await evidence.overlay(r.value.v, at));
        const authorized = await run(async (tx) => {
          await owner(tx, keys, reportId);
          return ok(null);
        });
        if (!authorized.ok) return authorized;
        return ok({
          reportId,
          version: number,
          comparison: publicComparison(r.value.comparison),
          scenario: r.value.comparison.scenario,
          safety,
        });
      });
    },
    create(keys: readonly KeyDigest[], key: string, raw: unknown) {
      return safely(async () => {
        const answers = input(raw);
        return execute(
          keys,
          'create',
          key,
          null,
          answers,
          (_who, at) => compile(answers, at),
          async (tx, who, p, at) => {
            const h = await reports.create(tx, who, {
              id: crypto.id('report'),
              market: 'US',
              locale: 'en-US',
              expiresAt: expiry(at, 180),
            });
            return publish(tx, who, h, version(h.id, 1, null, p));
          },
          valid,
        );
      });
    },
    saveDraft(keys: readonly KeyDigest[], report: unknown, key: string, raw: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          x = exact(raw, 'baseVersion,expectedRevision,input'),
          base = integer(x.baseVersion),
          expected = x.expectedRevision === null ? null : rev(x.expectedRevision),
          answers = input(x.input);
        return execute(
          keys,
          'draft',
          key,
          reportId,
          { reportId, base, expected, answers },
          async () => null,
          async (tx, who, _p, at) => {
            const h = await reports.head(tx, who, reportId);
            demand(h && h.currentVersion === base, 'conflict');
            const d = await reports.saveDraft(tx, who, reportId, expected, {
              baseVersion: base,
              schemaVersion: 1,
              input: json(answers, 65536),
              expiresAt: expiry(at, 7, h.expiresAt),
            });
            return {
              schema_version: 1,
              resource_id: reportId as string as Id<'resource'>,
              status: 'accepted',
              report_id: reportId,
              report_version: base,
              result_revision: d.revision.toString(),
            };
          },
        );
      });
    },
    refine(keys: readonly KeyDigest[], report: unknown, key: string, raw: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          x = exact(raw, 'baseVersion,draftRevision,expectedRevision'),
          base = integer(x.baseVersion),
          draftRevision = rev(x.draftRevision),
          expected = rev(x.expectedRevision);
        return execute(
          keys,
          'refine',
          key,
          reportId,
          { reportId, base, draftRevision, expected },
          async (who, at) => {
            const old = unwrap(
              await run(async (tx) => {
                const d = await reports.draft(tx, who, reportId),
                  v = await reports.version(tx, who, reportId, base);
                demand(
                  d && v && d.revision === draftRevision && d.baseVersion === base,
                  'conflict',
                );
                return ok({ d, v });
              }),
            );
            return { ...(await compile(input(old.d.input), at)), old };
          },
          async (tx, who, p) => {
            const h = await reports.head(tx, who, reportId),
              d = await reports.draft(tx, who, reportId);
            demand(
              h &&
                h.revision === expected &&
                h.currentVersion === base &&
                d?.revision === draftRevision,
              'conflict',
            );
            const next = version(reportId, base + 1, base, p);
            return publish(tx, who, h, {
              ...next,
              output: json({ ...next.output, diff: reportDiff(p.old.v, next) }),
            });
          },
          valid,
        );
      });
    },
    readOwner(keys: readonly KeyDigest[], report: unknown, n: unknown = null) {
      return safely(async () => {
        const reportId = uuid('report', report),
          number = n === null ? null : integer(n),
          at = clock();
        const r = await run(async (tx) => ok(await read(tx, keys, reportId, number)));
        if (!r.ok) return r;
        const overlay = unwrap(await evidence.overlay(r.value.v, at));
        // Recheck authority after the separate source query and project only the intended fields.
        const checked = await run(async (tx) => {
          await owner(tx, keys, reportId);
          return ok(null);
        });
        if (!checked.ok) return checked;
        return ok({
          reportId,
          version: r.value.v.version,
          revision: r.value.head.revision.toString(),
          input: r.value.v.input,
          output: publicReport(r.value.v.output),
          diff: r.value.v.output.diff ?? null,
          safety: overlay,
        });
      });
    },
    readShared(keys: readonly KeyDigest[]) {
      return safely(async () => {
        const at = clock(),
          r = await run(async (tx) => ok(await access.shared(tx, keys)));
        if (!r.ok) return r;
        demand(r.value, 'not_found');
        const overlay = unwrap(await evidence.overlay(r.value.version, at));
        const check = await run(async (tx) => ok(await caps.resolveShare(tx, keys)));
        if (!check.ok) return check;
        demand(
          check.value?.reportId === r.value.version.reportId &&
            check.value.version === r.value.version.version,
          'not_found',
        );
        return ok({
          version: r.value.version.version,
          output: publicReport(r.value.version.output),
          safety: overlay,
          comparison: r.value.comparison ? publicComparison(r.value.comparison) : null,
          access: 'read_only' as const,
        });
      });
    },
    share(keys: readonly KeyDigest[], report: unknown, key: string, raw: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          x = exact(raw, 'comparisonRevision,version'),
          n = x.version === null ? null : integer(x.version),
          comparison = x.comparisonRevision === null ? null : rev(x.comparisonRevision);
        demand(n !== null || comparison === null);
        const r = await execute(
          keys,
          'share',
          key,
          reportId,
          { reportId, n, comparison },
          async () => null,
          async (tx, who, _p, at) => {
            const h = await reports.head(tx, who, reportId);
            demand(h && h.currentVersion, 'not_found');
            const number = n ?? h.currentVersion;
            demand(await reports.version(tx, who, reportId, number), 'not_found');
            if (comparison !== null)
              demand(await reports.comparison(tx, who, reportId, number, comparison), 'not_found');
            const capId = crypto.id('report_capability'),
              expiresAt = expiry(at, 30, h.expiresAt),
              token = crypto.token('share', capId, crypto.keyVersion);
            await caps.share(tx, who, {
              id: capId,
              reportId,
              version: n,
              comparisonRevision: comparison,
              key: token.key,
              expiresAt,
            });
            return {
              schema_version: 1,
              resource_id: capId as string as Id<'resource'>,
              status: 'created',
              report_id: reportId,
              report_version: number,
              token_key_version: crypto.keyVersion,
              expires_at: expiresAt,
            };
          },
        );
        return tokenReply(r, 'share');
      });
    },
    revoke(keys: readonly KeyDigest[], report: unknown, key: string, capability: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          capId = uuid('report_capability', capability);
        return execute(
          keys,
          'revoke',
          key,
          reportId,
          { reportId, capId },
          async () => null,
          async (tx, who) => {
            await caps.revokeShare(tx, who, reportId, capId);
            return {
              schema_version: 1,
              resource_id: capId as string as Id<'resource'>,
              status: 'accepted',
              report_id: reportId,
            };
          },
        );
      });
    },
    fork(keys: readonly KeyDigest[], key: string, shareKeys: readonly KeyDigest[], raw: unknown) {
      return safely(async () => {
        const answers = input(raw),
          shared = await run(async (tx) => ok(await caps.resolveShare(tx, shareKeys)));
        if (!shared.ok) return shared;
        demand(shared.value, 'not_found');
        const from = shared.value;
        return execute(
          keys,
          'fork',
          key,
          null,
          {
            answers,
            from: {
              reportId: from.reportId,
              version: from.version,
              capabilityId: from.capabilityId,
            },
          },
          (_who, at) => compile(answers, at),
          async (tx, who, p, at) => {
            const current = await caps.resolveShare(tx, shareKeys);
            demand(
              current?.capabilityId === from.capabilityId && current.version === from.version,
              'forbidden',
            );
            const h = await reports.create(tx, who, {
              id: crypto.id('report'),
              market: 'US',
              locale: 'en-US',
              expiresAt: expiry(at, 180),
            });
            return publish(
              tx,
              who,
              h,
              version(h.id, 1, null, p, {
                forkedFrom: { reportId: from.reportId, version: from.version },
              }),
            );
          },
          valid,
        );
      });
    },
    saveQuote(keys: readonly KeyDigest[], report: unknown, key: string, raw: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          quote = parsePrivateQuote(raw),
          quoteId = quote.id ?? crypto.id('quote', canonical([reportId, key]));
        return execute(
          keys,
          'quote',
          key,
          reportId,
          { reportId, quote },
          async (_who, at) => {
            demand(quote.observedOn <= at.slice(0, 10));
            return {
              envelope: await deps.encryption.encrypt(
                new TextEncoder().encode(
                  canonical({ productText: quote.productText, shopName: quote.shopName }),
                ),
                'quote',
                quoteId,
              ),
              expiresAt: expiry(at, 30),
            };
          },
          async (tx, who, p) => {
            const h = await reports.head(tx, who, reportId);
            demand(h, 'not_found');
            const expiresAt = p.expiresAt < h.expiresAt ? p.expiresAt : h.expiresAt;
            const revision = await reports.saveQuote(tx, who, quote.expectedRevision, {
              id: quoteId,
              reportId,
              sourceKey: quoteId,
              skuId: quote.skuId,
              currency: 'USD',
              totalMinor: quote.totalMinor,
              quantity: quote.quantity,
              basis: quote.basis,
              observedOn: quote.observedOn,
              components: quote.components,
              expiresAt,
            });
            await access.quotePrivate(tx, who, quoteId, p.envelope, expiresAt);
            return {
              schema_version: 1,
              resource_id: quoteId as string as Id<'resource'>,
              status: 'accepted',
              report_id: reportId,
              result_revision: revision.toString(),
            };
          },
        );
      });
    },
    compare(keys: readonly KeyDigest[], report: unknown, key: string, raw: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          x = exact(raw, 'expectedRevision,items,version'),
          n = integer(x.version),
          expected = x.expectedRevision === null ? null : rev(x.expectedRevision);
        demand(Array.isArray(x.items) && x.items.length >= 1 && x.items.length <= 4);
        const selected = x.items.map((i) => {
          const v = exact(i, 'key,kind');
          demand(v.kind === 'catalog' || v.kind === 'quote');
          return { kind: v.kind as 'catalog' | 'quote', key: uuid('selection', v.key) };
        });
        demand(new Set(selected.map((v) => v.kind + v.key)).size === selected.length);
        return execute(
          keys,
          'compare',
          key,
          reportId,
          { reportId, n, expected, selected },
          async (who, at) => {
            const old = unwrap(
              await run(async (tx) => {
                const v = await reports.version(tx, who, reportId, n);
                demand(v, 'not_found');
                const page = pageRequest(100, null);
                demand(page.ok);
                const qs = await reports.quotes(tx, who, reportId, page.value);
                demand(qs.next === null, 'unavailable');
                return ok({ v, quotes: qs.items });
              }),
            );
            const p = await compile(input(old.v.input), at);
            return {
              ...p,
              old,
              comparison: buildComparison(
                old.v,
                p.prepared,
                p.result,
                old.quotes,
                selected,
                crypto,
              ),
            };
          },
          async (tx, who, p) => {
            const paging = pageRequest(100, null);
            demand(paging.ok);
            const current = await reports.quotes(tx, who, reportId, paging.value);
            for (const item of selected.filter((i) => i.kind === 'quote'))
              demand(
                current.items.find((q) => String(q.id) === item.key)?.revision ===
                  p.old.quotes.find((q) => String(q.id) === item.key)?.revision,
                'conflict',
              );
            const c = await reports.compare(
              tx,
              who,
              reportId,
              n,
              expected,
              p.comparison.scenario,
              p.comparison.items,
            );
            return {
              schema_version: 1,
              resource_id: reportId as string as Id<'resource'>,
              status: 'accepted',
              report_id: reportId,
              report_version: n,
              result_revision: c.revision.toString(),
            };
          },
          valid,
        );
      });
    },
    ownerDownload(keys: readonly KeyDigest[], report: unknown, key: string, raw: unknown) {
      return safely(async () => {
        const reportId = uuid('report', report),
          x = exact(raw, 'assetId,version'),
          assetId = uuid('asset', x.assetId),
          n = integer(x.version);
        const r = await execute(
          keys,
          'pdf',
          key,
          reportId,
          { reportId, assetId, n },
          async () => null,
          async (tx, who, _p, at) => {
            demand(await reports.version(tx, who, reportId, n), 'not_found');
            const h = await reports.head(tx, who, reportId);
            demand(h, 'not_found');
            const grantId = crypto.id('download_grant'),
              expiresAt = expiry(at, 15 / 1440, h.expiresAt),
              token = crypto.token('download', grantId, crypto.keyVersion);
            await caps.grant(
              tx,
              { owner: who },
              {
                id: grantId,
                assetId,
                reportId,
                version: n,
                scope: 'owner',
                key: token.key,
                expiresAt,
              },
            );
            return {
              schema_version: 1,
              resource_id: grantId as string as Id<'resource'>,
              status: 'created',
              report_id: reportId,
              report_version: n,
              token_key_version: crypto.keyVersion,
              expires_at: expiresAt,
            };
          },
        );
        return tokenReply(r, 'download');
      });
    },
    sharedDownload(keys: readonly KeyDigest[], key: string, raw: unknown) {
      return safely(async () => {
        const x = exact(raw, 'assetId'),
          assetId = uuid('asset', x.assetId),
          at = clock();
        const r = await run(async (tx) => {
          const share = await caps.resolveShare(tx, keys);
          demand(share, 'forbidden');
          const command = identity(share.capabilityId, 'shared-pdf', key, {
            assetId,
            reportId: share.reportId,
            version: share.version,
          });
          const previous = await commands.claim(tx, command);
          if (previous) return ok(previous);
          const grantId = crypto.id('download_grant'),
            expiresAt = expiry(at, 15 / 1440),
            token = crypto.token('download', grantId, crypto.keyVersion);
          await caps.grant(
            tx,
            { shareKeys: keys },
            {
              id: grantId,
              assetId,
              reportId: share.reportId,
              version: share.version,
              scope: 'shared',
              key: token.key,
              expiresAt,
            },
          );
          const receipt: Receipt = {
            schema_version: 1,
            resource_id: grantId as string as Id<'resource'>,
            status: 'created',
            report_id: share.reportId,
            report_version: share.version,
            token_key_version: crypto.keyVersion,
            expires_at: expiresAt,
          };
          await commands.complete(tx, command, receipt);
          return ok(receipt);
        });
        return tokenReply(r, 'download');
      });
    },
  };
  return service;
}
