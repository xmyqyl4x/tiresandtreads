import {
  ok,
  fail,
  instant,
  revision,
  type Id,
  type Result,
} from '../../../domain/src/values/core.ts';
import { retryDecision, validateMail } from '../../../domain/src/delivery-policy.ts';
import { normalizeEmail } from '../../../domain/src/contact-policy.ts';
import type {
  DeliveryWorkRepository,
  DeliveryFiles,
  DeliveryPolicy,
  FrozenDelivery,
  ReportRenderer,
  MailProvider,
  DeliveryDocument,
} from '../ports/delivery-services.ts';
import type {
  ContactCrypto,
  ContactEncryption,
  ContactRequest,
} from '../ports/contact-services.ts';
import type { DeliveryRepository } from '../ports/delivery.ts';
import type { OwnerRepository, ReportRepository } from '../ports/owner-report.ts';
import type { ReliabilityRepository } from '../ports/reliability.ts';
import type { KeyDigest, Send } from '../ports/private-records.ts';
import type {
  UnitOfWork,
  ApplicationFailure,
  TransactionContext as Tx,
} from '../ports/transactions.ts';
import type { createContactServices } from './contacts.ts';
import { serviceWork, demand, serviceFailure, ServiceFault } from './service-work.ts';
import { canonical, json, exact } from './service-records.ts';
import { publicReport, publicComparison } from './report-records.ts';
export function createDeliveryServices(d: {
  readonly uow: UnitOfWork;
  readonly owners: OwnerRepository;
  readonly reports: ReportRepository;
  readonly contacts: Pick<ReturnType<typeof createContactServices>, 'request'>;
  readonly delivery: DeliveryRepository;
  readonly work: DeliveryWorkRepository;
  readonly reliability: ReliabilityRepository;
  readonly crypto: ContactCrypto;
  readonly encryption: ContactEncryption;
  readonly files: DeliveryFiles;
  readonly renderer: ReportRenderer;
  readonly provider: MailProvider;
  readonly policy: DeliveryPolicy;
  readonly checksum: (bytes: Uint8Array) => string;
  readonly now: () => string;
}) {
  const work = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  const clock = () => {
    const n = d.now();
    demand(instant(n).ok);
    return n;
  };
  const dto = (s: Send) => ({
    id: s.id,
    revision: String(s.revision),
    state: s.state,
    sendAfter: s.sendAfter,
    cancelDeadline: s.cancelDeadline,
  });
  async function owned(tx: Tx, keys: readonly KeyDigest[], id: Id<'send'>) {
    const who = await d.owners.resolve(tx, keys);
    demand(who, 'forbidden');
    const send = await d.delivery.owned(tx, who, id);
    demand(send, 'not_found');
    return { who, send };
  }
  return {
    async request(
      keys: readonly KeyDigest[],
      command: string,
      input: ContactRequest & { readonly comparisonRevision?: string | null },
    ) {
      try {
        demand(input.report);
        exact(
          input,
          input.comparisonRevision === undefined
            ? 'email,notices,offers,report'
            : 'comparisonRevision,email,notices,offers,report',
        );
        const parsed = input.comparisonRevision == null ? null : revision(input.comparisonRevision);
        demand(parsed === null || parsed.ok);
        const comparison = parsed?.ok ? parsed.value : null;
        const body: ContactRequest = {
          email: input.email,
          report: input.report,
          offers: input.offers,
          notices: input.notices,
        };
        const fingerprint = canonical({
          comparison: input.comparisonRevision ?? null,
          policy: d.policy.version,
          sender: d.policy.sender,
          template: d.policy.templateId,
          fixture: d.policy.fixture,
        });
        const result = await d.contacts.request(keys, command, body, {
          fingerprint,
          async apply(tx, ctx) {
            const ref = input.report!;
            const h = await d.reports.head(tx, ctx.owner, ref.id),
              v = await d.reports.version(tx, ctx.owner, ref.id, ref.version);
            demand(h && v, 'not_found');
            // Actual issuance remains gated; current report services deliberately produce technical evaluations.
            demand(d.policy.fixture || v.output.issuanceAuthorized === true, 'forbidden');
            demand(
              d.renderer.fixture === d.policy.fixture && d.provider.fixture === d.policy.fixture,
              'forbidden',
            );
            demand(
              typeof d.policy.sender === 'string' &&
                d.policy.sender.length <= 254 &&
                !/[\r\n]/.test(d.policy.sender),
            );
            const presentation = await d.work.presentation(tx, ref.id);
            const t = await d.work.template(tx, d.policy.templateId, presentation.locale);
            demand(t && t.rendererHash === d.renderer.hash, 'conflict');
            const c =
              comparison === null
                ? null
                : await d.reports.comparison(tx, ctx.owner, ref.id, ref.version, comparison);
            demand(comparison === null || c, 'not_found');
            const document: DeliveryDocument = {
              schemaVersion: 1,
              fixture: d.policy.fixture,
              sender: d.policy.sender,
              policyVersion: d.policy.version,
              locale: presentation.locale,
              market: presentation.market,
              report: json({ ...publicReport(v.output), reportId: v.reportId, version: v.version }),
              comparison: c ? publicComparison(json(c)) : null,
              template: t,
              learning: await d.work.learning(tx, v, presentation.locale, presentation.market),
            };
            const id = ctx.resourceId as string as Id<'send'>;
            const send = await d.delivery.schedule(tx, {
              id,
              owner: ctx.owner,
              contactId: ctx.contact.id,
              kind: 'report',
              reportId: ref.id,
              reportVersion: ref.version,
              comparisonRevision: c?.revision ?? null,
              templateId: t.id,
              provider: d.provider.name,
              providerKey: d.crypto.hash('provider_send', id),
              delaySeconds: 60,
              policyVersion: d.policy.version,
              noticeId: input.notices.report!,
              purposes: ['report'],
            });
            await d.work.capture(tx, {
              send,
              owner: ctx.owner,
              verificationId: ctx.reportIntentId,
              offersId: ctx.offersIntentId,
              document,
            });
            await d.reliability.append(tx, {
              eventId: d.crypto.id('event'),
              aggregateId: id as string as Id<'aggregate'>,
              aggregateKind: 'report_delivery',
              type: 'report.delivery_requested',
              version: 1,
              payload: { resource_id: id, resource_kind: 'report_delivery' },
            });
          },
        });
        if (!result.ok) return result;
        return work(async (tx) =>
          dto((await owned(tx, keys, result.value.resource_id as string as Id<'send'>)).send),
        );
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async status(keys: readonly KeyDigest[], id: Id<'send'>) {
      return work(async (tx) => dto((await owned(tx, keys, id)).send));
    },
    async cancel(
      keys: readonly KeyDigest[],
      id: Id<'send'>,
      expected: string,
      reason: 'cancel' | 'correct_address' = 'cancel',
    ) {
      return work(async (tx) => {
        demand(reason === 'cancel' || reason === 'correct_address');
        const { who, send } = await owned(tx, keys, id);
        if (send.state === 'cancelled') {
          await d.work.invalidate(tx, id, reason === 'correct_address');
          return dto(send);
        }
        const r = revision(expected);
        demand(r.ok);
        const cancelled = await d.delivery.cancel(tx, who, id, r.value);
        await d.work.invalidate(tx, id, reason === 'correct_address');
        return dto(cancelled);
      });
    },
    async dispatch(
      id: Id<'send'>,
    ): Promise<Result<ReturnType<typeof dto> | { state: 'stopped' } | null, ApplicationFailure>> {
      const acquired = await work((tx) => d.work.acquire(tx, id));
      if (!acquired.ok) return acquired;
      if (!acquired.value) return ok(null);
      let l = acquired.value,
        attempted = false;
      try {
        if (l.send.state === 'dispatching') {
          const recovered = await work(async (tx) => {
            const a = await d.work.recover(tx, l);
            demand(a, 'integrity');
            return d.delivery.finish(tx, {
              id,
              attemptId: a.attemptId,
              expected: a.revision,
              outcome: 'uncertain',
              providerMessageId: null,
              errorCode: 'worker_interrupted',
            });
          });
          if (!recovered.ok) return recovered;
          l = { ...l, send: recovered.value };
        }
        if (
          l.failures > 8 ||
          (l.firstAttemptAt &&
            retryDecision(l.firstAttemptAt, clock(), l.attempts) === 'manual_review')
        )
          return work(async (tx) => {
            await d.work.stop(tx, l, 'retry_exhausted');
            return { state: 'stopped' as const };
          });
        const permitted = await work((tx) => d.work.permission(tx, l));
        if (!permitted.ok) throw new ServiceFault(permitted.error.code, permitted.error);
        demand(
          l.document.schemaVersion === 1 &&
            l.document.report.reportId === l.send.reportId &&
            l.document.report.version === l.send.reportVersion &&
            l.document.template.id === l.send.templateId &&
            d.provider.name === l.send.provider &&
            l.document.fixture === d.policy.fixture &&
            l.document.policyVersion === d.policy.version &&
            l.document.template.rendererHash === d.renderer.hash &&
            d.renderer.fixture === d.policy.fixture &&
            d.provider.fixture === d.policy.fixture,
          'forbidden',
        );
        let payloadId = l.payloadId,
          hash = l.payloadHash;
        if (!payloadId) {
          demand(
            l.document.learning.every((link) => link.expiresAt > clock()),
            'conflict',
          );
          const mail = validateMail(await d.renderer.render(l.document));
          demand(mail.fixture === d.policy.fixture, 'forbidden');
          const email = normalizeEmail(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await d.encryption.decrypt(l.contact.envelope, 'contact_email', l.contact.id),
            ),
          );
          const payload: FrozenDelivery = {
            schemaVersion: 1,
            from: l.document.sender,
            recipient: email,
            mail,
          };
          const bytes = new TextEncoder().encode(canonical(payload, 8 * 1024 * 1024)),
            pdf = Uint8Array.from(atob(mail.pdf), (c) => c.charCodeAt(0));
          payloadId = d.crypto.id('asset', id + ':payload');
          const pdfId = d.crypto.id('asset', id + ':pdf');
          hash = d.checksum(bytes);
          await d.files.put(pdfId, 'report_pdf', pdf);
          await d.files.put(payloadId, 'email_payload', bytes);
          const frozen = await work((tx) => d.work.freeze(tx, l, payloadId!, pdfId, hash!));
          if (!frozen.ok) throw new ServiceFault(frozen.error.code, frozen.error);
        }
        const bytes = await d.files.get(payloadId);
        demand(d.checksum(bytes) === hash, 'integrity');
        const payload = exact(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          'from,mail,recipient,schemaVersion',
        ) as unknown as FrozenDelivery;
        demand(
          payload.schemaVersion === 1 &&
            payload.from === l.document.sender &&
            payload.recipient === normalizeEmail(payload.recipient),
          'integrity',
        );
        validateMail(payload.mail);
        demand(payload.mail.fixture === d.policy.fixture, 'forbidden');
        const claim = await work(async (tx) => {
          const permission = await d.work.permission(tx, l);
          await d.work.attempt(tx, l);
          return d.delivery.claim(tx, {
            id,
            expected: l.send.revision,
            recipientSubjectId: l.contact.subjectId,
            permissionRevision: permission,
            purpose: 'report',
            scope: `report:${l.send.reportId}:${l.send.reportVersion}`,
            payloadAssetId: payloadId!,
            payloadHash: hash!,
            retryLease: { token: l.token, generation: l.generation },
          });
        });
        if (!claim.ok) throw new ServiceFault(claim.error.code, claim.error);
        attempted = true;
        let outcome: Awaited<ReturnType<MailProvider['send']>>;
        try {
          outcome = await d.provider.send(l.send.providerKey, payload);
        } catch {
          outcome = { outcome: 'uncertain', messageId: null };
        }
        return work(async (tx) => {
          await d.work.fence(tx, l);
          const sent = await d.delivery.finish(tx, {
            id,
            attemptId: claim.value.attemptId,
            expected: claim.value.send.revision,
            outcome: outcome.outcome,
            providerMessageId: outcome.messageId,
            errorCode: outcome.outcome === 'accepted' ? null : 'provider_handoff',
          });
          await d.work.release(tx, l, outcome.outcome === 'uncertain' ? 'deferred' : null);
          return dto(sent);
        });
      } catch (e) {
        if (!attempted)
          await work(async (tx) => {
            if (e instanceof ServiceFault && e.code === 'forbidden')
              await d.work.stop(tx, l, 'permission_denied');
            else await d.work.release(tx, l, 'render_unavailable');
          });
        return fail(serviceFailure(e));
      }
    },
    async reconcile() {
      return work((tx) => d.work.pending(tx));
    },
  };
}
