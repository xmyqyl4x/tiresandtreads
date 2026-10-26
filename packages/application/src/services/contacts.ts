import {
  normalizeEmail,
  browserPolicy,
  browserPurposes,
} from '../../../domain/src/contact-policy.ts';
import { ok, fail, instant, type Id, type Instant } from '../../../domain/src/values/core.ts';
import type {
  ContactPolicy,
  ContactCrypto,
  ContactEncryption,
  ContactServiceRepository,
  ContactRequest,
  BrowserChoices,
  ContactIntent,
} from '../ports/contact-services.ts';
import type { OwnerRepository, ReportRepository } from '../ports/owner-report.ts';
import type { PrivacyRepository } from '../ports/privacy.ts';
import type { CommandRepository, CommandIdentity, CommandResponse } from '../ports/jobs.ts';
import type { ReliabilityRepository } from '../ports/reliability.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import { serviceWork, demand, ServiceFault, serviceFailure } from './service-work.ts';
import { canonical } from './service-records.ts';
// Every method is a trusted headless application boundary; transport schemas/auth/CSRF are added at S4.
export function createContactServices(d: {
  readonly uow: UnitOfWork;
  readonly owners: OwnerRepository;
  readonly reports: ReportRepository;
  readonly privacy: PrivacyRepository;
  readonly contacts: ContactServiceRepository;
  readonly commands: CommandRepository;
  readonly reliability: ReliabilityRepository;
  readonly crypto: ContactCrypto;
  readonly encryption: ContactEncryption;
  readonly policy: ContactPolicy;
  readonly now: () => string;
}) {
  const work = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  async function owner(tx: Tx, keys: readonly KeyDigest[]) {
    const o = await d.owners.resolve(tx, keys);
    demand(o, 'forbidden');
    return o;
  }
  function clock() {
    const r = instant(d.now());
    demand(r.ok);
    return r.value;
  }
  const expires = (at: Instant, days: number) =>
    new Date(Date.parse(at) + days * 86400000).toISOString() as Instant;
  const scopes = (purpose: string, scope: string) => [
    'all-email',
    ...(purpose === 'offers' ? ['all-marketing'] : []),
    purpose,
    scope,
  ];
  async function notice(tx: Tx, purpose: keyof ContactPolicy['notices'], id: unknown) {
    demand(id === d.policy.notices[purpose]);
    demand(
      await d.contacts.notice(tx, d.policy.notices[purpose], purpose, d.policy.version),
      'conflict',
    );
  }
  function identity(actor: string, operation: string, key: string, body: unknown): CommandIdentity {
    demand(typeof key === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(key));
    return {
      actorHash: d.crypto.hash('actor', actor),
      operation,
      keyHash: d.crypto.hash('key', key),
      bodyHash: d.crypto.hash('body', canonical(body, 8192)),
      canonicalVersion: 1,
    };
  }
  async function allowed(tx: Tx, i: ContactIntent, confirmation = false) {
    const c = await d.contacts.guard(tx, null, i.contactId),
      ks = await d.contacts.contactKeys(tx, c.id),
      ss = scopes(i.purpose, i.scope);
    demand(
      !(confirmation
        ? await d.contacts.confirmationBlocked(tx, c.subjectId, ss)
        : await d.privacy.suppressed(tx, c.subjectId, ss)),
      'forbidden',
    );
    demand(!(await d.contacts.tombstoned(tx, ks, ss)), 'forbidden');
    return c;
  }
  const proofCurrent = (i: ContactIntent, eventId: Id<'consent_event'> | null) =>
    i.permissionDigest === d.crypto.hash('proof_permission', i.id + ':' + eventId);
  async function proof(tx: Tx, raw: string, audience: 'verify' | 'unsubscribe') {
    const parsed = d.crypto.parse(audience, raw);
    demand(parsed, 'forbidden');
    const i = await d.contacts.intent(tx, parsed.id);
    demand(i, 'not_found');
    // An unsubscribe uses its own MAC audience; the stored verification digest never becomes a bearer.
    const verify = d.crypto.token('verify', i.id, parsed.key.keyVersion);
    demand(
      verify.key.digest === i.key.digest && parsed.key.keyVersion === i.key.keyVersion,
      'forbidden',
    );
    return i;
  }
  return {
    async request(keys: readonly KeyDigest[], key: string, input: ContactRequest) {
      try {
        let email: string;
        try {
          email = normalizeEmail(input.email);
        } catch {
          throw new ServiceFault('invalid_input');
        }
        demand(typeof input.offers === 'boolean' && (input.offers || input.report !== null));
        demand(
          input.report === null ||
            (Number.isSafeInteger(input.report.version) && input.report.version > 0),
        );
        demand(Object.keys(input).sort().join(',') === 'email,notices,offers,report');
        const body = {
            email,
            report: input.report ? { id: input.report.id, version: input.report.version } : null,
            offers: input.offers,
            notices: input.notices,
          },
          at = clock();
        const pre = await work(async (tx) => {
          const o = await owner(tx, keys),
            cmd = identity(o.subjectId, 'contact.request', key, body);
          if (input.report)
            demand(
              await d.reports.version(tx, o, input.report.id, input.report.version),
              'not_found',
            );
          if (input.report) await notice(tx, 'report', input.notices.report);
          if (input.offers) await notice(tx, 'offers', input.notices.offers);
          return { o, cmd, receipt: await d.commands.lookup(tx, cmd) };
        });
        if (!pre.ok) return pre;
        if (pre.value.receipt) return ok(pre.value.receipt);
        const stable = pre.value.cmd.actorHash + pre.value.cmd.keyHash,
          id = d.crypto.id('contact', stable),
          subjectId = d.crypto.id('subject', stable),
          resource = d.crypto.id('resource', stable),
          lookup = d.crypto.emailKeys(email);
        const envelope = await d.encryption.encrypt(
          new TextEncoder().encode(email),
          'contact_email',
          id,
        );
        return await work(async (tx) => {
          const o = await owner(tx, keys),
            cmd = pre.value.cmd,
            replay = await d.commands.claim(tx, cmd);
          if (replay) return replay;
          const c = await d.privacy.registerContact(tx, {
            id,
            subjectId,
            keys: lookup,
            envelope,
            guardSubjects: [o.subjectId],
          });
          await d.contacts.guard(tx, o, c.id);
          if (input.report) {
            demand(
              await d.reports.version(tx, o, input.report.id, input.report.version),
              'not_found',
            );
            await notice(tx, 'report', input.notices.report);
          }
          if (input.offers) await notice(tx, 'offers', input.notices.offers);
          for (const purpose of ['report', 'offers'] as const) {
            if (purpose === 'report' ? !input.report : !input.offers) continue;
            const scopeKey =
              purpose === 'report'
                ? `report:${input.report!.id}:${input.report!.version}`
                : 'offers';
            const ss = scopes(purpose, scopeKey);
            demand(!(await d.contacts.tombstoned(tx, lookup, ss)), 'forbidden');
            demand(
              !(await d.privacy.suppressed(tx, c.subjectId, [
                'all-email',
                ...(purpose === 'offers' ? ['all-marketing'] : []),
              ])),
              'forbidden',
            );
            const p = await d.privacy.permission(tx, c.subjectId, purpose, scopeKey);
            const eventId = d.crypto.id('consent_event'),
              challenge = d.crypto.id('verification', stable + purpose),
              token = d.crypto.token('verify', challenge, d.crypto.currentTokenVersion);
            const permissionDigest = d.crypto.hash(
              'proof_permission',
              challenge + ':' + (p.status === 'unknown' ? eventId : p.eventId),
            );
            if (p.status === 'unknown')
              await d.privacy.consent(tx, {
                id: eventId,
                subjectId: c.subjectId,
                purpose,
                scope: scopeKey,
                expectedRevision: p.revision,
                action: 'grant',
                noticeId: d.policy.notices[purpose],
                policyVersion: d.policy.version,
                method: 'explicit_request',
                expiresAt: expires(at, 30),
                evidenceDigest: permissionDigest,
              });
            else
              await d.contacts.recordGrant(tx, {
                eventId,
                subjectId: c.subjectId,
                purpose,
                scope: scopeKey,
                noticeId: d.policy.notices[purpose],
                policyVersion: d.policy.version,
                permissionDigest,
              });
            await d.contacts.createIntent(tx, {
              id: challenge,
              contactId: c.id,
              subjectId: c.subjectId,
              ownerId: o.subjectId,
              purpose,
              scope: scopeKey,
              noticeId: d.policy.notices[purpose],
              policyVersion: d.policy.version,
              eventId,
              key: token.key,
              expiresAt: expires(at, 7),
            });
            await d.reliability.append(tx, {
              eventId: d.crypto.id('event'),
              aggregateId: challenge as string as Id<'aggregate'>,
              aggregateKind: 'contact_verification',
              type: 'contact.verification_requested',
              version: 1,
              payload: { resource_id: challenge, resource_kind: 'contact_verification' },
            });
          }
          const receipt: CommandResponse = {
            schema_version: 1,
            resource_id: resource,
            status: 'accepted',
          };
          await d.commands.complete(tx, cmd, receipt);
          return receipt;
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    // Internal worker port. Never expose this method/response through a public controller.
    // It prepares a minimal confirmation only; final dispatch must recheck through permission().
    async verificationMessage(id: Id<'verification'>) {
      const pre = await work(async (tx) => {
        const i = await d.contacts.intent(tx, id);
        demand(i && i.live && !i.usedAt && !i.invalidated, 'forbidden');
        await notice(tx, i.purpose, i.noticeId);
        const c = await allowed(tx, i, true),
          p = await d.privacy.permission(tx, i.subjectId, i.purpose, i.scope);
        demand(proofCurrent(i, p.eventId), 'forbidden');
        return { i, c };
      });
      if (!pre.ok) return pre;
      try {
        const { i, c } = pre.value,
          bytes = await d.encryption.decrypt(c.envelope, 'contact_email', c.id),
          email = normalizeEmail(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const recheck = await work(async (tx) => {
          const current = await d.contacts.intent(tx, id);
          demand(current && current.live && !current.usedAt && !current.invalidated, 'forbidden');
          await allowed(tx, current, true);
          const p = await d.privacy.permission(tx, i.subjectId, i.purpose, i.scope);
          demand(proofCurrent(i, p.eventId), 'forbidden');
          return {
            email,
            purpose: i.purpose,
            scope: i.scope,
            contactId: i.contactId,
            subjectId: i.subjectId,
            permissionRevision: p.revision,
            verificationToken: d.crypto.token('verify', i.id, i.key.keyVersion).raw,
            unsubscribeToken: d.crypto.token('unsubscribe', i.id, i.key.keyVersion).raw,
            expiresAt: i.expiresAt,
          };
        });
        return recheck;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async confirm(raw: string, method: string) {
      return work(async (tx) => {
        demand(method === 'POST');
        const i = await proof(tx, raw, 'verify');
        demand(i.live && !i.invalidated, 'forbidden');
        await notice(tx, i.purpose, i.noticeId);
        await allowed(tx, i, true);
        const p = await d.privacy.permission(tx, i.subjectId, i.purpose, i.scope);
        if (i.usedAt) {
          demand(p.status === 'confirmed', 'forbidden');
          return { status: 'confirmed' as const };
        }
        demand(proofCurrent(i, p.eventId), 'conflict');
        await d.contacts.consume(tx, i.id);
        const c = await d.contacts.guard(tx, null, i.contactId);
        if (!c.verifiedAt) await d.privacy.confirmContact(tx, c.id, c.revision);
        await d.privacy.consent(tx, {
          id: d.crypto.id('consent_event'),
          subjectId: i.subjectId,
          purpose: i.purpose,
          scope: i.scope,
          expectedRevision: p.revision,
          action: 'confirm',
          noticeId: i.noticeId,
          policyVersion: d.policy.version,
          method: 'inbox_post',
          expiresAt: i.purpose === 'report' ? i.expiresAt : expires(clock(), 180),
        });
        await d.contacts.clearWithdrawal(tx, i.subjectId, i.scope);
        return { status: 'confirmed' as const };
      });
    },
    async withdraw(raw: string, method: string) {
      return work(async (tx) => {
        demand(method === 'POST');
        const i = await proof(tx, raw, 'unsubscribe'),
          p = await d.privacy.permission(tx, i.subjectId, i.purpose, i.scope);
        if (p.status !== 'withdrawn') {
          await d.privacy.consent(tx, {
            id: d.crypto.id('consent_event'),
            subjectId: i.subjectId,
            purpose: i.purpose,
            scope: i.scope,
            expectedRevision: p.revision,
            action: 'withdraw',
            noticeId: i.noticeId,
            policyVersion: i.policyVersion,
            method: 'unsubscribe_post',
            expiresAt: null,
          });
          await d.privacy.suppress(tx, {
            subjectId: i.subjectId,
            scope: i.scope,
            reason: 'withdrawn',
            expiresAt: null,
          });
        }
        await d.contacts.invalidate(tx, i.subjectId, i.purpose, i.scope);
        return { status: 'withdrawn' as const };
      });
    },
    // Trusted delivery/provider workflow only, after provider webhook signature verification.
    async suppress(
      contactId: Id<'contact'>,
      reason: 'hard_bounce' | 'complaint' | 'deletion',
      eventKey: string,
    ) {
      return work(async (tx) => {
        demand(['hard_bounce', 'complaint', 'deletion'].includes(reason));
        const c = await d.contacts.guard(tx, null, contactId),
          cmd = identity(c.subjectId, 'contact.suppress', eventKey, { contactId, reason }),
          replay = await d.commands.claim(tx, cmd);
        if (replay) return replay;
        await d.privacy.suppress(tx, {
          subjectId: c.subjectId,
          scope: 'all-email',
          reason,
          expiresAt: null,
        });
        await d.contacts.tombstone(tx, await d.contacts.contactKeys(tx, c.id), 'all-email', reason);
        const r: CommandResponse = {
          schema_version: 1,
          resource_id: d.crypto.id('resource', cmd.actorHash + cmd.keyHash),
          status: 'accepted',
        };
        await d.commands.complete(tx, cmd, r);
        return r;
      });
    },
    async permission(
      contactId: Id<'contact'>,
      purpose: 'report' | 'offers',
      scope: string,
      verificationId: Id<'verification'> | null = null,
    ) {
      return work(async (tx) => {
        demand(purpose === 'report' || purpose === 'offers');
        demand(
          purpose === 'offers'
            ? scope === 'offers'
            : /^report:[a-f0-9-]{36}:[1-9][0-9]*$/.test(scope),
        );
        const c = await d.contacts.guard(tx, null, contactId),
          p = await d.privacy.permission(tx, c.subjectId, purpose, scope),
          ss = scopes(purpose, scope);
        if (verificationId) {
          const i = await d.contacts.intent(tx, verificationId);
          demand(
            i &&
              i.contactId === c.id &&
              i.purpose === purpose &&
              i.scope === scope &&
              i.live &&
              !i.usedAt &&
              !i.invalidated &&
              proofCurrent(i, p.eventId),
            'forbidden',
          );
          await notice(tx, purpose, i.noticeId);
        } else {
          demand(c.verifiedAt && p.status === 'confirmed', 'forbidden');
          await notice(tx, purpose, d.policy.notices[purpose]);
          demand(
            await d.contacts.currentPermission(
              tx,
              c.subjectId,
              purpose,
              scope,
              d.policy.notices[purpose],
              d.policy.version,
            ),
            'forbidden',
          );
        }
        demand(
          !(verificationId
            ? await d.contacts.confirmationBlocked(tx, c.subjectId, ss)
            : await d.privacy.suppressed(tx, c.subjectId, ss)),
          'forbidden',
        );
        demand(
          !(await d.contacts.tombstoned(tx, await d.contacts.contactKeys(tx, c.id), ss)),
          'forbidden',
        );
        return {
          subjectId: c.subjectId,
          purpose,
          scope,
          revision: p.revision,
          confirmationOnly: verificationId !== null,
        };
      });
    },
    async setBrowserChoices(
      keys: readonly KeyDigest[],
      key: string,
      input: BrowserChoices,
      method: string,
    ) {
      return work(async (tx) => {
        demand(
          method === 'POST' &&
            typeof input.gpc === 'boolean' &&
            Array.isArray(input.allowed) &&
            input.allowed.length <= 3 &&
            new Set(input.allowed).size === input.allowed.length &&
            input.allowed.every((p) => browserPurposes.includes(p)),
        );
        const o = await owner(tx, keys),
          body = {
            expectedRevision: String(input.expectedRevision),
            allowed: [...input.allowed].sort(),
            gpc: input.gpc,
            notices: input.notices,
          },
          cmd = identity(o.subjectId, 'privacy.browser_choices', key, body),
          replay = await d.commands.claim(tx, cmd);
        if (replay) return replay;
        for (const p of [...browserPurposes, 'necessary'] as const)
          await notice(tx, p, input.notices[p]);
        await d.contacts.browser(tx, o, d.policy.version);
        const prior = await d.privacy.permission(tx, o.subjectId, 'analytics', 'site');
        demand(prior.revision === input.expectedRevision, 'conflict');
        const permitted = browserPolicy(input.allowed, input.gpc, true),
          approved = browserPurposes.filter((p) => permitted[p]);
        for (const purpose of browserPurposes) {
          const p = await d.privacy.permission(tx, o.subjectId, purpose, 'site');
          await d.privacy.consent(tx, {
            id: d.crypto.id('consent_event'),
            subjectId: o.subjectId,
            purpose,
            scope: 'site',
            expectedRevision: p.revision,
            action: approved.includes(purpose) ? 'confirm' : 'withdraw',
            noticeId: d.policy.notices[purpose],
            policyVersion: d.policy.version,
            method: 'cmp_explicit_post',
            expiresAt: expires(clock(), 180),
          });
        }
        await d.contacts.cookie(
          tx,
          o,
          d.policy.notices.necessary,
          d.policy.version,
          input.gpc,
          approved,
          d.crypto.hash('cmp_receipt', canonical(body, 8192)),
        );
        const p = await d.privacy.permission(tx, o.subjectId, 'analytics', 'site'),
          r: CommandResponse = {
            schema_version: 1,
            resource_id: d.crypto.id('resource', cmd.actorHash + cmd.keyHash),
            status: 'accepted',
            result_revision: p.revision.toString(),
          };
        await d.commands.complete(tx, cmd, r);
        return r;
      });
    },
    async browser(
      keys: readonly KeyDigest[],
      signals: { readonly gpc: boolean; readonly cmpAvailable: boolean },
    ) {
      return work(async (tx) => {
        demand(typeof signals.gpc === 'boolean' && typeof signals.cmpAvailable === 'boolean');
        const o = await owner(tx, keys),
          choices = await d.contacts.browser(tx, o, d.policy.version),
          p = await d.privacy.permission(tx, o.subjectId, 'analytics', 'site');
        return {
          ...browserPolicy(choices, signals.gpc, signals.cmpAvailable),
          revision: p.revision,
        };
      });
    },
  };
}
