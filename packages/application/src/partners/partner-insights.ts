import { ok, fail, type Id, type Result } from '../../../domain/src/values/core.ts';
import { partnerPrincipal, partnerDomain } from '../../../domain/src/partner-policy.ts';
import { completedWeek, domainSample } from '../../../domain/src/partner-insights-policy.ts';
import type { PartnerAuthority, PartnerClock, PartnerCrypto } from '../ports/partner-services.ts';
import type { ContactEncryption } from '../ports/contact-services.ts';
import type {
  PartnerInsightsRepository,
  InsightsTokens,
  InsightsPermission,
  RedemptionCommand,
  DisputeCommand,
  OfferClick,
} from '../ports/partner-insights.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import { demand, serviceFailure, serviceWork } from '../services/service-work.ts';
import { capture, identifier, string, timestamp } from './partner-work.ts';
export function createPartnerInsightsServices(
  d: Readonly<{
    uow: UnitOfWork;
    repository: PartnerInsightsRepository;
    authority: PartnerAuthority;
    clock: PartnerClock;
    crypto: PartnerCrypto;
    encryption: ContactEncryption;
    tokens: InsightsTokens;
  }>,
) {
  const r = d.repository;
  async function principal(handle: string) {
    string(handle, 2048);
    const proof = await d.authority.verify(handle);
    demand(proof.ok, 'forbidden');
    const p = partnerPrincipal(capture(proof.value), d.clock.now());
    demand(p.ok, 'forbidden');
    return p.value;
  }
  async function safe<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  }
  const week = (raw: unknown) => {
    const v = completedWeek(raw, d.clock.now());
    demand(v.ok);
    return v.value;
  };
  function eventTime(raw: unknown) {
    const at = timestamp(raw),
      n = Date.parse(at),
      now = d.clock.now();
    demand(n >= now - 30 * 86400000 && n <= now + 300000);
    return at;
  }
  async function member<T>(
    handle: string,
    organization: Id<'organization'>,
    write: boolean,
    fn: (tx: Tx, p: Awaited<ReturnType<typeof principal>>, org: Id<'organization'>) => Promise<T>,
  ) {
    const org = identifier('organization', organization),
      p = await principal(handle);
    return serviceWork(d.uow, async (tx) => {
      await r.member(tx, p, org, write);
      const result = await fn(tx, p, org);
      demand(partnerPrincipal(p, d.clock.now()).ok, 'forbidden');
      await r.member(tx, p, org, write);
      return ok(result);
    });
  }
  async function staff<T>(
    handle: string,
    permission: InsightsPermission,
    fn: (tx: Tx, p: Awaited<ReturnType<typeof principal>>) => Promise<T>,
  ) {
    const p = await principal(handle);
    return serviceWork(d.uow, async (tx) => {
      await r.staff(tx, p, permission);
      const result = await fn(tx, p);
      demand(partnerPrincipal(p, d.clock.now()).ok, 'forbidden');
      await r.staff(tx, p, permission);
      return ok(result);
    });
  }
  return {
    report(handle: string, org: Id<'organization'>, rawWeek: string) {
      return safe(async () => {
        const w = week(rawWeek);
        return member(handle, org, false, async (tx) =>
          Object.freeze({
            ...(await r.release(tx, org, w)),
            market: 'US',
            grain: 'distinct consented recipients per completed UTC week',
            attribution: 'reported redemption is not a verified sale',
            pilot: 'noncharging',
            currency: null,
            clicks:
              'attributable first-party offer clicks; suspected-human estimate; scanner/unknown excluded',
          }),
        );
      });
    },
    internal(handle: string, rawWeek: string) {
      return safe(async () => {
        const w = week(rawWeek);
        return staff(handle, 'operations.insights', async (tx) =>
          Object.freeze({
            ...(await r.release(tx, null, w)),
            market: 'US',
            grain: 'distinct consented visitors; first observed channel per week',
            coverage: 'permitted web/app traffic only; unknown and bot traffic excluded',
            exportEnabled: false,
          }),
        );
      });
    },
    redemption(handle: string, org: Id<'organization'>, raw: RedemptionCommand) {
      return safe(async () => {
        const v = capture(raw),
          input: RedemptionCommand = {
            key: identifier('command', v.key),
            assignment: identifier('coupon_assignment', v.assignment),
            kind: v.kind,
            quantity: v.quantity,
            previous: v.previous === null ? null : identifier('redemption_event', v.previous),
            occurredAt: eventTime(v.occurredAt),
          };
        demand(
          ['reported', 'correction', 'reversal'].includes(input.kind) &&
            Number.isInteger(input.quantity) &&
            input.quantity !== 0 &&
            Math.abs(input.quantity) <= 4 &&
            (input.kind === 'reported'
              ? input.quantity > 0 && input.previous === null
              : input.previous !== null) &&
            (input.kind !== 'reversal' || input.quantity < 0),
        );
        return member(handle, org, true, async (tx, p) => ({
          event: await r.redemption(
            tx,
            org,
            p.subject,
            input,
            d.crypto.digest(['redemption', p.subject, input]),
          ),
          verifiedSale: false as const,
          charging: false as const,
        }));
      });
    },
    dispute(handle: string, org: Id<'organization'>, raw: DisputeCommand) {
      return safe(async () => {
        const v = capture(raw),
          details = string(v.details, 2000),
          input = {
            key: identifier('command', v.key),
            id: identifier('partner_dispute', v.id),
            assignment: identifier('coupon_assignment', v.assignment),
            reason: v.reason,
            kind: v.kind,
            expected: v.expected,
          };
        demand(
          ['terms', 'not_honored', 'redemption', 'error', 'other'].includes(input.reason) &&
            ['opened', 'evidence', 'resolved', 'reopened'].includes(input.kind) &&
            Number.isInteger(input.expected) &&
            input.expected >= 0 &&
            input.expected <= 10000 &&
            (input.kind === 'opened' ? input.expected === 0 : input.expected > 0),
        );
        await principal(handle);
        const box = await d.encryption.encrypt(
            new TextEncoder().encode(JSON.stringify({ details })),
            'partner_dispute',
            input.id,
          ),
          digest = d.crypto.digest(['dispute', input, details]);
        if (input.kind === 'resolved' || input.kind === 'reopened')
          return staff(handle, 'partner.disputes', async (tx, p) =>
            r.dispute(tx, identifier('organization', org), p, input, box, digest),
          );
        return member(handle, org, true, (tx, p) => r.dispute(tx, org, p, input, box, digest));
      });
    },
    disputes(
      handle: string,
      org: Id<'organization'>,
      after: Id<'partner_dispute'> | null = null,
      limit = 25,
    ) {
      return safe(async () => {
        demand(Number.isInteger(limit) && limit >= 1 && limit <= 50);
        if (after !== null) identifier('partner_dispute', after);
        return member(handle, org, false, (tx) => r.disputes(tx, org, after, limit));
      });
    },
    offerClick(handle: string, raw: OfferClick) {
      return safe(async () => {
        const v = capture(raw),
          input: OfferClick = {
            key: identifier('command', v.key),
            organization: identifier('organization', v.organization),
            assignment: identifier('coupon_assignment', v.assignment),
            method: v.method,
            classification: v.classification,
            occurredAt: eventTime(v.occurredAt),
          };
        demand(
          ['GET', 'HEAD'].includes(input.method) &&
            ['machine', 'unknown', 'suspected_human'].includes(input.classification),
        );
        return staff(handle, 'operations.events', async (tx, p) => {
          await r.click(tx, p.subject, input, d.crypto.digest(input));
          return { recorded: true, allocationChanged: false };
        });
      });
    },
    health(handle: string, rawWeek: string) {
      return safe(async () => {
        const w = week(rawWeek);
        return staff(handle, 'operations.email', async (tx) => ({
          week: w,
          ...(await r.health(tx, w)),
          grain: 'distinct sends; accepted-send cohort',
          deliveryIsIndependentFact: true,
          opensAreEstimates: true,
          domainAttribution: 'unavailable; sends have no recorded sender domain',
        }));
      });
    },
    importDomain(handle: string, key: Id<'command'>, raw: unknown) {
      return safe(async () => {
        const k = identifier('command', key),
          v = domainSample(capture(raw), d.clock.now());
        demand(v.ok);
        return staff(handle, 'operations.email', async (tx, p) => {
          await r.importDomain(tx, k, p.subject, v.value, d.crypto.digest(v.value));
          return { imported: true };
        });
      });
    },
    domains(handle: string, rawDomain: string) {
      return safe(async () => {
        const v = partnerDomain(rawDomain);
        demand(v.ok);
        return staff(handle, 'operations.email', async (tx) => ({
          domain: v.value,
          samples: await r.domains(tx, v.value),
          missingSourceStatus: 'unavailable',
        }));
      });
    },
    visitors(handle: string, rawWeek: string, rawAfter: string | null = null, limit = 25) {
      return safe(async () => {
        const w = week(rawWeek);
        demand(Number.isInteger(limit) && limit >= 1 && limit <= 50);
        return staff(handle, 'operations.visitors', async (tx, p) => {
          const cursor =
            rawAfter === null ? null : d.tokens.parse(p.subject, 'page', rawAfter, d.clock.now());
          demand(rawAfter === null || cursor?.week === w);
          const rows = await r.visitors(tx, w, cursor?.subject ?? null, limit + 1),
            page = rows.slice(0, limit);
          return {
            items: page.map((v) =>
              Object.freeze({
                ref: d.tokens.issue(
                  p.subject,
                  'visitor',
                  { subject: v.subject, week: w },
                  d.clock.now(),
                ),
                lastSeen: v.lastSeen,
                sessions: v.sessions,
                events: v.events,
                routes: v.routes,
                channels: v.channels,
                contact: 'masked' as const,
              }),
            ),
            next:
              rows.length > limit
                ? d.tokens.issue(
                    p.subject,
                    'page',
                    { subject: page.at(-1)!.subject, week: w },
                    d.clock.now(),
                  )
                : null,
            coverage: 'consented site traffic only',
          };
        });
      });
    },
    reveal(
      handle: string,
      token: string,
      reason: 'support_request' | 'privacy_request',
      rawCase: Id<'case'>,
    ): Promise<
      Result<
        Readonly<{ email: string; caseId: Id<'case'>; exportEnabled: boolean }> | null,
        ApplicationFailure
      >
    > {
      return safe(async () => {
        demand(['support_request', 'privacy_request'].includes(reason));
        const caseId = identifier('case', rawCase),
          p = await principal(handle),
          v = d.tokens.parse(p.subject, 'visitor', token, d.clock.now());
        demand(v, 'forbidden');
        const w = week(v.week);
        const receipt = await staff(handle, 'operations.reveal', (tx, current) => {
          demand(current.subject === p.subject, 'forbidden');
          return r.reveal(tx, current, v.subject, w, reason, caseId);
        });
        if (!receipt.ok) return receipt;
        if (!receipt.value) return ok(null);
        const box = receipt.value,
          email = new TextDecoder('utf-8', { fatal: true }).decode(
            await d.encryption.decrypt(box.envelope, 'contact_email', box.id),
          );
        demand(
          email.length <= 320 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email),
          'unavailable',
        );
        return staff(handle, 'operations.reveal', async (tx, current) => {
          demand(current.subject === p.subject, 'forbidden');
          const fresh = await r.reveal(tx, current, v.subject, w, reason, caseId);
          demand(
            fresh &&
              fresh.id === box.id &&
              fresh.revision === box.revision &&
              fresh.envelope.hex === box.envelope.hex &&
              fresh.envelope.keyVersion === box.envelope.keyVersion,
            'forbidden',
          );
          return { email, caseId, exportEnabled: false };
        });
      });
    },
    purge(handle: string, rawSubject: Id<'subject'>) {
      return safe(async () => {
        const s = identifier('subject', rawSubject);
        return staff(handle, 'operations.privacy', async (tx, p) => {
          await r.purge(tx, s, p.subject);
          return { newOperationsLinksPurged: true, fullSubjectErasureAccepted: false };
        });
      });
    },
    maintenance(handle: string, limit = 100) {
      return safe(async () => {
        demand(Number.isInteger(limit) && limit >= 1 && limit <= 500);
        return staff(handle, 'operations.privacy', async (tx) => ({
          purged: await r.maintenance(tx, limit),
        }));
      });
    },
  };
}
